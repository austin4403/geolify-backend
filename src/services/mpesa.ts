import { PRICING_PLANS } from "../routes/pricing";

export interface MpesaStkPushParams {
  userId: string;
  phoneNumber: string;
  planId: "pro" | "premium" | "enterprise";
  billingCycle: "monthly" | "annual";
  discountPercent?: number;
}

export interface MpesaStkPushResult {
  merchantRequestId: string;
  checkoutRequestId: string;
  responseCode: string;
  responseDescription: string;
  customerMessage: string;
  amount: number;
  discountAmount: number;
  phoneNumber: string;
}

/**
 * Normalizes Kenyan phone numbers to standard Safaricom format (2547XXXXXXXX or 2541XXXXXXXX)
 */
export function sanitizeMpesaPhone(phone: string): string {
  let cleaned = phone.replace(/[^0-9]/g, "");

  if (cleaned.startsWith("0")) {
    cleaned = "254" + cleaned.substring(1);
  } else if (cleaned.startsWith("7") || cleaned.startsWith("1")) {
    cleaned = "254" + cleaned;
  } else if (cleaned.startsWith("+254")) {
    cleaned = cleaned.substring(1);
  }

  if (!/^254(7|1)\d{8}$/.test(cleaned)) {
    throw new Error(`Invalid Safaricom phone number '${phone}'. Expected format: 07XXXXXXXX or 2547XXXXXXXX.`);
  }

  return cleaned;
}

/**
 * Initiates an M-Pesa Daraja STK Push to the user's mobile phone
 */
export async function initiateMpesaStkPush(params: MpesaStkPushParams): Promise<MpesaStkPushResult> {
  const plan = PRICING_PLANS[params.planId];
  if (!plan) {
    throw new Error(`Invalid plan: ${params.planId}`);
  }

  const validPhone = sanitizeMpesaPhone(params.phoneNumber);

  const basePrice =
    params.billingCycle === "annual" ? plan.annualPrice.KES : plan.monthlyPrice.KES;
  const discountPercent = Math.min(100, Math.max(0, params.discountPercent || 0));
  const discountAmount = Number(((basePrice * discountPercent) / 100).toFixed(2));
  const finalPrice = Math.max(1, Math.round(basePrice - discountAmount)); // M-Pesa requires integer KES >= 1

  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
  const passkey = process.env.MPESA_PASSKEY;
  const shortcode = process.env.MPESA_SHORTCODE || "174379"; // Safaricom test shortcode
  const callbackUrl = process.env.MPESA_CALLBACK_URL || "https://api.geoquerry.com/api/webhooks/mpesa";

  // If Daraja credentials are not set (in dev/test sandbox), return realistic mock STK Push response
  if (!consumerKey || !consumerSecret || !passkey) {
    const mockCheckoutId = `ws_CO_${Date.now()}_mock_${params.planId}`;
    return {
      merchantRequestId: `MR_${Date.now()}_123`,
      checkoutRequestId: mockCheckoutId,
      responseCode: "0",
      responseDescription: "Success. Request accepted for processing",
      customerMessage: `Success. Please enter your M-Pesa PIN on phone ${validPhone} to complete KES ${finalPrice} for GeoQuerry ${plan.name}.`,
      amount: finalPrice,
      discountAmount,
      phoneNumber: validPhone,
    };
  }

  // 1. Get OAuth Access Token from Daraja
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
  const authUrl =
    process.env.MPESA_ENV === "production"
      ? "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials"
      : "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";

  const authRes = await fetch(authUrl, {
    headers: { Authorization: `Basic ${auth}` },
  });
  const authData: any = await authRes.json();
  const accessToken = authData.access_token;

  // 2. Generate Timestamp & Security Password
  const date = new Date();
  const timestamp =
    date.getFullYear().toString() +
    ("0" + (date.getMonth() + 1)).slice(-2) +
    ("0" + date.getDate()).slice(-2) +
    ("0" + date.getHours()).slice(-2) +
    ("0" + date.getMinutes()).slice(-2) +
    ("0" + date.getSeconds()).slice(-2);

  const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");

  // 3. Send STK Push Request
  const stkUrl =
    process.env.MPESA_ENV === "production"
      ? "https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest"
      : "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest";

  const stkRes = await fetch(stkUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: finalPrice,
      PartyA: validPhone,
      PartyB: shortcode,
      PhoneNumber: validPhone,
      CallBackURL: callbackUrl,
      AccountReference: `GeoQuerry-${params.planId.toUpperCase()}`,
      TransactionDesc: `Subscription for ${plan.name}`,
    }),
  });

  const stkData: any = await stkRes.json();

  if (stkData.ResponseCode !== "0") {
    throw new Error(stkData.errorMessage || stkData.ResponseDescription || "STK push initiation failed");
  }

  return {
    merchantRequestId: stkData.MerchantRequestID,
    checkoutRequestId: stkData.CheckoutRequestID,
    responseCode: stkData.ResponseCode,
    responseDescription: stkData.ResponseDescription,
    customerMessage: stkData.CustomerMessage,
    amount: finalPrice,
    discountAmount,
    phoneNumber: validPhone,
  };
}

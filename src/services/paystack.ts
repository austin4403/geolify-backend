import crypto from "crypto";
import { PRICING_PLANS } from "../routes/pricing";

export interface InitializePaystackParams {
  userId: string;
  userEmail: string;
  planId: "student" | "pro" | "premium" | "enterprise";
  billingCycle: "monthly" | "annual";
  currency: "USD" | "KES";
  discountPercent?: number;
  callbackUrl: string;
  metadata?: Record<string, any>;
}

export interface PaystackInitResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
  amount: number;
  currency: string;
  discountAmount: number;
}

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

/**
 * Initializes a Paystack transaction for global Cards (Visa/Mastercard/Apple Pay) in USD or KES.
 */
export async function initializePaystackTransaction(params: InitializePaystackParams): Promise<PaystackInitResult> {
  const plan = PRICING_PLANS[params.planId];
  if (!plan) {
    throw new Error(`Invalid plan: ${params.planId}`);
  }

  const basePrice =
    params.billingCycle === "annual"
      ? plan.annualPrice[params.currency] || plan.annualPrice.USD
      : plan.monthlyPrice[params.currency] || plan.monthlyPrice.USD;

  const discountPercent = Math.min(100, Math.max(0, params.discountPercent || 0));
  const discountAmount = Number(((basePrice * discountPercent) / 100).toFixed(2));
  const finalPrice = Number(Math.max(0, basePrice - discountAmount).toFixed(2));

  const reference = `geo_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  // Paystack expects amount in lowest currency unit (e.g. kobo/cents). For USD/KES, multiply by 100
  const amountInSmallestUnit = Math.round(finalPrice * 100);

  // If Paystack key is not set (mock/sandbox mode), return a simulated checkout URL
  if (!PAYSTACK_SECRET_KEY || PAYSTACK_SECRET_KEY.includes("placeholder")) {
    return {
      authorizationUrl: `${params.callbackUrl}?reference=${reference}&mock=true`,
      accessCode: `mock_access_${reference}`,
      reference,
      amount: finalPrice,
      currency: params.currency,
      discountAmount,
    };
  }

  const response = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: params.userEmail,
      amount: amountInSmallestUnit,
      currency: params.currency,
      reference,
      callback_url: params.callbackUrl,
      channels: ["card", "apple_pay", "bank_transfer", "mobile_money"],
      metadata: {
        userId: params.userId,
        planId: params.planId,
        billingCycle: params.billingCycle,
        discountPercent,
        ...params.metadata,
      },
    }),
  });

  const data = (await response.json()) as any;

  if (!response.ok || !data.status) {
    throw new Error(data.message || "Failed to initialize Paystack transaction");
  }

  return {
    authorizationUrl: data.data.authorization_url,
    accessCode: data.data.access_code,
    reference: data.data.reference || reference,
    amount: finalPrice,
    currency: params.currency,
    discountAmount,
  };
}

/**
 * Validates Paystack Webhook HMAC SHA512 signature
 */
export function verifyPaystackSignature(rawBody: string, signature: string): boolean {
  if (!PAYSTACK_SECRET_KEY || PAYSTACK_SECRET_KEY.includes("placeholder")) {
    return true; // Allow in local sandbox/test mode
  }

  const hash = crypto
    .createHmac("sha512", PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest("hex");

  return hash === signature;
}

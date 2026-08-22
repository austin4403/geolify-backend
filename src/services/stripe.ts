import Stripe from "stripe";
import { PRICING_PLANS } from "../routes/pricing";

const stripeApiKey = process.env.STRIPE_SECRET_KEY || "sk_test_placeholder_key_geoquerry";

export const stripe = new Stripe(stripeApiKey, {
  apiVersion: "2025-02-24.acacia" as any,
  typescript: true,
});

export interface CreateCheckoutParams {
  userId: string;
  userEmail?: string;
  planId: "pro" | "premium" | "enterprise";
  billingCycle: "monthly" | "annual";
  discountPercent?: number;
  successUrl: string;
  cancelUrl: string;
}

/**
 * Creates a Stripe Checkout Session with dynamic discount calculation
 */
export async function createStripeCheckoutSession(params: CreateCheckoutParams): Promise<{
  sessionId: string;
  url: string;
  amount: number;
  discountAmount: number;
}> {
  const plan = PRICING_PLANS[params.planId];
  if (!plan) {
    throw new Error(`Invalid plan: ${params.planId}`);
  }

  const basePrice =
    params.billingCycle === "annual" ? plan.annualPrice.USD : plan.monthlyPrice.USD;
  const discountPercent = Math.min(100, Math.max(0, params.discountPercent || 0));
  const discountAmount = Number(((basePrice * discountPercent) / 100).toFixed(2));
  const finalPrice = Number(Math.max(0, basePrice - discountAmount).toFixed(2));

  // If secret key is not set (in dev/test sandbox), return mock checkout URL
  if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.includes("placeholder")) {
    const mockSessionId = `cs_test_${Date.now()}_mock_${params.planId}`;
    return {
      sessionId: mockSessionId,
      url: `${params.successUrl}?session_id=${mockSessionId}&mock=true`,
      amount: finalPrice,
      discountAmount,
    };
  }

  const unitAmountInCents = Math.round(finalPrice * 100);

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "subscription",
    customer_email: params.userEmail,
    client_reference_id: params.userId,
    metadata: {
      userId: params.userId,
      planId: params.planId,
      billingCycle: params.billingCycle,
      discountPercent: String(discountPercent),
    },
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `GeoQuerry ${plan.name}`,
            description: `${plan.description} (${params.billingCycle} billing${
              discountPercent > 0 ? ` - ${discountPercent}% Discount Applied` : ""
            })`,
          },
          unit_amount: unitAmountInCents,
          recurring: {
            interval: params.billingCycle === "annual" ? "year" : "month",
          },
        },
        quantity: 1,
      },
    ],
    success_url: `${params.successUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: params.cancelUrl,
  });

  return {
    sessionId: session.id,
    url: session.url || "",
    amount: finalPrice,
    discountAmount,
  };
}

/**
 * Creates a Stripe Customer Billing Portal Session
 */
export async function createStripePortalSession(customerId: string, returnUrl: string): Promise<string> {
  if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.includes("placeholder")) {
    return `${returnUrl}?portal_mock=true`;
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  return session.url;
}

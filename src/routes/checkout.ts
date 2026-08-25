import { Router, Request, Response } from "express";
import { db } from "../db";
import { userProfiles, paymentTransactions, promoCodes } from "../db/schema";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { createStripeCheckoutSession, createStripePortalSession } from "../services/stripe";
import { initiateMpesaStkPush, sanitizeMpesaPhone } from "../services/mpesa";
import { initializePaystackTransaction } from "../services/paystack";

const router = Router();

const stripeCheckoutSchema = z.object({
  planId: z.enum(["pro", "premium", "enterprise"]),
  billingCycle: z.enum(["monthly", "annual"]).default("monthly"),
  promoCode: z.string().optional(),
  successUrl: z.string().url().default("http://localhost:3000/dashboard?upgrade=success"),
  cancelUrl: z.string().url().default("http://localhost:3000/pricing?upgrade=canceled"),
});

const paystackCheckoutSchema = z.object({
  planId: z.enum(["student", "pro", "premium", "enterprise"]),
  billingCycle: z.enum(["monthly", "annual"]).default("monthly"),
  currency: z.enum(["USD", "KES"]).default("USD"),
  promoCode: z.string().optional(),
  callbackUrl: z.string().url().default("http://localhost:3000/dashboard?payment=success"),
});

const mpesaStkSchema = z.object({
  planId: z.enum(["pro", "premium", "enterprise"]),
  billingCycle: z.enum(["monthly", "annual"]).default("monthly"),
  promoCode: z.string().optional(),
  phoneNumber: z.string().min(9, "Valid Safaricom phone number is required"),
});

// 1. POST /api/checkout/stripe/create-session - Initiate Stripe Card/Apple Pay Checkout
router.post("/stripe/create-session", requireAuth, async (req: Request, res: Response) => {
  try {
    const currentUserId = req.user!.userId;
    const userEmail = req.user?.email;
    const parsed = stripeCheckoutSchema.parse(req.body);

    const [profile] = await db
      .select({
        benefitTier: userProfiles.benefitTier,
        discountPercent: userProfiles.discountPercent,
      })
      .from(userProfiles)
      .where(eq(userProfiles.userId, currentUserId))
      .limit(1);

    // If user is Core Dev, tier is already 100% free
    if (profile?.benefitTier === "core_dev") {
      res.json({
        status: "free",
        message: "You belong to the Core Developer team. Your plan is 100% Free Forever!",
        url: parsed.successUrl,
      });
      return;
    }

    const tierDiscountPercent = profile?.discountPercent || 0;
    let promoDiscountPercent = 0;
    let appliedPromoCode: string | null = null;

    if (parsed.promoCode) {
      const codeClean = parsed.promoCode.trim().toUpperCase();
      const [foundPromo] = await db
        .select()
        .from(promoCodes)
        .where(sql`UPPER(${promoCodes.code}) = ${codeClean}`)
        .limit(1);

      if (!foundPromo || !foundPromo.isActive) {
        res.status(400).json({ error: `Promo voucher '${codeClean}' is invalid or inactive.` });
        return;
      }
      if (foundPromo.expiresAt && new Date(foundPromo.expiresAt) < new Date()) {
        res.status(400).json({ error: `Promo voucher '${codeClean}' has expired.` });
        return;
      }
      if (foundPromo.maxUses !== null && foundPromo.timesUsed >= foundPromo.maxUses) {
        res.status(400).json({ error: `Promo voucher '${codeClean}' has reached redemption limit.` });
        return;
      }
      promoDiscountPercent = foundPromo.discountPercent;
      appliedPromoCode = foundPromo.code;
    }

    // Multiplicative stacking on remainder
    const tierMultiplier = 1 - tierDiscountPercent / 100;
    const promoMultiplier = 1 - promoDiscountPercent / 100;
    const combinedMultiplier = tierMultiplier * promoMultiplier;
    const combinedDiscountPercent = Math.min(100, Math.max(0, Number(((1 - combinedMultiplier) * 100).toFixed(2))));

    const result = await createStripeCheckoutSession({
      userId: currentUserId,
      userEmail,
      planId: parsed.planId,
      billingCycle: parsed.billingCycle,
      discountPercent: combinedDiscountPercent,
      successUrl: parsed.successUrl,
      cancelUrl: parsed.cancelUrl,
    });

    // Record pending transaction
    await db.insert(paymentTransactions).values({
      userId: currentUserId,
      provider: "stripe",
      transactionRef: result.sessionId,
      planId: parsed.planId,
      billingCycle: parsed.billingCycle,
      currency: "USD",
      amount: result.amount,
      discountAmount: result.discountAmount,
      status: "pending",
      metadata: { sessionId: result.sessionId, discountPercent: combinedDiscountPercent },
    });

    res.json({
      status: "success",
      provider: "stripe",
      sessionId: result.sessionId,
      checkoutUrl: result.url,
      amount: result.amount,
      discountAmount: result.discountAmount,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues });
      return;
    }
    res.status(500).json({ error: "Stripe checkout session failed: " + error.message });
  }
});

// 2. POST /api/checkout/stripe/customer-portal - Stripe Customer Billing Portal
router.post("/stripe/customer-portal", requireAuth, async (req: Request, res: Response) => {
  try {
    const currentUserId = req.user!.userId;
    const returnUrl = (req.body.returnUrl as string) || "http://localhost:3000/dashboard/settings";

    const [profile] = await db
      .select({
        paymentCustomerId: userProfiles.paymentCustomerId,
      })
      .from(userProfiles)
      .where(eq(userProfiles.userId, currentUserId))
      .limit(1);

    if (!profile?.paymentCustomerId) {
      res.status(400).json({
        error: "No active Stripe customer billing profile found. Please subscribe first.",
      });
      return;
    }

    const portalUrl = await createStripePortalSession(profile.paymentCustomerId, returnUrl);
    res.json({ portalUrl });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to open billing portal: " + error.message });
  }
});

// 3. POST /api/checkout/mpesa/stk-push - Send M-Pesa Prompt to Mobile Phone
router.post("/mpesa/stk-push", requireAuth, async (req: Request, res: Response) => {
  try {
    const currentUserId = req.user!.userId;
    const parsed = mpesaStkSchema.parse(req.body);

    const [profile] = await db
      .select({
        benefitTier: userProfiles.benefitTier,
        discountPercent: userProfiles.discountPercent,
      })
      .from(userProfiles)
      .where(eq(userProfiles.userId, currentUserId))
      .limit(1);

    if (profile?.benefitTier === "core_dev") {
      res.json({
        status: "free",
        message: "You belong to the Core Developer team. Your plan is 100% Free Forever!",
      });
      return;
    }

    const tierDiscountPercent = profile?.discountPercent || 0;
    let promoDiscountPercent = 0;
    let appliedPromoCode: string | null = null;

    if (parsed.promoCode) {
      const codeClean = parsed.promoCode.trim().toUpperCase();
      const [foundPromo] = await db
        .select()
        .from(promoCodes)
        .where(sql`UPPER(${promoCodes.code}) = ${codeClean}`)
        .limit(1);

      if (!foundPromo || !foundPromo.isActive) {
        res.status(400).json({ error: `Promo voucher '${codeClean}' is invalid or inactive.` });
        return;
      }
      if (foundPromo.expiresAt && new Date(foundPromo.expiresAt) < new Date()) {
        res.status(400).json({ error: `Promo voucher '${codeClean}' has expired.` });
        return;
      }
      if (foundPromo.maxUses !== null && foundPromo.timesUsed >= foundPromo.maxUses) {
        res.status(400).json({ error: `Promo voucher '${codeClean}' has reached redemption limit.` });
        return;
      }
      promoDiscountPercent = foundPromo.discountPercent;
      appliedPromoCode = foundPromo.code;
    }

    // Multiplicative stacking on remainder
    const tierMultiplier = 1 - tierDiscountPercent / 100;
    const promoMultiplier = 1 - promoDiscountPercent / 100;
    const combinedMultiplier = tierMultiplier * promoMultiplier;
    const combinedDiscountPercent = Math.min(100, Math.max(0, Number(((1 - combinedMultiplier) * 100).toFixed(2))));

    const stkResult = await initiateMpesaStkPush({
      userId: currentUserId,
      phoneNumber: parsed.phoneNumber,
      planId: parsed.planId,
      billingCycle: parsed.billingCycle,
      discountPercent: combinedDiscountPercent,
    });

    // Record pending M-Pesa transaction
    await db.insert(paymentTransactions).values({
      userId: currentUserId,
      provider: "mpesa",
      transactionRef: stkResult.checkoutRequestId,
      planId: parsed.planId,
      billingCycle: parsed.billingCycle,
      currency: "KES",
      amount: stkResult.amount,
      discountAmount: stkResult.discountAmount,
      phoneNumber: stkResult.phoneNumber,
      status: "pending",
      metadata: {
        merchantRequestId: stkResult.merchantRequestId,
        checkoutRequestId: stkResult.checkoutRequestId,
      },
    });

    res.json({
      status: "success",
      provider: "mpesa",
      checkoutRequestId: stkResult.checkoutRequestId,
      customerMessage: stkResult.customerMessage,
      amount: stkResult.amount,
      discountAmount: stkResult.discountAmount,
      phoneNumber: stkResult.phoneNumber,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues });
      return;
    }
    res.status(500).json({ error: "M-Pesa STK Push failed: " + error.message });
  }
});

// 4. POST /api/checkout/paystack/initialize - Global Card / Apple Pay Checkout via Paystack
router.post("/paystack/initialize", requireAuth, async (req: Request, res: Response) => {
  try {
    const currentUserId = req.user!.userId;
    const userEmail = req.user?.email || "customer@geoquerry.com";
    const parsed = paystackCheckoutSchema.parse(req.body);

    const [profile] = await db
      .select({
        benefitTier: userProfiles.benefitTier,
        discountPercent: userProfiles.discountPercent,
      })
      .from(userProfiles)
      .where(eq(userProfiles.userId, currentUserId))
      .limit(1);

    if (profile?.benefitTier === "core_dev") {
      res.json({
        status: "free",
        message: "You belong to the Core Developer team. Your plan is 100% Free Forever!",
        authorizationUrl: parsed.callbackUrl,
      });
      return;
    }

    const tierDiscountPercent = profile?.discountPercent || 0;
    let promoDiscountPercent = 0;

    if (parsed.promoCode) {
      const codeClean = parsed.promoCode.trim().toUpperCase();
      const [foundPromo] = await db
        .select()
        .from(promoCodes)
        .where(sql`UPPER(${promoCodes.code}) = ${codeClean}`)
        .limit(1);

      if (!foundPromo || !foundPromo.isActive) {
        res.status(400).json({ error: `Promo voucher '${codeClean}' is invalid or inactive.` });
        return;
      }
      if (foundPromo.expiresAt && new Date(foundPromo.expiresAt) < new Date()) {
        res.status(400).json({ error: `Promo voucher '${codeClean}' has expired.` });
        return;
      }
      if (foundPromo.maxUses !== null && foundPromo.timesUsed >= foundPromo.maxUses) {
        res.status(400).json({ error: `Promo voucher '${codeClean}' has reached redemption limit.` });
        return;
      }
      promoDiscountPercent = foundPromo.discountPercent;
    }

    // Multiplicative stacking
    const tierMultiplier = 1 - tierDiscountPercent / 100;
    const promoMultiplier = 1 - promoDiscountPercent / 100;
    const combinedMultiplier = tierMultiplier * promoMultiplier;
    const combinedDiscountPercent = Math.min(100, Math.max(0, Number(((1 - combinedMultiplier) * 100).toFixed(2))));

    const paystackResult = await initializePaystackTransaction({
      userId: currentUserId,
      userEmail,
      planId: parsed.planId as any,
      billingCycle: parsed.billingCycle,
      currency: parsed.currency,
      discountPercent: combinedDiscountPercent,
      callbackUrl: parsed.callbackUrl,
    });

    // Record pending transaction
    await db.insert(paymentTransactions).values({
      userId: currentUserId,
      provider: "paystack",
      transactionRef: paystackResult.reference,
      planId: parsed.planId,
      billingCycle: parsed.billingCycle,
      currency: parsed.currency,
      amount: paystackResult.amount,
      discountAmount: paystackResult.discountAmount,
      status: "pending",
      metadata: {
        accessCode: paystackResult.accessCode,
        discountPercent: combinedDiscountPercent,
      },
    });

    res.json({
      status: "success",
      provider: "paystack",
      reference: paystackResult.reference,
      authorizationUrl: paystackResult.authorizationUrl,
      amount: paystackResult.amount,
      currency: paystackResult.currency,
      discountAmount: paystackResult.discountAmount,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues });
      return;
    }
    res.status(500).json({ error: "Paystack initialization failed: " + error.message });
  }
});

// 5. GET /api/checkout/mpesa/status/:checkoutRequestId - Check M-Pesa Payment Status
router.get("/mpesa/status/:checkoutRequestId", requireAuth, async (req: Request, res: Response) => {
  try {
    const rawRef = req.params.checkoutRequestId as string;

    const [tx] = await db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.transactionRef, rawRef))
      .limit(1);

    if (!tx) {
      res.status(404).json({ error: "Transaction reference not found." });
      return;
    }

    res.json({
      checkoutRequestId: tx.transactionRef,
      status: tx.status,
      planId: tx.planId,
      amount: tx.amount,
      currency: tx.currency,
      mpesaReceiptNumber: tx.mpesaReceiptNumber,
      updatedAt: tx.updatedAt,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

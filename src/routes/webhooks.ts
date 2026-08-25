import { Router, Request, Response } from "express";
import { db } from "../db";
import { userProfiles, paymentTransactions } from "../db/schema";
import { eq } from "drizzle-orm";
import { stripe } from "../services/stripe";
import { verifyPaystackSignature } from "../services/paystack";

const router = Router();

// 1. POST /api/webhooks/stripe - Stripe Webhook Listener
router.post("/stripe", async (req: Request, res: Response) => {
  const sig = req.headers["stripe-signature"] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event: any;

  try {
    if (webhookSecret && sig) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      // In development/test mode without webhook signature secret
      event = req.body;
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data?.object || event;
        const userId = session.client_reference_id || session.metadata?.userId;
        const planId = session.metadata?.planId || "pro";
        const billingCycle = session.metadata?.billingCycle || "monthly";
        const customerId = session.customer as string;

        if (userId) {
          const expiresAt = new Date();
          expiresAt.setDate(expiresAt.getDate() + (billingCycle === "annual" ? 365 : 30));

          try {
            // 1. Update user profile subscription
            await db
              .update(userProfiles)
              .set({
                subscriptionTier: planId,
                subscriptionStatus: "active",
                subscriptionExpiresAt: expiresAt,
                paymentProvider: "stripe",
                paymentCustomerId: customerId || undefined,
                updatedAt: new Date(),
              })
              .where(eq(userProfiles.userId, userId));

            // 2. Mark transaction completed
            if (session.id) {
              await db
                .update(paymentTransactions)
                .set({
                  status: "completed",
                  metadata: { sessionData: session },
                  updatedAt: new Date(),
                })
                .where(eq(paymentTransactions.transactionRef, session.id));
            }
          } catch (dbErr: any) {
            console.warn("[Stripe Webhook] Database update warning (handled):", dbErr.message);
          }
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data?.object || event;
        const customerId = sub.customer as string;

        if (customerId) {
          try {
            await db
              .update(userProfiles)
              .set({
                subscriptionTier: "free",
                subscriptionStatus: "canceled",
                updatedAt: new Date(),
              })
              .where(eq(userProfiles.paymentCustomerId, customerId));
          } catch (dbErr: any) {
            console.warn("[Stripe Webhook] DB warning:", dbErr.message);
          }
        }
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data?.object || event;
        const customerId = sub.customer as string;
        const status = sub.status === "active" ? "active" : "past_due";

        if (customerId) {
          try {
            await db
              .update(userProfiles)
              .set({
                subscriptionStatus: status,
                updatedAt: new Date(),
              })
              .where(eq(userProfiles.paymentCustomerId, customerId));
          } catch (dbErr: any) {
            console.warn("[Stripe Webhook] DB warning:", dbErr.message);
          }
        }
        break;
      }
    }

    res.json({ received: true });
  } catch (err: any) {
    res.status(400).send(`Stripe Webhook Error: ${err.message}`);
  }
});

// 2. POST /api/webhooks/mpesa - Safaricom Daraja STK Callback Listener
router.post("/mpesa", async (req: Request, res: Response) => {
  try {
    const body = req.body;
    const stkCallback = body?.Body?.stkCallback || body?.stkCallback || body;

    const resultCode = stkCallback?.ResultCode;
    const checkoutRequestId = stkCallback?.CheckoutRequestID;

    if (!checkoutRequestId) {
      res.json({ ResultCode: 0, ResultDesc: "Accepted" });
      return;
    }

    try {
      // 1. Find transaction in ledger
      const [tx] = await db
        .select()
        .from(paymentTransactions)
        .where(eq(paymentTransactions.transactionRef, checkoutRequestId))
        .limit(1);

      if (resultCode === 0) {
        // Payment Successful
        let mpesaReceiptNumber = "";
        let phoneNumber = "";

        const items = stkCallback?.CallbackMetadata?.Item || [];
        for (const item of items) {
          if (item.Name === "MpesaReceiptNumber") {
            mpesaReceiptNumber = String(item.Value);
          } else if (item.Name === "PhoneNumber") {
            phoneNumber = String(item.Value);
          }
        }

        const billingCycle = tx?.billingCycle || "monthly";
        const planId = tx?.planId || "pro";

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + (billingCycle === "annual" ? 365 : 30));

        // 2. Update user profile subscription
        if (tx?.userId) {
          await db
            .update(userProfiles)
            .set({
              subscriptionTier: planId,
              subscriptionStatus: "active",
              subscriptionExpiresAt: expiresAt,
              paymentProvider: "mpesa",
              paymentCustomerId: phoneNumber || tx.phoneNumber || undefined,
              updatedAt: new Date(),
            })
            .where(eq(userProfiles.userId, tx.userId));
        }

        // 3. Mark transaction completed
        await db
          .update(paymentTransactions)
          .set({
            status: "completed",
            mpesaReceiptNumber: mpesaReceiptNumber || `MPESA_${Date.now()}`,
            metadata: { callback: stkCallback },
            updatedAt: new Date(),
          })
          .where(eq(paymentTransactions.transactionRef, checkoutRequestId));
      } else {
        // Payment Failed / Cancelled by user
        await db
          .update(paymentTransactions)
          .set({
            status: "failed",
            metadata: { callback: stkCallback, failureReason: stkCallback?.ResultDesc },
            updatedAt: new Date(),
          })
          .where(eq(paymentTransactions.transactionRef, checkoutRequestId));
      }
    } catch (dbErr: any) {
      console.warn("[M-Pesa Webhook] Database update warning (handled):", dbErr.message);
    }

    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (error: any) {
    res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted with warnings" });
  }
});

// 3. POST /api/webhooks/paystack - Paystack Global Cards & Mobile Money Callback Listener
router.post("/paystack", async (req: Request, res: Response) => {
  try {
    const signature = req.headers["x-paystack-signature"] as string;
    const body = req.body;

    // Verify HMAC SHA512 signature in production
    const isSignatureValid = verifyPaystackSignature(JSON.stringify(body), signature);
    if (!isSignatureValid) {
      res.status(400).send("Invalid Paystack webhook signature");
      return;
    }

    const event = body?.event;
    const data = body?.data;

    if (event === "charge.success" && data) {
      const reference = data.reference;
      const userId = data.metadata?.userId;
      const planId = data.metadata?.planId || "pro";
      const billingCycle = data.metadata?.billingCycle || "monthly";
      const customerCode = data.customer?.customer_code || data.customer?.email;

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + (billingCycle === "annual" ? 365 : 30));

      if (userId) {
        try {
          // 1. Update user profile subscription
          await db
            .update(userProfiles)
            .set({
              subscriptionTier: planId,
              subscriptionStatus: "active",
              subscriptionExpiresAt: expiresAt,
              paymentProvider: "paystack",
              paymentCustomerId: customerCode || undefined,
              updatedAt: new Date(),
            })
            .where(eq(userProfiles.userId, userId));

          // 2. Mark transaction completed
          if (reference) {
            await db
              .update(paymentTransactions)
              .set({
                status: "completed",
                metadata: { paystackData: data },
                updatedAt: new Date(),
              })
              .where(eq(paymentTransactions.transactionRef, reference));
          }
        } catch (dbErr: any) {
          console.warn("[Paystack Webhook] Database update warning (handled):", dbErr.message);
        }
      }
    }

    res.sendStatus(200);
  } catch (error: any) {
    res.status(200).send("Paystack webhook received with warnings");
  }
});

export default router;

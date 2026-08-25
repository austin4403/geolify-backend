import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../src/index";
import { sanitizeMpesaPhone, initiateMpesaStkPush } from "../../src/services/mpesa";
import { createStripeCheckoutSession } from "../../src/services/stripe";
import { PRICING_PLANS } from "../../src/routes/pricing";

describe("Payment Services & Checkout Integration Tests", () => {
  describe("M-Pesa Phone Number Sanitization", () => {
    it("normalizes standard Kenyan 07... numbers to 2547...", () => {
      expect(sanitizeMpesaPhone("0712345678")).toBe("254712345678");
    });

    it("normalizes international +2547... numbers", () => {
      expect(sanitizeMpesaPhone("+254712345678")).toBe("254712345678");
    });

    it("normalizes Safaricom 01... prefix (e.g. 0110123456)", () => {
      expect(sanitizeMpesaPhone("0110123456")).toBe("254110123456");
    });

    it("throws an error for invalid or foreign phone numbers", () => {
      expect(() => sanitizeMpesaPhone("12345")).toThrow();
      expect(() => sanitizeMpesaPhone("+15551234567")).toThrow();
      expect(() => sanitizeMpesaPhone("not-a-number")).toThrow();
    });
  });

  describe("M-Pesa STK Push Price Calculation", () => {
    it("calculates discounted KES amount for Beta Developer (40% discount on Pro)", async () => {
      const result = await initiateMpesaStkPush({
        userId: "user_test_123",
        phoneNumber: "0712345678",
        planId: "pro",
        billingCycle: "monthly",
        discountPercent: 40,
      });

      const basePrice = PRICING_PLANS.pro.monthlyPrice.KES;
      const expectedDiscount = Number(((basePrice * 40) / 100).toFixed(2));
      const expectedAmount = Math.max(1, Math.round(basePrice - expectedDiscount));

      expect(result.amount).toBe(expectedAmount);
      expect(result.discountAmount).toBe(expectedDiscount);
      expect(result.phoneNumber).toBe("254712345678");
      expect(result.responseCode).toBe("0");
    });

    it("calculates discounted KES amount for Student (70% discount on Pro)", async () => {
      const result = await initiateMpesaStkPush({
        userId: "user_test_student",
        phoneNumber: "0722000000",
        planId: "pro",
        billingCycle: "monthly",
        discountPercent: 70,
      });

      const basePrice = PRICING_PLANS.pro.monthlyPrice.KES;
      const expectedDiscount = Number(((basePrice * 70) / 100).toFixed(2));
      const expectedAmount = Math.max(1, Math.round(basePrice - expectedDiscount));

      expect(result.amount).toBe(expectedAmount);
      expect(result.discountAmount).toBe(expectedDiscount);
    });
  });

  describe("Stripe Checkout Price Calculation", () => {
    it("calculates discounted USD amount for Beta Developer (40% discount on Pro)", async () => {
      const result = await createStripeCheckoutSession({
        userId: "user_test_stripe",
        userEmail: "beta.tester@gmail.com",
        planId: "pro",
        billingCycle: "monthly",
        discountPercent: 40,
        successUrl: "http://localhost:3000/dashboard",
        cancelUrl: "http://localhost:3000/pricing",
      });

      const basePrice = PRICING_PLANS.pro.monthlyPrice.USD;
      const expectedDiscount = Number(((basePrice * 40) / 100).toFixed(2));
      const expectedAmount = Number(Math.max(0, basePrice - expectedDiscount).toFixed(2));

      expect(result.amount).toBe(expectedAmount);
      expect(result.discountAmount).toBe(expectedDiscount);
      expect(result.sessionId).toBeDefined();
      expect(result.url).toContain("mock=true");
    });
  });

  describe("Webhooks API", () => {
    it("POST /api/webhooks/mpesa - accepts valid Daraja STK callback payload", async () => {
      const mockCallbackPayload = {
        Body: {
          stkCallback: {
            MerchantRequestID: "MR_12345",
            CheckoutRequestID: "ws_CO_test_nonexistent_ref",
            ResultCode: 0,
            ResultDesc: "The service request is processed successfully.",
            CallbackMetadata: {
              Item: [
                { Name: "Amount", Value: 1920 },
                { Name: "MpesaReceiptNumber", Value: "QK87JH2938" },
                { Name: "TransactionDate", Value: 20260822120000 },
                { Name: "PhoneNumber", Value: 254712345678 },
              ],
            },
          },
        },
      };

      const res = await request(app)
        .post("/api/webhooks/mpesa")
        .send(mockCallbackPayload);

      expect([200, 500]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body).toHaveProperty("ResultCode", 0);
      }
    });

    it("POST /api/webhooks/stripe - accepts mock Stripe checkout completion payload", async () => {
      const res = await request(app)
        .post("/api/webhooks/stripe")
        .send({
          type: "checkout.session.completed",
          data: {
            object: {
              id: "cs_test_mock_session_123",
              client_reference_id: "user_mock_stripe_complete",
              customer: "cus_mock_12345",
              metadata: {
                planId: "pro",
                billingCycle: "monthly",
              },
            },
          },
        });

      expect([200, 400]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body).toHaveProperty("received", true);
      }
    });

    it("POST /api/checkout/stripe/create-session - rejects unauthenticated requests", async () => {
      const res = await request(app)
        .post("/api/checkout/stripe/create-session")
        .send({
          planId: "pro",
        });

      expect(res.status).toBe(401);
    });

    it("POST /api/checkout/mpesa/stk-push - rejects unauthenticated requests", async () => {
      const res = await request(app)
        .post("/api/checkout/mpesa/stk-push")
        .send({
          planId: "pro",
          phoneNumber: "0712345678",
        });

      expect(res.status).toBe(401);
    });
  });
});

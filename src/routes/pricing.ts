import { Router, Request, Response } from "express";
import { db } from "../db";
import { userProfiles, promoCodes } from "../db/schema";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";

const router = Router();

export interface PlanDefinition {
  id: "free" | "pro" | "premium" | "enterprise";
  name: string;
  description: string;
  monthlyPrice: {
    USD: number;
    KES: number;
  };
  annualPrice: {
    USD: number;
    KES: number;
  };
  features: string[];
  limits: {
    maxProjects: number | "unlimited";
    maxStationsPerProject: number | "unlimited";
    maxStorageMb: number | "unlimited";
    offlineSync: boolean;
    sseRealtime: boolean;
    geoJsonExport: boolean;
    advancedGeophysics: boolean;
  };
}

export const PRICING_PLANS: Record<string, PlanDefinition> = {
  free: {
    id: "free",
    name: "Free Explorer",
    description: "Ideal for student coursework, initial outcrop reconnaissance, and hobbyist geology.",
    monthlyPrice: { USD: 0, KES: 0 },
    annualPrice: { USD: 0, KES: 0 },
    features: [
      "Up to 3 Geological Projects",
      "50 Field Stations per project",
      "Basic CSV Data Export",
      "Standard Offline Ingestion",
    ],
    limits: {
      maxProjects: 3,
      maxStationsPerProject: 50,
      maxStorageMb: 500,
      offlineSync: true,
      sseRealtime: false,
      geoJsonExport: false,
      advancedGeophysics: false,
    },
  },
  pro: {
    id: "pro",
    name: "Professional",
    description: "For exploration geologists, hydrogeology consultants, and drilling survey teams.",
    monthlyPrice: { USD: 25, KES: 3200 },
    annualPrice: { USD: 240, KES: 30000 },
    features: [
      "Unlimited Geological Projects & Stations",
      "Full GeoJSON & Shapefile Map Layer Exports",
      "VES Geophysical Sounding & Pumping Test Inversion",
      "Real-Time SSE Teammate Field Tracking",
      "High-Resolution Rock Sample Cloud Storage",
    ],
    limits: {
      maxProjects: "unlimited",
      maxStationsPerProject: "unlimited",
      maxStorageMb: 50000,
      offlineSync: true,
      sseRealtime: true,
      geoJsonExport: true,
      advancedGeophysics: true,
    },
  },
  premium: {
    id: "premium",
    name: "Enterprise",
    description: "For mining exploration corporations, government ministries, and drilling contractors.",
    monthlyPrice: { USD: 80, KES: 10000 },
    annualPrice: { USD: 780, KES: 96000 },
    features: [
      "Everything in Pro with Multi-User Collaboration",
      "Unlimited Collaborators per Project",
      "Custom S3 / Cloudflare R2 Cloud Storage Buckets",
      "Team Live Messaging & Presence",
      "Priority Support & SLA",
    ],
    limits: {
      maxProjects: "unlimited",
      maxStationsPerProject: "unlimited",
      maxStorageMb: "unlimited",
      offlineSync: true,
      sseRealtime: true,
      geoJsonExport: true,
      advancedGeophysics: true,
    },
  },
};

// 1. GET /api/pricing/plans - List all publicly available tiers and pricing
router.get("/plans", (_req: Request, res: Response) => {
  res.json({
    status: "success",
    currencyOptions: ["USD", "KES"],
    plans: Object.values(PRICING_PLANS),
  });
});

// 2. GET /api/pricing/quote - Calculate personalized discount quote for user
router.get("/quote", async (req: Request, res: Response) => {
  try {
    const planId = (req.query.plan as string) || "pro";
    const currency = ((req.query.currency as string) || "USD").toUpperCase() as "USD" | "KES";
    const billingCycle = (req.query.cycle as string) === "annual" ? "annual" : "monthly";

    const plan = PRICING_PLANS[planId];
    if (!plan) {
      res.status(400).json({ error: `Invalid plan '${planId}'. Available: free, pro, premium` });
      return;
    }

    const currentUserId = req.user?.userId || (req.headers["x-user-id"] as string);
    let discountPercent = 0;
    let benefitTier = "standard";

    if (currentUserId) {
      const [profile] = await db
        .select({
          benefitTier: userProfiles.benefitTier,
          discountPercent: userProfiles.discountPercent,
          subscriptionTier: userProfiles.subscriptionTier,
        })
        .from(userProfiles)
        .where(eq(userProfiles.userId, currentUserId))
        .limit(1);

      if (profile) {
        discountPercent = profile.discountPercent || 0;
        benefitTier = profile.benefitTier || "standard";
      }
    }

    const basePrice =
      billingCycle === "annual"
        ? plan.annualPrice[currency] || plan.annualPrice.USD
        : plan.monthlyPrice[currency] || plan.monthlyPrice.USD;

    const discountAmount = Number(((basePrice * discountPercent) / 100).toFixed(2));
    const finalPrice = Number(Math.max(0, basePrice - discountAmount).toFixed(2));

    res.json({
      plan: plan.id,
      planName: plan.name,
      billingCycle,
      currency,
      basePrice,
      benefitTier,
      discountPercent,
      discountAmount,
      finalPrice,
      isFreeDueToCoreDev: benefitTier === "core_dev",
      supportedPaymentGateways: currency === "KES" ? ["mpesa", "card_paystack", "stripe"] : ["stripe", "apple_pay", "google_pay"],
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to generate price quote: " + error.message });
  }
});


// 3. POST /api/pricing/validate-promo - Validate a promo / voucher code
router.post("/validate-promo", async (req: Request, res: Response) => {
  try {
    const rawCode = ((req.body.code as string) || "").trim().toUpperCase();
    if (!rawCode) {
      res.status(400).json({ error: "Promo code is required" });
      return;
    }

    const [promo] = await db
      .select()
      .from(promoCodes)
      .where(sql`UPPER(${promoCodes.code}) = ${rawCode}`)
      .limit(1);

    if (!promo) {
      res.status(404).json({ error: "Promo code does not exist or is invalid." });
      return;
    }

    if (!promo.isActive) {
      res.status(400).json({ error: "Promo code is currently inactive or disabled." });
      return;
    }

    if (promo.expiresAt && new Date(promo.expiresAt) < new Date()) {
      res.status(400).json({ error: "Promo code has expired." });
      return;
    }

    if (promo.maxUses !== null && promo.timesUsed >= promo.maxUses) {
      res.status(400).json({ error: "Promo code has reached its maximum usage limit." });
      return;
    }

    res.json({
      status: "success",
      valid: true,
      data: {
        code: promo.code,
        discountPercent: promo.discountPercent,
        description: promo.description || promo.discountPercent + "% Discount",
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to validate promo code: " + error.message });
  }
});

export default router;

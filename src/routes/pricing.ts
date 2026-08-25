import { Router, Request, Response } from "express";
import { db } from "../db";
import { userProfiles, promoCodes } from "../db/schema";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";

const router = Router();

export interface PlanDefinition {
  id: "free" | "student" | "pro" | "premium" | "enterprise";
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

export const KES_PER_USD = 130;
export const ANNUAL_DISCOUNT_PERCENT = 20; // 20% discount on annual plans

/**
 * Automatically computes full pricing matrix (Monthly USD, Annual KES, Annual USD)
 * from a single Monthly KES rate.
 */
export function calculatePlanPricingFromMonthlyKes(monthlyKes: number): {
  monthlyPrice: { USD: number; KES: number };
  annualPrice: { USD: number; KES: number };
} {
  const kes = Math.max(0, Number(monthlyKes) || 0);
  if (kes === 0) {
    return {
      monthlyPrice: { USD: 0, KES: 0 },
      annualPrice: { USD: 0, KES: 0 },
    };
  }

  const monthlyUsd = Math.max(1, Math.round(kes / KES_PER_USD));
  const annualKes = Math.round(kes * 12 * (1 - ANNUAL_DISCOUNT_PERCENT / 100));
  const annualUsd = Math.round(monthlyUsd * 12 * (1 - ANNUAL_DISCOUNT_PERCENT / 100));

  return {
    monthlyPrice: { USD: monthlyUsd, KES: kes },
    annualPrice: { USD: annualUsd, KES: annualKes },
  };
}

export const TIER_RATIOS = {
  free: 0,
  student: 0.15, // 15% of Enterprise (Academic research grant rate)
  pro: 0.50,     // 50% of Enterprise (Professional single-seat exploration rate)
  premium: 1.0,  // 100% Master Enterprise rate (The single master price input)
};

export let MASTER_ENTERPRISE_RATE_KES = 2000;

/**
 * Recalculates all tiers dynamically from ONE single Enterprise monthly price value
 */
export function applyMasterEnterpriseRate(enterpriseMonthlyKes: number) {
  const masterKes = Math.max(100, Number(enterpriseMonthlyKes) || 2000);
  MASTER_ENTERPRISE_RATE_KES = masterKes;

  for (const [tierId, ratio] of Object.entries(TIER_RATIOS)) {
    if (!PRICING_PLANS[tierId]) continue;
    const tierKes = Math.round(masterKes * ratio);
    const computed = calculatePlanPricingFromMonthlyKes(tierKes);
    PRICING_PLANS[tierId].monthlyPrice = computed.monthlyPrice;
    PRICING_PLANS[tierId].annualPrice = computed.annualPrice;
  }

  return {
    masterEnterpriseRateKes: MASTER_ENTERPRISE_RATE_KES,
    plans: Object.values(PRICING_PLANS),
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
  student: {
    id: "student",
    name: "Student Academic",
    description: "Subsidized research & thesis mapping for earth science students.",
    monthlyPrice: { USD: 3, KES: 450 },
    annualPrice: { USD: 30, KES: 4500 },
    features: [
      "All Professional GIS Features Included",
      "Unlimited Geological Stations & Outcrops",
      "Borehole Pumping Tests & Drawdown Curves",
      "Strike & Dip Stereonet Projections",
      "Export GeoJSON, Shapefiles & PDF Reports",
      "1-Year Verified Academic License",
    ],
    limits: {
      maxProjects: "unlimited",
      maxStationsPerProject: "unlimited",
      maxStorageMb: 5000,
      offlineSync: true,
      sseRealtime: true,
      geoJsonExport: true,
      advancedGeophysics: true,
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
    monthlyPrice: { USD: 15, KES: 2000 },
    annualPrice: { USD: 144, KES: 19200 },
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

// Initialize all tier rates dynamically from the master enterprise rate
applyMasterEnterpriseRate(MASTER_ENTERPRISE_RATE_KES);

// 1. GET /api/pricing/plans - List all publicly available tiers and pricing
router.get("/plans", (_req: Request, res: Response) => {
  res.json({
    status: "success",
    masterEnterpriseRateKes: MASTER_ENTERPRISE_RATE_KES,
    tierRatios: TIER_RATIOS,
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
      res.status(400).json({ error: `Invalid plan '${planId}'. Available: ${Object.keys(PRICING_PLANS).join(", ")}` });
      return;
    }

    const currentUserId = req.user?.userId || (req.headers["x-user-id"] as string);
    let tierDiscountPercent = 0;
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
        tierDiscountPercent = profile.discountPercent || 0;
        benefitTier = profile.benefitTier || "standard";
      }
    }

    // Optional single Promo Code lookup with multiplicative discount stacking
    const promoQuery = ((req.query.promo as string) || (req.query.promoCode as string) || "").trim().toUpperCase();
    let promoDiscountPercent = 0;
    let appliedPromo: { code: string; discountPercent: number; description?: string | null } | null = null;

    if (promoQuery) {
      const [foundPromo] = await db
        .select()
        .from(promoCodes)
        .where(sql`UPPER(${promoCodes.code}) = ${promoQuery}`)
        .limit(1);

      if (foundPromo && foundPromo.isActive) {
        const isNotExpired = !foundPromo.expiresAt || new Date(foundPromo.expiresAt) > new Date();
        const hasUsesLeft = foundPromo.maxUses === null || foundPromo.timesUsed < foundPromo.maxUses;
        if (isNotExpired && hasUsesLeft) {
          promoDiscountPercent = foundPromo.discountPercent;
          appliedPromo = {
            code: foundPromo.code,
            discountPercent: foundPromo.discountPercent,
            description: foundPromo.description,
          };
        }
      }
    }

    const basePrice =
      billingCycle === "annual"
        ? plan.annualPrice[currency] || plan.annualPrice.USD
        : plan.monthlyPrice[currency] || plan.monthlyPrice.USD;

    // Multiplicative stacking: Final = Base * (1 - tier_discount) * (1 - promo_discount)
    const tierMultiplier = 1 - tierDiscountPercent / 100;
    const promoMultiplier = 1 - promoDiscountPercent / 100;
    const combinedMultiplier = tierMultiplier * promoMultiplier;
    const combinedDiscountPercent = Math.min(100, Math.max(0, Number(((1 - combinedMultiplier) * 100).toFixed(2))));

    const discountAmount = Number((basePrice * (1 - combinedMultiplier)).toFixed(2));
    const finalPrice = Number(Math.max(0, basePrice - discountAmount).toFixed(2));

    res.json({
      plan: plan.id,
      planName: plan.name,
      billingCycle,
      currency,
      basePrice,
      benefitTier,
      tierDiscountPercent,
      promoApplied: appliedPromo,
      promoDiscountPercent,
      combinedDiscountPercent,
      discountPercent: combinedDiscountPercent,
      discountAmount,
      finalPrice,
      isFreeDueToCoreDev: benefitTier === "core_dev",
      supportedPaymentGateways: currency === "KES" ? ["mpesa", "stripe"] : ["stripe", "apple_pay", "google_pay"],
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

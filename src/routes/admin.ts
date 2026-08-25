import { Router, Request, Response, NextFunction } from "express";
import { db } from "../db";
import { userProfiles, stations, rockSamples, structuralMeasurements, projects, promoCodes } from "../db/schema";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { sweepExpiredSubscriptions } from "../services/subscriptionSweeper";
import { PRICING_PLANS, PlanDefinition, calculatePlanPricingFromMonthlyKes, applyMasterEnterpriseRate, MASTER_ENTERPRISE_RATE_KES, TIER_RATIOS } from "./pricing";
import { persistMasterEnterpriseRate } from "../services/systemSettings";

const router = Router();

/**
 * Middleware: Enforces that the request is made by a Lead Admin (Super Admin).
 */
export async function requireLeadAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const currentUserId = req.user?.userId;
    if (!currentUserId) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    const [user] = await db
      .select({ role: userProfiles.role })
      .from(userProfiles)
      .where(eq(userProfiles.userId, currentUserId))
      .limit(1);

    const isLeadAdmin = user?.role === "lead_admin" || req.user?.role === "lead_admin";

    if (!isLeadAdmin) {
      res.status(403).json({
        error: "Forbidden: Access restricted exclusively to Lead Admin (configured in DB).",
      });
      return;
    }

    next();
  } catch (err: any) {
    console.error("Authorization error:", err);
    res.status(500).json({ error: "Authorization verification failed." });
  }
}

// Backwards compatibility alias for requireLeadDev
export const requireLeadDev = requireLeadAdmin;

/**
 * Middleware: Enforces that the request is made by a Developer or Lead Admin.
 */
export async function requireDevOrAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const currentUserId = req.user?.userId;
    if (!currentUserId) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    const [user] = await db
      .select({ role: userProfiles.role })
      .from(userProfiles)
      .where(eq(userProfiles.userId, currentUserId))
      .limit(1);

    const isDevOrAdmin =
      user?.role === "lead_admin" ||
      user?.role === "dev" ||
      req.user?.role === "lead_admin" ||
      req.user?.role === "dev";

    if (!isDevOrAdmin) {
      res.status(403).json({
        error: "Forbidden: Access restricted to Developers and Lead Admins.",
      });
      return;
    }

    next();
  } catch (err: any) {
    console.error("Authorization error:", err);
    res.status(500).json({ error: "Authorization verification failed." });
  }
}

const updateTierSchema = z.object({
  tier: z.enum(["core_dev", "student", "beta_developer", "standard"]).optional(),
  role: z.enum(["lead_admin", "dev", "users"]).optional(),
  customDiscountPercent: z.number().min(0).max(100).optional(),
  expiresInDays: z.number().optional(),
});

const reviewStudentSchema = z.object({
  action: z.enum(["approve", "reject"]),
  notes: z.string().optional(),
});

// 1. GET /api/admin/users - List all users, roles, and benefit tiers (Lead Admin)
router.get("/users", requireAuth, requireDevOrAdmin, async (_req: Request, res: Response) => {
  try {
    const allUsers = await db
      .select({
        id: userProfiles.id,
        userId: userProfiles.userId,
        fullName: userProfiles.fullName,
        username: userProfiles.username,
        email: userProfiles.email,
        role: userProfiles.role,
        benefitTier: userProfiles.benefitTier,
        discountPercent: userProfiles.discountPercent,
        discountExpiresAt: userProfiles.discountExpiresAt,
        studentVerificationStatus: userProfiles.studentVerificationStatus,
        institutionName: userProfiles.institutionName,
        createdAt: userProfiles.createdAt,
      })
      .from(userProfiles)
      .orderBy(desc(userProfiles.createdAt));

    res.json({ count: allUsers.length, data: allUsers });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to list users: " + error.message });
  }
});

// 2. POST /api/admin/users/:userId/tier - Lead Admin updates user benefit tier or role
router.post("/users/:userId/tier", requireAuth, requireLeadAdmin, async (req: Request, res: Response) => {
  try {
    const targetUserId = req.params.userId as string;
    const parsed = updateTierSchema.parse(req.body);

    const [existingUser] = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, targetUserId))
      .limit(1);

    if (!existingUser) {
      res.status(404).json({ error: `User profile with ID '${targetUserId}' not found.` });
      return;
    }

    const newTier = parsed.tier || existingUser.benefitTier;
    const newRole = parsed.role || existingUser.role;

    let defaultDiscount = existingUser.discountPercent;
    let expiresAt: Date | null = existingUser.discountExpiresAt;

    if (parsed.tier) {
      if (parsed.tier === "core_dev") {
        defaultDiscount = 100;
        expiresAt = null;
      } else if (parsed.tier === "student") {
        defaultDiscount = 70;
        expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + (parsed.expiresInDays || 365));
      } else if (parsed.tier === "beta_developer") {
        defaultDiscount = 40;
        expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + (parsed.expiresInDays || 365));
      } else {
        defaultDiscount = 0;
        expiresAt = null;
      }
    }

    const finalDiscount = parsed.customDiscountPercent !== undefined ? parsed.customDiscountPercent : defaultDiscount;

    const [updated] = await db
      .update(userProfiles)
      .set({
        benefitTier: newTier,
        role: newRole,
        discountPercent: finalDiscount,
        discountExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(userProfiles.userId, targetUserId))
      .returning();

    res.json({
      status: "success",
      message: `User '${updated.username}' updated: role='${newRole}', tier='${newTier}' (${finalDiscount}% discount).`,
      data: updated,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues });
      return;
    }
    res.status(500).json({ error: "Failed to update user tier/role: " + error.message });
  }
});

// 3. DELETE /api/admin/users/:userId - Lead Admin deletes a user account (CRUD User Accounts)
router.delete("/users/:userId", requireAuth, requireLeadAdmin, async (req: Request, res: Response) => {
  try {
    const targetUserId = req.params.userId as string;

    const [deleted] = await db
      .delete(userProfiles)
      .where(eq(userProfiles.userId, targetUserId))
      .returning();

    if (!deleted) {
      res.status(404).json({ error: `User profile with ID '${targetUserId}' not found.` });
      return;
    }

    res.json({
      status: "success",
      message: `User account '${deleted.username}' deleted successfully by Lead Admin.`,
      data: deleted,
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to delete user account: " + error.message });
  }
});

// 4. GET /api/admin/posts - Dev & Lead Admin inspect/moderate all user posts & station observations
router.get("/posts", requireAuth, requireDevOrAdmin, async (_req: Request, res: Response) => {
  try {
    const allStations = await db
      .select({
        id: stations.id,
        code: stations.code,
        name: stations.name,
        latitude: stations.latitude,
        longitude: stations.longitude,
        outcropExposure: stations.outcropExposure,
        weathering: stations.weathering,
        projectId: stations.projectId,
        createdAt: stations.createdAt,
      })
      .from(stations)
      .orderBy(desc(stations.createdAt));

    res.json({ count: allStations.length, data: allStations });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to list user posts: " + error.message });
  }
});

// 5. DELETE /api/admin/posts/:stationId - Dev & Lead Admin CRUD / Moderate user posts
router.delete("/posts/:stationId", requireAuth, requireDevOrAdmin, async (req: Request, res: Response) => {
  try {
    const stationId = parseInt(req.params.stationId as string, 10);
    if (isNaN(stationId)) {
      res.status(400).json({ error: "Invalid station ID" });
      return;
    }

    const [deleted] = await db
      .delete(stations)
      .where(eq(stations.id, stationId))
      .returning();

    if (!deleted) {
      res.status(404).json({ error: `Station post #${stationId} not found.` });
      return;
    }

    res.json({
      status: "success",
      message: `Station post #${stationId} ('${deleted.name}') deleted/moderated by Developer.`,
      data: deleted,
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to delete post: " + error.message });
  }
});

// 6. GET /api/admin/student-applications - List pending student verification submissions
router.get("/student-applications", requireAuth, requireLeadAdmin, async (_req: Request, res: Response) => {
  try {
    const pendingApplications = await db
      .select({
        id: userProfiles.id,
        userId: userProfiles.userId,
        fullName: userProfiles.fullName,
        username: userProfiles.username,
        institutionName: userProfiles.institutionName,
        studentIdCardUrl: userProfiles.studentIdCardUrl,
        studentVerificationStatus: userProfiles.studentVerificationStatus,
        benefitTier: userProfiles.benefitTier,
        createdAt: userProfiles.createdAt,
      })
      .from(userProfiles)
      .where(eq(userProfiles.studentVerificationStatus, "pending"))
      .orderBy(desc(userProfiles.updatedAt));

    res.json({ count: pendingApplications.length, data: pendingApplications });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to fetch student applications: " + error.message });
  }
});

// 7. POST /api/admin/student-applications/:userId/review - Approve or Reject student status
router.post("/student-applications/:userId/review", requireAuth, requireLeadAdmin, async (req: Request, res: Response) => {
  try {
    const targetUserId = req.params.userId as string;
    const parsed = reviewStudentSchema.parse(req.body);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 365);

    const updatePayload =
      parsed.action === "approve"
        ? {
            studentVerificationStatus: "approved",
            benefitTier: "student",
            discountPercent: 70,
            discountExpiresAt: expiresAt,
            updatedAt: new Date(),
          }
        : {
            studentVerificationStatus: "rejected",
            updatedAt: new Date(),
          };

    const [updated] = await db
      .update(userProfiles)
      .set(updatePayload)
      .where(eq(userProfiles.userId, targetUserId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: `User profile with ID '${targetUserId}' not found.` });
      return;
    }

    res.json({
      status: "success",
      action: parsed.action,
      message:
        parsed.action === "approve"
          ? `Student application approved for '${updated.username}'. 70% discount activated for 1 year.`
          : `Student application rejected for '${updated.username}'.`,
      data: updated,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues });
      return;
    }
    res.status(500).json({ error: "Review action failed: " + error.message });
  }
});

// 8. POST /api/admin/subscriptions/sweep - Lead Admin triggers subscription expiry sweep
router.post("/subscriptions/sweep", requireAuth, requireLeadAdmin, async (_req: Request, res: Response) => {
  try {
    const result = await sweepExpiredSubscriptions();
    res.json({
      status: "success",
      message: `Subscription sweep completed. ${result.sweptCount} expired subscriptions downgraded.`,
      data: result,
    });
  } catch (error: any) {
    res.status(500).json({ error: "Subscription sweep failed: " + error.message });
  }
});


const promoSchema = z.object({
  code: z.string().min(2).max(30),
  discountPercent: z.number().min(1).max(100),
  description: z.string().optional(),
  maxUses: z.number().int().positive().nullable().optional(),
  isActive: z.boolean().optional(),
  expiresAt: z.string().nullable().optional(),
});

// 9. GET /api/admin/promos - List all promo codes (Lead Admin & Devs)
router.get("/promos", requireAuth, requireDevOrAdmin, async (_req: Request, res: Response) => {
  try {
    const allPromos = await db
      .select()
      .from(promoCodes)
      .orderBy(desc(promoCodes.createdAt));

    res.json({ count: allPromos.length, data: allPromos });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to list promo codes: " + error.message });
  }
});

// 10. POST /api/admin/promos - Create a new promo / voucher code (Lead Admin)
router.post("/promos", requireAuth, requireLeadAdmin, async (req: Request, res: Response) => {
  try {
    const parsed = promoSchema.parse(req.body);
    const normalizedCode = parsed.code.trim().toUpperCase();
    const currentUserId = req.user?.userId || (req.headers["x-user-id"] as string);

    // Check duplicate
    const [existing] = await db
      .select({ id: promoCodes.id })
      .from(promoCodes)
      .where(eq(promoCodes.code, normalizedCode))
      .limit(1);

    if (existing) {
      res.status(409).json({ error: "A promo code with this name already exists." });
      return;
    }

    const [created] = await db
      .insert(promoCodes)
      .values({
        code: normalizedCode,
        discountPercent: parsed.discountPercent,
        description: parsed.description,
        maxUses: parsed.maxUses,
        isActive: parsed.isActive !== undefined ? parsed.isActive : true,
        expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : null,
        createdBy: currentUserId,
      })
      .returning();

    res.status(201).json({
      status: "success",
      message: "Promo code " + normalizedCode + " created successfully (" + parsed.discountPercent + "% off).",
      data: created,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues });
      return;
    }
    res.status(500).json({ error: "Failed to create promo code: " + error.message });
  }
});

// 11. PATCH /api/admin/promos/:id - Update promo code details or toggle active status (Lead Admin)
router.patch("/promos/:id", requireAuth, requireLeadAdmin, async (req: Request, res: Response) => {
  try {
    const promoId = parseInt(req.params.id as string, 10);
    if (isNaN(promoId)) {
      res.status(400).json({ error: "Invalid promo code ID" });
      return;
    }

    const updatePayload: any = { updatedAt: new Date() };
    if (req.body.code) updatePayload.code = req.body.code.trim().toUpperCase();
    if (req.body.discountPercent !== undefined) updatePayload.discountPercent = Number(req.body.discountPercent);
    if (req.body.description !== undefined) updatePayload.description = req.body.description;
    if (req.body.maxUses !== undefined) updatePayload.maxUses = req.body.maxUses;
    if (req.body.isActive !== undefined) updatePayload.isActive = Boolean(req.body.isActive);
    if (req.body.expiresAt !== undefined) updatePayload.expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : null;

    const [updated] = await db
      .update(promoCodes)
      .set(updatePayload)
      .where(eq(promoCodes.id, promoId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Promo code #" + promoId + " not found." });
      return;
    }

    res.json({
      status: "success",
      message: "Promo code " + updated.code + " updated successfully.",
      data: updated,
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to update promo code: " + error.message });
  }
});

// 12. DELETE /api/admin/promos/:id - Delete a promo code (Lead Admin)
router.delete("/promos/:id", requireAuth, requireLeadAdmin, async (req: Request, res: Response) => {
  try {
    const promoId = parseInt(req.params.id as string, 10);
    if (isNaN(promoId)) {
      res.status(400).json({ error: "Invalid promo code ID" });
      return;
    }

    const [deleted] = await db
      .delete(promoCodes)
      .where(eq(promoCodes.id, promoId))
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "Promo code #" + promoId + " not found." });
      return;
    }

    res.json({
      status: "success",
      message: "Promo code " + deleted.code + " deleted successfully.",
      data: deleted,
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to delete promo code: " + error.message });
  }
});

// 13. GET /api/admin/pricing-plans - List all pricing plans for admin management
router.get("/pricing-plans", requireAuth, requireDevOrAdmin, async (_req: Request, res: Response) => {
  res.json({
    status: "success",
    masterEnterpriseRateKes: MASTER_ENTERPRISE_RATE_KES,
    tierRatios: TIER_RATIOS,
    data: Object.values(PRICING_PLANS),
  });
});

// 14. PUT /api/admin/pricing-plans/master-rate - Set single Enterprise rate & auto-calculate all other tiers
router.put("/pricing-plans/master-rate", requireAuth, requireLeadAdmin, async (req: Request, res: Response) => {
  try {
    const { enterpriseMonthlyKes } = req.body;
    if (enterpriseMonthlyKes === undefined || isNaN(Number(enterpriseMonthlyKes))) {
      res.status(400).json({ error: "enterpriseMonthlyKes number is required" });
      return;
    }

    const result = await persistMasterEnterpriseRate(Number(enterpriseMonthlyKes), req.user?.userId);

    res.json({
      status: "success",
      message: `Master Enterprise rate set to KSh ${result.masterEnterpriseRateKes.toLocaleString()}/mo. All 4 tiers automatically recalculated, balanced, and saved to database.`,
      data: result,
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to update master enterprise rate: " + error.message });
  }
});

// 15. PUT /api/admin/pricing-plans/:planId - Update plan prices and limits live
router.put("/pricing-plans/:planId", requireAuth, requireLeadAdmin, async (req: Request, res: Response) => {
  try {
    const planId = req.params.planId as string;
    const plan = PRICING_PLANS[planId];
    if (!plan) {
      res.status(404).json({ error: `Pricing plan '${planId}' not found.` });
      return;
    }

    const { monthlyPrice, monthlyRateKes, annualPrice, name, description } = req.body;
    
    // Auto-calculate full rate card if single monthly KES is provided
    if (monthlyRateKes !== undefined || (monthlyPrice && monthlyPrice.KES !== undefined && monthlyPrice.USD === undefined && !annualPrice)) {
      const targetKes = monthlyRateKes !== undefined ? Number(monthlyRateKes) : Number(monthlyPrice.KES);
      const computed = calculatePlanPricingFromMonthlyKes(targetKes);
      plan.monthlyPrice = computed.monthlyPrice;
      plan.annualPrice = computed.annualPrice;
    } else {
      if (monthlyPrice) {
        if (monthlyPrice.USD !== undefined) plan.monthlyPrice.USD = Number(monthlyPrice.USD);
        if (monthlyPrice.KES !== undefined) plan.monthlyPrice.KES = Number(monthlyPrice.KES);
      }
      if (annualPrice) {
        if (annualPrice.USD !== undefined) plan.annualPrice.USD = Number(annualPrice.USD);
        if (annualPrice.KES !== undefined) plan.annualPrice.KES = Number(annualPrice.KES);
      }
    }
    if (name) plan.name = String(name);
    if (description) plan.description = String(description);

    res.json({
      status: "success",
      message: `Plan '${plan.name}' pricing updated and algorithmically balanced successfully.`,
      data: plan,
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to update pricing plan: " + error.message });
  }
});

export default router;

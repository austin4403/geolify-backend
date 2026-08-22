import { Router, Request, Response, NextFunction } from "express";
import { db } from "../db";
import { userProfiles } from "../db/schema";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { sweepExpiredSubscriptions } from "../services/subscriptionSweeper";

const router = Router();

/**
 * Middleware: Enforces that the request is made exclusively by the Lead Developer / Admin.
 */
export function requireLeadDev(req: Request, res: Response, next: NextFunction) {
  const currentUserId = req.user?.userId || (req.headers["x-user-id"] as string);
  const currentUserEmail = req.user?.email || (req.headers["x-user-email"] as string);

  const leadDevEmails = (process.env.LEAD_DEV_EMAILS || "")
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const leadDevUserIds = (process.env.LEAD_DEV_USER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Check if authorized as Lead Dev
  const isLeadDev =
    (currentUserEmail && leadDevEmails.includes(currentUserEmail.toLowerCase())) ||
    (currentUserId && leadDevUserIds.includes(currentUserId)) ||
    req.user?.role === "lead_dev" ||
    req.user?.role === "admin";

  if (!isLeadDev) {
    res.status(403).json({
      error: "Forbidden: Access restricted exclusively to the Lead Developer.",
    });
    return;
  }

  next();
}

const updateTierSchema = z.object({
  tier: z.enum(["core_dev", "student", "beta_developer", "standard"]),
  customDiscountPercent: z.number().min(0).max(100).optional(),
  expiresInDays: z.number().optional(), // null or undefined for lifetime / standard duration
});

const reviewStudentSchema = z.object({
  action: z.enum(["approve", "reject"]),
  notes: z.string().optional(),
});

// 1. GET /api/admin/users - List all users and their active benefit tiers
router.get("/users", requireAuth, requireLeadDev, async (_req: Request, res: Response) => {
  try {
    const allUsers = await db
      .select({
        id: userProfiles.id,
        userId: userProfiles.userId,
        fullName: userProfiles.fullName,
        username: userProfiles.username,
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

// 2. POST /api/admin/users/:userId/tier - Lead Dev assigns or overrides a user's benefit tier
router.post("/users/:userId/tier", requireAuth, requireLeadDev, async (req: Request, res: Response) => {
  try {
    const targetUserId = req.params.userId as string;
    const parsed = updateTierSchema.parse(req.body);

    let defaultDiscount = 0;
    let expiresAt: Date | null = null;

    if (parsed.tier === "core_dev") {
      defaultDiscount = 100; // 100% Free Lifetime
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

    const finalDiscount = parsed.customDiscountPercent !== undefined ? parsed.customDiscountPercent : defaultDiscount;

    const [updated] = await db
      .update(userProfiles)
      .set({
        benefitTier: parsed.tier,
        discountPercent: finalDiscount,
        discountExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(userProfiles.userId, targetUserId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: `User profile with ID '${targetUserId}' not found.` });
      return;
    }

    res.json({
      status: "success",
      message: `User '${updated.username}' assigned to tier '${parsed.tier}' (${finalDiscount}% discount).`,
      data: updated,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues });
      return;
    }
    res.status(500).json({ error: "Failed to update user tier: " + error.message });
  }
});

// 3. GET /api/admin/student-applications - List pending student verification submissions
router.get("/student-applications", requireAuth, requireLeadDev, async (_req: Request, res: Response) => {
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

// 4. POST /api/admin/student-applications/:userId/review - Approve or Reject student status
router.post("/student-applications/:userId/review", requireAuth, requireLeadDev, async (req: Request, res: Response) => {
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

// 5. POST /api/admin/subscriptions/sweep - Lead Dev triggers subscription expiry sweep
router.post("/subscriptions/sweep", requireAuth, requireLeadDev, async (_req: Request, res: Response) => {
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

export default router;

import { Request, Response, NextFunction } from "express";
import { db } from "../db";
import { userProfiles } from "../db/schema";
import { eq } from "drizzle-orm";

export type SubscriptionPlan = "free" | "pro" | "premium" | "enterprise";

const PLAN_LEVELS: Record<SubscriptionPlan, number> = {
  free: 1,
  pro: 2,
  premium: 3,
  enterprise: 4,
};

/**
 * Middleware: Enforces that the authenticated user possesses at least `minTier` subscription.
 * Note: Users with 'core_dev' benefit tier bypass all subscription gates automatically.
 */
export function requireSubscription(minTier: SubscriptionPlan = "free") {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const currentUserId = req.user?.userId || (req.headers["x-user-id"] as string);

      if (!currentUserId) {
        res.status(401).json({ error: "Authentication required to verify subscription." });
        return;
      }

      const [profile] = await db
        .select({
          id: userProfiles.id,
          userId: userProfiles.userId,
          benefitTier: userProfiles.benefitTier,
          discountPercent: userProfiles.discountPercent,
          subscriptionTier: userProfiles.subscriptionTier,
          subscriptionStatus: userProfiles.subscriptionStatus,
          subscriptionExpiresAt: userProfiles.subscriptionExpiresAt,
        })
        .from(userProfiles)
        .where(eq(userProfiles.userId, currentUserId))
        .limit(1);

      if (!profile) {
        // Fallback: If no profile created yet, treat as free tier
        if (minTier === "free") {
          return next();
        }
        res.status(403).json({
          error: `Subscription upgrade required. This feature requires at least '${minTier}' plan.`,
          requiredTier: minTier,
          currentTier: "free",
        });
        return;
      }

      // 1. Core Devs automatically bypass all tier gates
      if (profile.benefitTier === "core_dev") {
        return next();
      }

      const currentTier = (profile.subscriptionTier as SubscriptionPlan) || "free";
      const currentLevel = PLAN_LEVELS[currentTier] || 1;
      const requiredLevel = PLAN_LEVELS[minTier] || 1;

      // 2. Check if subscription is expired (for paid tiers)
      if (
        currentLevel > 1 &&
        profile.subscriptionExpiresAt &&
        new Date(profile.subscriptionExpiresAt) < new Date()
      ) {
        res.status(402).json({
          error: "Your subscription has expired. Please renew to continue accessing premium features.",
          requiredTier: minTier,
          currentTier: "free",
          benefitTier: profile.benefitTier,
          discountPercent: profile.discountPercent,
        });
        return;
      }

      // 3. Check level hierarchy
      if (currentLevel < requiredLevel) {
        res.status(403).json({
          error: `Subscription upgrade required. This feature requires '${minTier}' tier (current: '${currentTier}').`,
          requiredTier: minTier,
          currentTier,
          benefitTier: profile.benefitTier,
          discountPercent: profile.discountPercent,
          upgradeQuoteUrl: `/api/pricing/quote?plan=${minTier}`,
        });
        return;
      }

      next();
    } catch (err: any) {
      res.status(500).json({ error: "Subscription check error: " + err.message });
    }
  };
}

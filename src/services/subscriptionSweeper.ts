import { db } from "../db";
import { userProfiles } from "../db/schema";
import { and, lt, ne, not, eq } from "drizzle-orm";

/**
 * Sweeps the database for expired paid subscriptions and downgrades them back to Free tier
 */
export async function sweepExpiredSubscriptions(): Promise<{
  sweptCount: number;
  timestamp: string;
}> {
  const now = new Date();

  try {
    // Find all expired paid subscriptions excluding Core Devs
    const expiredUsers = await db
      .select({
        id: userProfiles.id,
        userId: userProfiles.userId,
        username: userProfiles.username,
        subscriptionTier: userProfiles.subscriptionTier,
        subscriptionExpiresAt: userProfiles.subscriptionExpiresAt,
      })
      .from(userProfiles)
      .where(
        and(
          ne(userProfiles.subscriptionTier, "free"),
          ne(userProfiles.benefitTier, "core_dev"),
          lt(userProfiles.subscriptionExpiresAt, now)
        )
      );

    if (expiredUsers.length === 0) {
      return { sweptCount: 0, timestamp: now.toISOString() };
    }

    // Downgrade each expired user to Free tier with status 'past_due'
    for (const u of expiredUsers) {
      await db
        .update(userProfiles)
        .set({
          subscriptionTier: "free",
          subscriptionStatus: "past_due",
          updatedAt: new Date(),
        })
        .where(eq(userProfiles.id, u.id));
    }

    console.log(`🧹 [Subscription Sweeper] Automatically downgraded ${expiredUsers.length} expired subscriptions to Free tier.`);

    return {
      sweptCount: expiredUsers.length,
      timestamp: now.toISOString(),
    };
  } catch (error: any) {
    console.error("Subscription Sweeper error:", error.message);
    throw error;
  }
}

/**
 * Initializes recurring background sweep job
 */
export function startSubscriptionSweeper(intervalMs = 60 * 60 * 1000): NodeJS.Timeout {
  // Run initial sweep on boot
  sweepExpiredSubscriptions().catch((err) =>
    console.error("Initial subscription sweep failed:", err.message)
  );

  // Set interval
  return setInterval(() => {
    sweepExpiredSubscriptions().catch((err) =>
      console.error("Periodic subscription sweep failed:", err.message)
    );
  }, intervalMs);
}

import { db, sql } from "../db";
import { systemSettings } from "../db/schema";
import { eq } from "drizzle-orm";
import { applyMasterEnterpriseRate, MASTER_ENTERPRISE_RATE_KES } from "../routes/pricing";

export const MASTER_RATE_KEY = "master_enterprise_rate_kes";

/**
 * Ensures system_settings table exists and loads persistent Master Enterprise Rate into memory.
 */
export async function initSystemSettings(): Promise<number> {
  try {
    if (process.env.NODE_ENV === "test") {
      return MASTER_ENTERPRISE_RATE_KES;
    }

    // Ensure table exists
    await sql`
      CREATE TABLE IF NOT EXISTS system_settings (
        key text PRIMARY KEY,
        value text NOT NULL,
        updated_by text,
        updated_at timestamp DEFAULT now() NOT NULL
      );
    `;

    // Query for existing master enterprise rate
    const existing = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, MASTER_RATE_KEY))
      .limit(1);

    if (existing.length > 0 && existing[0].value) {
      const storedRate = Number(existing[0].value);
      if (!isNaN(storedRate) && storedRate > 0) {
        applyMasterEnterpriseRate(storedRate);
        console.log(`[Pricing Engine] Loaded Master Enterprise Rate from PostgreSQL: KSh ${storedRate.toLocaleString()}/mo`);
        return storedRate;
      }
    }

    // Default rate if not in database yet
    await sql`
      INSERT INTO system_settings (key, value, updated_at)
      VALUES (${MASTER_RATE_KEY}, ${String(MASTER_ENTERPRISE_RATE_KES)}, now())
      ON CONFLICT (key) DO NOTHING;
    `;

    applyMasterEnterpriseRate(MASTER_ENTERPRISE_RATE_KES);
    return MASTER_ENTERPRISE_RATE_KES;
  } catch (error: any) {
    console.warn("[Pricing Engine] System settings initialization notice:", error.message);
    return MASTER_ENTERPRISE_RATE_KES;
  }
}

/**
 * Persists updated Master Enterprise Rate to PostgreSQL database and recalculates all tiers.
 */
export async function persistMasterEnterpriseRate(
  enterpriseMonthlyKes: number,
  adminUserId?: string
): Promise<{ masterEnterpriseRateKes: number; plans: any[] }> {
  const masterKes = Math.max(100, Number(enterpriseMonthlyKes) || 2000);
  const result = applyMasterEnterpriseRate(masterKes);

  try {
    if (process.env.NODE_ENV !== "test") {
      await sql`
        INSERT INTO system_settings (key, value, updated_by, updated_at)
        VALUES (${MASTER_RATE_KEY}, ${String(masterKes)}, ${adminUserId || null}, now())
        ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value,
            updated_by = EXCLUDED.updated_by,
            updated_at = now();
      `;
    }
  } catch (error: any) {
    console.error("[Pricing Engine] Failed to persist rate to DB:", error.message);
  }

  return result;
}

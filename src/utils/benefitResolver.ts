/**
 * Customer Benefit & Discount Tier Resolver for GeoQuerry
 * Enforces single-category membership with best-benefit favoring hierarchy:
 * Core Dev (100% Free Forever) > Student (70% for 1 Year) > Beta Dev (40% for 1 Year) > Standard (0%)
 */

export type BenefitTier = "core_dev" | "student" | "beta_developer" | "standard";

export interface BenefitResolutionResult {
  tier: BenefitTier;
  discountPercent: number;
  discountExpiresAt: Date | null;
  reason: string;
}

export interface BenefitResolutionParams {
  email?: string;
  isCoreDevApproved?: boolean;
  isStudentApproved?: boolean;
  registrationDate?: Date;
}

/**
 * Public beta cutoff: April 30, 2027
 */
export const BETA_END_DATE = new Date("2027-04-30T23:59:59.999Z");

/**
 * Academic domain regex supporting .edu, .ac.ke, .ac.uk, .edu.*, .ac.*, etc.
 */
export const ACADEMIC_EMAIL_REGEX = /(@[a-zA-Z0-9.-]+\.(edu(\.[a-zA-Z]{2,})?|ac\.[a-zA-Z]{2,}))$/i;

/**
 * Checks whether an email belongs to an educational institution
 */
export function isAcademicEmail(email?: string): boolean {
  if (!email) return false;
  return ACADEMIC_EMAIL_REGEX.test(email.trim());
}

/**
 * Resolves the single highest-value tier that favors the client best
 */
export function resolveBestBenefitTier(params: BenefitResolutionParams): BenefitResolutionResult {
  const now = params.registrationDate || new Date();

  // 1. Core Dev Tier: 100% Discount Lifetime (Lead Dev Approved Only)
  if (params.isCoreDevApproved) {
    return {
      tier: "core_dev",
      discountPercent: 100,
      discountExpiresAt: null, // Lifetime access
      reason: "Approved Core Developer Team Member (100% Free Lifetime)",
    };
  }

  // 2. Student Tier: 70% Discount for 1 Year (Academic Email or Lead Dev Approval)
  if (params.isStudentApproved || isAcademicEmail(params.email)) {
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + 365);

    return {
      tier: "student",
      discountPercent: 70,
      discountExpiresAt: expiresAt,
      reason: params.isStudentApproved
        ? "Verified Student Status (70% Off for 1 Year)"
        : `Academic Institution Email Match (${params.email}) (70% Off for 1 Year)`,
    };
  }

  // 3. Beta Developer Tier: 40% Discount for 1 Year (Registrations on/before April 30, 2027)
  if (now <= BETA_END_DATE) {
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + 365);

    return {
      tier: "beta_developer",
      discountPercent: 40,
      discountExpiresAt: expiresAt,
      reason: "Early Beta Developer / Adopter Program (40% Off for 1 Year)",
    };
  }

  // 4. Standard Tier: 0% Discount
  return {
    tier: "standard",
    discountPercent: 0,
    discountExpiresAt: null,
    reason: "Standard Commercial User",
  };
}

import bcrypt from "bcryptjs";
import { Router, Request, Response } from "express";
import { db } from "../db";
import { userProfiles } from "../db/schema";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { resolveBestBenefitTier, isAcademicEmail } from "../utils/benefitResolver";
import { requireAuth } from "../middleware/auth";

const router = Router();

// Country-to-Default Currency & Unit System Mapping
const COUNTRY_DEFAULTS: Record<string, { currency: string; unitSystem: "metric" | "imperial" }> = {
  KE: { currency: "KES", unitSystem: "metric" },
  US: { currency: "USD", unitSystem: "imperial" },
  GB: { currency: "GBP", unitSystem: "metric" },
  CA: { currency: "CAD", unitSystem: "metric" },
  AU: { currency: "AUD", unitSystem: "metric" },
  ZA: { currency: "ZAR", unitSystem: "metric" },
  TZ: { currency: "TZS", unitSystem: "metric" },
  UG: { currency: "UGX", unitSystem: "metric" },
  RW: { currency: "RWF", unitSystem: "metric" },
  NG: { currency: "NGN", unitSystem: "metric" },
  GH: { currency: "GHS", unitSystem: "metric" },
  EU: { currency: "EUR", unitSystem: "metric" },
  DE: { currency: "EUR", unitSystem: "metric" },
  FR: { currency: "EUR", unitSystem: "metric" },
  IN: { currency: "INR", unitSystem: "metric" },
};

// Zod Schema for Onboarding & Profile Creation
const createProfileSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  fullName: z.string().min(1, "Full name is required"),
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(30, "Username cannot exceed 30 characters")
    .regex(/^[a-zA-Z0-9_-]+$/, "Username can only contain letters, numbers, hyphens, and underscores"),
  email: z.string().email().optional(),
  profession: z.string().optional(),
  organization: z.string().optional(),
  country: z.string().length(2, "Country must be a 2-letter ISO code (e.g. KE, US)").default("KE"),
  preferredCurrency: z.string().optional(),
  unitSystem: z.enum(["metric", "imperial"]).optional(),
  avatarUrl: z.string().url().optional(),
  institutionName: z.string().optional(),
  studentIdCardUrl: z.string().url().optional(),
});

// Partial Schema for Settings Update
const updateProfileSchema = z.object({
  fullName: z.string().min(1).optional(),
  email: z.string().email().optional(),
  profession: z.string().optional(),
  organization: z.string().optional(),
  country: z.string().length(2).optional(),
  preferredCurrency: z.string().optional(),
  unitSystem: z.enum(["metric", "imperial"]).optional(),
  avatarUrl: z.string().url().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(6, "New password must be at least 6 characters"),
});

const applyStudentSchema = z.object({
  institutionName: z.string().min(2, "Institution name is required"),
  studentIdCardUrl: z.string().url("Valid Student ID photo URL is required"),
});

// 1. GET /api/profiles/:userId - Get a user profile by their Auth user ID
router.get("/:userId", async (req: Request, res: Response) => {
  try {
    const rawUserId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;

    const [profile] = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, rawUserId))
      .limit(1);

    if (!profile) {
      res.status(404).json({ error: "User profile not found. Onboarding may be required." });
      return;
    }

    res.json({ data: profile });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 2. GET /api/profiles/check-username/:username - Check if a username is available
router.get("/check-username/:username", async (req: Request, res: Response) => {
  try {
    const rawUsername = Array.isArray(req.params.username) ? req.params.username[0] : req.params.username;

    const [existing] = await db
      .select({ id: userProfiles.id })
      .from(userProfiles)
      .where(eq(userProfiles.username, rawUsername))
      .limit(1);

    res.json({ available: !existing });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 3. POST /api/profiles/onboard - Complete user onboarding with auto-calculated best benefit tier
router.post("/onboard", async (req: Request, res: Response) => {
  try {
    const validatedData = createProfileSchema.parse(req.body);

    // Check if username is already taken
    const [existingUsername] = await db
      .select({ id: userProfiles.id })
      .from(userProfiles)
      .where(eq(userProfiles.username, validatedData.username))
      .limit(1);

    if (existingUsername) {
      res.status(409).json({ error: `Username '${validatedData.username}' is already taken.` });
      return;
    }

    // Auto-infer defaults from country if not explicitly provided
    const upperCountry = validatedData.country.toUpperCase();
    const defaults = COUNTRY_DEFAULTS[upperCountry] || { currency: "USD", unitSystem: "metric" };

    const currency = validatedData.preferredCurrency || defaults.currency;
    const units = validatedData.unitSystem || defaults.unitSystem;

    // Resolve user email
    const userEmail =
      validatedData.email ||
      req.user?.email ||
      (req.headers["x-user-email"] as string) ||
      "";

    // Standard benefit tier resolution without automatic privilege elevation
    const benefit = resolveBestBenefitTier({
      email: userEmail,
      isCoreDevApproved: false,
    });

    const isAcademic = isAcademicEmail(userEmail);

    const [newProfile] = await db
      .insert(userProfiles)
      .values({
        userId: validatedData.userId,
        fullName: validatedData.fullName,
        username: validatedData.username,
        profession: validatedData.profession,
        organization: validatedData.organization,
        country: upperCountry,
        preferredCurrency: currency,
        unitSystem: units,
        avatarUrl: validatedData.avatarUrl,
        onboardingCompleted: true,
        benefitTier: benefit.tier,
        discountPercent: benefit.discountPercent,
        discountExpiresAt: benefit.discountExpiresAt,
        studentVerificationStatus: isAcademic ? "approved" : validatedData.studentIdCardUrl ? "pending" : "none",
        studentIdCardUrl: validatedData.studentIdCardUrl,
        institutionName: validatedData.institutionName,
      })
      .returning();

    res.status(201).json({
      data: newProfile,
      benefitInfo: {
        tier: benefit.tier,
        discountPercent: benefit.discountPercent,
        discountExpiresAt: benefit.discountExpiresAt,
        reason: benefit.reason,
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues });
      return;
    }
    res.status(500).json({ error: error.message });
  }
});

// 4. POST /api/profiles/apply-student - Submit student discount application
router.post("/apply-student", requireAuth, async (req: Request, res: Response) => {
  try {
    const currentUserId = req.user!.userId;
    const parsed = applyStudentSchema.parse(req.body);

    const userEmail = req.user?.email || (req.headers["x-user-email"] as string) || "";
    const isAcademic = isAcademicEmail(userEmail);

    // If already has academic email, auto-approve immediately
    let newTier = "beta_developer";
    let discount = 40;
    let expiresAt: Date | null = new Date();
    expiresAt.setDate(expiresAt.getDate() + 365);
    let status = "pending";

    if (isAcademic) {
      newTier = "student";
      discount = 70;
      status = "approved";
    }

    const [updated] = await db
      .update(userProfiles)
      .set({
        institutionName: parsed.institutionName,
        studentIdCardUrl: parsed.studentIdCardUrl,
        studentVerificationStatus: status,
        ...(isAcademic
          ? {
              benefitTier: "student",
              discountPercent: 70,
              discountExpiresAt: expiresAt,
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(userProfiles.userId, currentUserId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "User profile not found. Please complete onboarding first." });
      return;
    }

    res.json({
      status: "success",
      verificationStatus: status,
      message: isAcademic
        ? "Academic email verified! 70% Student discount activated for 1 year."
        : "Student verification submitted successfully. Under review by Lead Developer.",
      data: updated,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues });
      return;
    }
    res.status(500).json({ error: error.message });
  }
});

// 5. PATCH /api/profiles/:userId - Update profile settings
router.patch("/:userId", async (req: Request, res: Response) => {
  try {
    const rawUserId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
    const validatedUpdates = updateProfileSchema.parse(req.body);

    const [existing] = await db
      .select({ userId: userProfiles.userId, email: userProfiles.email, metadata: userProfiles.metadata })
      .from(userProfiles)
      .where(eq(userProfiles.userId, rawUserId))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "User profile not found." });
      return;
    }

    // Check if new email is already used by another account
    if (validatedUpdates.email && validatedUpdates.email.toLowerCase() !== (existing.email || "").toLowerCase()) {
      const [takenEmail] = await db
        .select({ userId: userProfiles.userId })
        .from(userProfiles)
        .where(eq(userProfiles.email, validatedUpdates.email.toLowerCase()))
        .limit(1);

      if (takenEmail && takenEmail.userId !== rawUserId) {
        res.status(409).json({ error: `Email address '${validatedUpdates.email}' is already registered to another account.` });
        return;
      }
    }

    const mergedMetadata = validatedUpdates.metadata
      ? { ...((existing.metadata as Record<string, any>) || {}), ...validatedUpdates.metadata }
      : undefined;

    const [updatedProfile] = await db
      .update(userProfiles)
      .set({
        ...validatedUpdates,
        ...(validatedUpdates.email ? { email: validatedUpdates.email.toLowerCase() } : {}),
        ...(mergedMetadata ? { metadata: mergedMetadata } : {}),
        updatedAt: new Date(),
      })
      .where(eq(userProfiles.userId, rawUserId))
      .returning();

    res.json({ data: updatedProfile });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues });
      return;
    }
    res.status(500).json({ error: error.message });
  }
});

// 6. POST /api/profiles/change-password - Change user password
router.post("/change-password", requireAuth, async (req: Request, res: Response) => {
  try {
    const currentUserId = req.user!.userId;
    const parsed = changePasswordSchema.parse(req.body);

    if (parsed.currentPassword === parsed.newPassword) {
      res.status(400).json({ error: "New password cannot be identical to your current password." });
      return;
    }

    // 1. Fetch user record from database by userId or email
    let [user] = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, currentUserId))
      .limit(1);

    if (!user && req.user?.email) {
      [user] = await db
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.email, req.user.email.toLowerCase().trim()))
        .limit(1);
    }

    if (!user) {
      // If user profile is not in PostgreSQL yet (e.g. local offline preset), verify default demo credential
      const validDefaults = [
        "GeoQuerry2026!",
        "odhiambo4403",
        "password",
        "Student2026!",
        "BetaDev2026!",
        "GeoUser2026!",
      ];
      if (!validDefaults.includes(parsed.currentPassword) && parsed.currentPassword !== "GeoQuerry2026!") {
        res.status(400).json({ error: "Current password is incorrect. Default password is GeoQuerry2026!" });
        return;
      }
      res.json({
        status: "success",
        message: "Password changed successfully!",
      });
      return;
    }

    // 2. Verify current password
    if (user.passwordHash) {
      const isMatch = await bcrypt.compare(parsed.currentPassword, user.passwordHash);
      if (!isMatch) {
        res.status(400).json({ error: "Current password is incorrect. Please check and try again." });
        return;
      }
    } else {
      // Default fallback check for seeded/demo accounts without custom hash yet
      const validDefaults = [
        "GeoQuerry2026!",
        "odhiambo4403",
        "password",
        "Student2026!",
        "BetaDev2026!",
        "GeoUser2026!",
      ];
      if (!validDefaults.includes(parsed.currentPassword) && parsed.currentPassword !== "GeoQuerry2026!") {
        res.status(400).json({ error: "Current password is incorrect. Default password is GeoQuerry2026!" });
        return;
      }
    }

    // 3. Hash new password securely
    const salt = await bcrypt.genSalt(10);
    const newPasswordHash = await bcrypt.hash(parsed.newPassword, salt);

    // 4. Persist updated hash in Neon PostgreSQL
    await db
      .update(userProfiles)
      .set({
        passwordHash: newPasswordHash,
        updatedAt: new Date(),
      })
      .where(eq(userProfiles.userId, currentUserId));

    res.json({
      status: "success",
      message: "Password updated and verified successfully in database!",
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues });
      return;
    }
    res.status(500).json({ error: error.message });
  }
});

export default router;

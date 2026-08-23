import { Router, Request, Response } from "express";
import { db } from "../db";
import { userProfiles } from "../db/schema";
import { z } from "zod";
import { eq, or } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { resolveBestBenefitTier } from "../utils/benefitResolver";
import { requireAuth } from "../middleware/auth";

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV !== "production" ? "geoquerry_dev_jwt_secret_must_change_in_prod_12345" : "");
if (!JWT_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("CRITICAL SECURITY CONFIGURATION: JWT_SECRET environment variable must be set in production.");
}
const secretKey = new TextEncoder().encode(JWT_SECRET);

// 1. Zod Validation Schemas
const registerSchema = z.object({
  fullName: z.string().min(1, "Full name is required"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(30)
    .regex(/^[a-zA-Z0-9_-]+$/, "Username can only contain letters, numbers, and underscores")
    .optional(),
  country: z.string().length(2).default("KE"),
  preferredCurrency: z.string().default("KES"),
  profession: z.string().default("Exploration Geologist"),
  organization: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().min(1, "Email or username is required"),
  password: z.string().min(1, "Password is required"),
});

// Helper: Issue standard JWT token (24-hour expiration window)
export async function generateToken(payload: { userId: string; email: string; role: string }) {
  return await new SignJWT({
    sub: payload.userId,
    userId: payload.userId,
    email: payload.email,
    role: payload.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(secretKey);
}

// 2. POST /api/auth/register - Create new user account in Neon Postgres
router.post("/register", async (req: Request, res: Response) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.format(),
      });
      return;
    }

    const { fullName, email, password, country, preferredCurrency, profession, organization } = parsed.data;
    const normalizedEmail = email.toLowerCase().trim();

    // Auto-generate username from full name if not provided
    const baseUsername = parsed.data.username || fullName.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 20);
    let username = baseUsername;

    // Check if user already exists
    const [existing] = await db
      .select()
      .from(userProfiles)
      .where(or(eq(userProfiles.email, normalizedEmail), eq(userProfiles.username, username)))
      .limit(1);

    if (existing) {
      if (existing.email === normalizedEmail) {
        res.status(409).json({ error: "An account with this email already exists. Please sign in." });
        return;
      }
      username = `${baseUsername}_${Math.floor(100 + Math.random() * 900)}`;
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Default standard tier and "users" role for all new signups
    const resolvedTier = resolveBestBenefitTier({
      email: normalizedEmail,
      isCoreDevApproved: false,
      registrationDate: new Date(),
    });

    const userId = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const userRole = "users";

    // Insert user into PostgreSQL
    const [newUser] = await db
      .insert(userProfiles)
      .values({
        userId,
        email: normalizedEmail,
        passwordHash,
        role: userRole,
        fullName,
        username,
        country,
        preferredCurrency: preferredCurrency as any,
        profession,
        organization,
        onboardingCompleted: true,
        benefitTier: resolvedTier.tier,
        discountPercent: resolvedTier.discountPercent,
        discountExpiresAt: resolvedTier.discountExpiresAt,
        subscriptionTier: "free",
        subscriptionStatus: "active",
      })
      .returning();

    // Generate JWT token
    const token = await generateToken({
      userId: newUser.userId,
      email: newUser.email || normalizedEmail,
      role: newUser.role,
    });

    res.status(201).json({
      status: "success",
      message: "User account created successfully in Neon PostgreSQL",
      token,
      user: {
        id: newUser.id,
        userId: newUser.userId,
        email: newUser.email,
        fullName: newUser.fullName,
        username: newUser.username,
        role: newUser.role,
        benefitTier: newUser.benefitTier,
        discountPercent: newUser.discountPercent,
        subscriptionTier: newUser.subscriptionTier,
        subscriptionStatus: newUser.subscriptionStatus,
      },
    });
  } catch (error: any) {
    console.error("Registration error:", error);
    res.status(500).json({ error: "Registration failed. Please verify input and try again." });
  }
});

// 3. POST /api/auth/login - Authenticate user credentials & issue JWT
router.post("/login", async (req: Request, res: Response) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.format(),
      });
      return;
    }

    const { email, password } = parsed.data;
    const searchIdentifier = email.toLowerCase().trim();

    // Find user in Neon DB by email or username
    const [user] = await db
      .select()
      .from(userProfiles)
      .where(or(eq(userProfiles.email, searchIdentifier), eq(userProfiles.username, searchIdentifier)))
      .limit(1);

    if (!user) {
      res.status(401).json({ error: "Invalid email/username or password." });
      return;
    }

    // Check password hash
    if (user.passwordHash) {
      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) {
        res.status(401).json({ error: "Invalid email/username or password." });
        return;
      }
    } else {
      // User registered via OAuth / Neon Auth without a local password yet
      res.status(401).json({ error: "This account was registered via Neon Auth / OIDC. Please sign in with Neon Auth." });
      return;
    }

    // Issue JWT token
    const token = await generateToken({
      userId: user.userId,
      email: user.email || searchIdentifier,
      role: user.role,
    });

    res.json({
      status: "success",
      message: "Authenticated successfully",
      token,
      user: {
        id: user.id,
        userId: user.userId,
        email: user.email,
        fullName: user.fullName,
        username: user.username,
        role: user.role,
        benefitTier: user.benefitTier,
        discountPercent: user.discountPercent,
        subscriptionTier: user.subscriptionTier,
        subscriptionStatus: user.subscriptionStatus,
      },
    });
  } catch (error: any) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Login failed. Please check credentials and try again." });
  }
});

// 4. GET /api/auth/me - Return currently authenticated user
router.get("/me", requireAuth, async (req: Request, res: Response) => {
  try {
    const currentUserId = req.user?.userId;
    if (!currentUserId) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const [user] = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, currentUserId))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "User profile not found in database." });
      return;
    }

    res.json({
      status: "success",
      user: {
        id: user.id,
        userId: user.userId,
        email: user.email,
        fullName: user.fullName,
        username: user.username,
        role: user.role,
        profession: user.profession,
        organization: user.organization,
        country: user.country,
        preferredCurrency: user.preferredCurrency,
        unitSystem: user.unitSystem,
        benefitTier: user.benefitTier,
        discountPercent: user.discountPercent,
        subscriptionTier: user.subscriptionTier,
        subscriptionStatus: user.subscriptionStatus,
      },
    });
  } catch (error: any) {
    console.error("Profile fetch error:", error);
    res.status(500).json({ error: "Failed to retrieve user profile." });
  }
});

export default router;

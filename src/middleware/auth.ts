import { Request, Response, NextFunction } from "express";
import { db } from "../db";
import { projects, projectCollaborators } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { createRemoteJWKSet, jwtVerify, decodeJwt } from "jose";

export interface AuthenticatedUser {
  userId: string;
  email?: string;
  role?: string;
  [key: string]: any;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * Role hierarchy levels
 */
const ROLE_HIERARCHY: Record<string, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
};

// Cache remote JWKS set instance if configured
let remoteJWKS: ReturnType<typeof createRemoteJWKSet> | null = null;
if (process.env.JWKS_URI) {
  try {
    remoteJWKS = createRemoteJWKSet(new URL(process.env.JWKS_URI));
  } catch (e) {
    console.error("Invalid JWKS_URI configuration:", e);
  }
}

/**
 * Verify and extract JWT payload from token string
 */
export async function verifyToken(token: string): Promise<AuthenticatedUser | null> {
  // 1. If JWKS URI is configured (Neon Auth, OIDC)
  if (process.env.JWKS_URI && remoteJWKS) {
    try {
      const { payload } = await jwtVerify(token, remoteJWKS, {
        issuer: process.env.JWT_ISSUER,
        audience: process.env.JWT_AUDIENCE,
      });
      const userId = (payload.sub || payload.user_id || payload.uid || payload.id) as string;
      if (userId) {
        return {
          userId,
          email: payload.email as string | undefined,
          role: (payload.role as string) || (payload.roles as string[] | undefined)?.[0],
          ...payload,
        };
      }
    } catch {
      // Fall through to symmetric signature verification
    }
  }

  // 2. Symmetric signature verification using JWT_SECRET
  try {
    const secretStr = process.env.JWT_SECRET || (process.env.NODE_ENV !== "production" ? "geoquerry_dev_jwt_secret_must_change_in_prod_12345" : "");
    if (secretStr) {
      const secret = new TextEncoder().encode(secretStr);
      const { payload } = await jwtVerify(token, secret);
      const userId = (payload.sub || payload.user_id || payload.uid || payload.id) as string;
      if (userId) {
        return {
          userId,
          email: payload.email as string | undefined,
          role: payload.role as string | undefined,
          ...payload,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Authentication Middleware: Extracts and cryptographically verifies user identity from Bearer token.
 */
export async function authenticateUser(req: Request, _res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7).trim();
      if (token) {
        const user = await verifyToken(token);
        if (user) {
          req.user = user;
          return next();
        }
      }
    }
    next();
  } catch {
    next();
  }
}

/**
 * Enforce that the request must come from an authenticated user.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user || !req.user.userId) {
    res.status(401).json({
      error: "Authentication required. Please provide a valid Authorization Bearer token.",
    });
    return;
  }
  next();
}

/**
 * Enforces Role-Based Access Control (RBAC) on a Project resource.
 * Checks if the user is the project owner or a collaborator with at least `minRole` permissions.
 */
export function requireProjectRole(minRole: "viewer" | "editor" | "owner" = "viewer") {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const currentUserId = req.user?.userId;

      if (!currentUserId) {
        res.status(401).json({ error: "Authentication required to access project resources." });
        return;
      }

      const rawProjectId =
        req.params.projectId ||
        req.params.id ||
        (req.body && req.body.projectId) ||
        (req.query && req.query.projectId);

      if (!rawProjectId) {
        return next();
      }

      const projectId = parseInt(Array.isArray(rawProjectId) ? rawProjectId[0] : String(rawProjectId), 10);
      if (isNaN(projectId)) {
        res.status(400).json({ error: "Invalid project ID parameter." });
        return;
      }

      // Fetch project to check ownership
      const [project] = await db
        .select({ id: projects.id, userId: projects.userId })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

      if (!project) {
        res.status(404).json({ error: `Project #${projectId} not found.` });
        return;
      }

      // Direct owner always has maximal permissions
      if (project.userId === currentUserId) {
        return next();
      }

      // Check if user is a registered collaborator
      const [collaborator] = await db
        .select({ role: projectCollaborators.role })
        .from(projectCollaborators)
        .where(
          and(
            eq(projectCollaborators.projectId, projectId),
            eq(projectCollaborators.userId, currentUserId)
          )
        )
        .limit(1);

      if (!collaborator) {
        res.status(403).json({
          error: "Forbidden: You do not have collaborator access to this project.",
        });
        return;
      }

      const userRoleLevel = ROLE_HIERARCHY[collaborator.role] || 0;
      const requiredRoleLevel = ROLE_HIERARCHY[minRole] || 1;

      if (userRoleLevel < requiredRoleLevel) {
        res.status(403).json({
          error: `Forbidden: Project role '${collaborator.role}' does not meet required '${minRole}' privilege.`,
        });
        return;
      }

      next();
    } catch (err: any) {
      res.status(500).json({ error: "Access verification error: " + err.message });
    }
  };
}

import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cors from "cors";
import { Request, Response, NextFunction } from "express";

/**
 * Helmet Security Headers Configuration
 */
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https:", "wss:"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
  dnsPrefetchControl: { allow: false },
  frameguard: { action: "deny" },
  hidePoweredBy: true,
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  ieNoOpen: true,
  noSniff: true,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  xssFilter: true,
});

/**
 * Allowed CORS Origins
 */
const DEFAULT_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3000",
  "https://geoquerry.app",
  "https://app.geoquerry.com",
];

export const corsMiddleware = cors({
  origin: (origin, callback) => {
    // Allow non-browser requests (like mobile apps, curl, server-to-server) where origin is undefined
    if (!origin) {
      return callback(null, true);
    }
    
    const envOrigins = process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
      : [];
    const allowed = [...DEFAULT_ORIGINS, ...envOrigins];

    if (allowed.includes(origin) || allowed.includes("*")) {
      return callback(null, true);
    }

    return callback(new Error("CORS policy violation: origin not allowed"), false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "x-user-id"],
  exposedHeaders: ["Content-Disposition"],
  maxAge: 86400, // 24 hours
});

/**
 * Global Standard API Rate Limiter
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 600, // Limit each IP to 600 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 429,
    error: "Too many requests from this IP, please try again after 15 minutes.",
  },
  skip: () => process.env.NODE_ENV === "test", // Skip during automated test suites
});

/**
 * Strict Rate Limiter for Heavy Computations & Resource Generation (Exports, File Uploads)
 */
export const strictLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // Limit each IP to 60 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 429,
    error: "Rate limit exceeded for resource-intensive operations. Please wait a moment.",
  },
  skip: () => process.env.NODE_ENV === "test",
});

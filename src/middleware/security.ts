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
      connectSrc: ["'self'", "http:", "https:", "wss:", "ws:"],
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
 * Allowed CORS Origins & Strict Matching
 */
const DEFAULT_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3000",
  "https://geoquerry.app",
  "https://app.geoquerry.com",
];

const LOCAL_ORIGIN_REGEX = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?$/;

export const corsMiddleware = cors({
  origin: (origin, callback) => {
    // Allow non-browser requests where origin is undefined (e.g. server-to-server, curl, tests)
    if (!origin) {
      return callback(null, true);
    }

    // In development mode, allow all local origins and network IPs
    if (process.env.NODE_ENV !== "production") {
      return callback(null, true);
    }

    const envOrigins = process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
      : [];
    const allowed = [...DEFAULT_ORIGINS, ...envOrigins];

    if (allowed.includes(origin) || allowed.includes("*")) {
      return callback(null, true);
    }

    return callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "x-user-id",
    "x-user-email",
    "X-User-Id",
    "X-User-Email",
  ],
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
  skip: (req) => process.env.NODE_ENV === "test" || req.originalUrl?.startsWith("/api/tiles"),
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

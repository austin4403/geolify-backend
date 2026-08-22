import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

/**
 * 404 Not Found Handler for unmatched routes
 */
export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    status: 404,
    error: "Resource not found",
    path: req.originalUrl,
    method: req.method,
  });
}

/**
 * Centralized Global Error Handler
 * Sanitizes internal database and runtime details to prevent information disclosure (CWE-209).
 */
export function errorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  // Handle Zod Validation Errors
  if (err instanceof ZodError) {
    res.status(400).json({
      status: 400,
      error: "Validation failed",
      issues: err.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }

  // Handle CORS policy rejection
  if (err.message && err.message.includes("CORS policy violation")) {
    res.status(403).json({
      status: 403,
      error: "CORS policy violation: Access from your origin is not permitted.",
    });
    return;
  }

  // Handle JSON parse errors (malformed body payload)
  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json({
      status: 400,
      error: "Malformed JSON payload in request body.",
    });
    return;
  }

  // Log error internally in server logs
  console.error("Unhandled API Error:", err);

  const statusCode = err.status || err.statusCode || 500;
  const isDev = process.env.NODE_ENV === "development";

  // Production-safe error message without leaking stack traces or SQL internals
  res.status(statusCode).json({
    status: statusCode,
    error: isDev ? err.message : "An unexpected internal server error occurred.",
  });
}

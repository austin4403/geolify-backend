import express from "express";
import * as dotenv from "dotenv";
import healthRouter from "./routes/health";
import profilesRouter from "./routes/profiles";
import projectsRouter from "./routes/projects";
import stationsRouter from "./routes/stations";
import rocksRouter from "./routes/rocks";
import structuresRouter from "./routes/structures";
import hydrogeologyRouter from "./routes/hydrogeology";
import uploadsRouter from "./routes/uploads";
import eventsRouter from "./routes/events";
import reportsRouter from "./routes/reports";
import syncRouter from "./routes/sync";
import authRouter from "./routes/auth";
import adminRouter from "./routes/admin";
import pricingRouter from "./routes/pricing";
import checkoutRouter from "./routes/checkout";
import webhooksRouter from "./routes/webhooks";
import swaggerRouter from "./docs/swagger";
import tilesRouter from "./routes/tiles";
import geologyRouter from "./routes/geology";
import mineralsRouter from "./routes/minerals";
import elevationRouter from "./routes/elevation";
import { startSubscriptionSweeper } from "./services/subscriptionSweeper";
import { startNightlyTilePrewarmCron } from "./services/tilePrewarm";
import { startNightlyMineralSyncCron } from "./services/mineralSourcing";
import { securityHeaders, corsMiddleware, apiLimiter } from "./middleware/security";
import { authenticateUser } from "./middleware/auth";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

dotenv.config({ path: ".env.local" });

const app = express();
const PORT = process.env.PORT || 5000;

// Security Middlewares
app.use(securityHeaders);
app.use(corsMiddleware);
app.use(apiLimiter);
app.use(express.json({ limit: "2mb" })); // Prevent large payload memory exhaustion DoS
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// Universal Authentication Context
app.use(authenticateUser);

// Interactive Swagger UI & OpenAPI Specification
app.use("/api/docs", swaggerRouter);

// Root route
app.get("/", (_req, res) => {
  res.json({
    name: "GeoQuerry Backend API",
    version: "2.0.0",
    status: "online",
    documentation: "/api/docs",
    modules: {
      health: "/api/health",
      docs: "/api/docs",
      pricing: "/api/pricing/plans",
      checkout: "/api/checkout",
      webhooks: "/api/webhooks",
      profiles: "/api/profiles",
      admin: "/api/admin/users",
      projects: "/api/projects",
      stations: "/api/stations",
      rocks: "/api/stations/:stationId/rocks",
      structures: "/api/stations/:stationId/structures",
      hydrogeology: "/api/boreholes",
      minerals: "/api/minerals",
      sync: "/api/projects/:projectId/sync/pull",
      uploads: "/api/uploads/presigned-url",
      events: "/api/projects/:projectId/events",
      reports: "/api/projects/:projectId/export/summary",
    },
  });
});

// API Routes
app.use("/api/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/pricing", pricingRouter);
app.use("/api/checkout", checkoutRouter);
app.use("/api/webhooks", webhooksRouter);
app.use("/api/profiles", profilesRouter);
app.use("/api/admin", adminRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/stations", stationsRouter);
app.use("/api", rocksRouter);
app.use("/api", structuresRouter);
app.use("/api", hydrogeologyRouter);
app.use("/api/minerals", mineralsRouter);
app.use("/api/uploads", uploadsRouter);
app.use("/api", eventsRouter);
app.use("/api", reportsRouter);
app.use("/api/tiles", tilesRouter);
app.use("/api/geology", geologyRouter);
app.use("/api/elevation", elevationRouter);
app.use("/api", syncRouter);

// 404 Catch-All Handler
app.use(notFoundHandler);

// Centralized Global Error Handler
app.use(errorHandler);

// Start server only when not running in test mode
if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`🚀 GeoQuerry server running on http://localhost:${PORT}`);
    console.log(`🩺 Health check available at http://localhost:${PORT}/api/health`);
    console.log(`📑 Swagger Documentation available at http://localhost:${PORT}/api/docs`);

    // Start background subscription expiry sweeper (runs every 1 hour)
    startSubscriptionSweeper(60 * 60 * 1000);

    // Start background nightly 00:00 EAT Tile Pre-Synthesis Cron
    startNightlyTilePrewarmCron();

    // Start background nightly 00:00 EAT Mineral Sourcing & Ingestion Cron
    startNightlyMineralSyncCron();
  });
}

export default app;

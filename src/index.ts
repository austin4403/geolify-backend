import express from "express";
import cors from "cors";
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
import locationsRouter from "./routes/locations";

dotenv.config({ path: ".env.local" });

const app = express();
const PORT = process.env.PORT || 5000;

// Middlewares
app.use(
  cors({
    origin: ["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173"],
    credentials: true,
  })
);
app.use(express.json());

// API Routes
app.use("/api/health", healthRouter);
app.use("/api/profiles", profilesRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/stations", stationsRouter);
app.use("/api", rocksRouter);
app.use("/api", structuresRouter);
app.use("/api", hydrogeologyRouter);
app.use("/api/uploads", uploadsRouter);
app.use("/api", eventsRouter);
app.use("/api", reportsRouter);
app.use("/api/locations", locationsRouter);

// Root route
app.get("/", (_req, res) => {
  res.json({
    name: "Geolify Backend API",
    version: "2.0.0",
    status: "online",
    modules: {
      health: "/api/health",
      profiles: "/api/profiles",
      projects: "/api/projects",
      stations: "/api/stations",
      rocks: "/api/stations/:stationId/rocks",
      structures: "/api/stations/:stationId/structures",
      hydrogeology: "/api/boreholes",
      uploads: "/api/uploads/presigned-url",
      events: "/api/projects/:projectId/events",
      reports: "/api/projects/:projectId/export/summary",
    },
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Geolify server running on http://localhost:${PORT}`);
  console.log(`🩺 Health check available at http://localhost:${PORT}/api/health`);
});

export default app;

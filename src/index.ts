import express from "express";
import cors from "cors";
import * as dotenv from "dotenv";
import healthRouter from "./routes/health";
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
app.use("/api/locations", locationsRouter);

// Root route
app.get("/", (_req, res) => {
  res.json({
    name: "Geolify Backend API",
    version: "1.0.0",
    status: "online",
    endpoints: {
      health: "/api/health",
      locations: "/api/locations",
    },
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Geolify server running on http://localhost:${PORT}`);
  console.log(`🩺 Health check available at http://localhost:${PORT}/api/health`);
});

export default app;

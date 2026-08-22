import { Router, Request, Response } from "express";
import { sql } from "../db";

const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  try {
    const dbResult = await sql`SELECT NOW() as current_time, version() as pg_version`;
    
    res.json({
      status: "healthy",
      environment: process.env.NODE_ENV || "development",
      timestamp: new Date().toISOString(),
      database: {
        connected: true,
        time: dbResult[0]?.current_time,
        version: dbResult[0]?.pg_version,
      },
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
    });
  } catch (error: any) {
    res.status(500).json({
      status: "unhealthy",
      environment: process.env.NODE_ENV || "development",
      database: {
        connected: false,
        error: error.message,
      },
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;

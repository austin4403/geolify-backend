import { Router, Request, Response } from "express";
import { db } from "../db";
import { locations } from "../db/schema";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";

const router = Router();

const createLocationSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  category: z.string().default("general"),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  metadata: z.record(z.string(), z.any()).optional(),
});

// GET all locations
router.get("/", async (_req: Request, res: Response) => {
  try {
    const allLocations = await db
      .select()
      .from(locations)
      .orderBy(desc(locations.createdAt));
    res.json({ data: allLocations });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST create a location
router.post("/", async (req: Request, res: Response) => {
  try {
    const validated = createLocationSchema.parse(req.body);
    const [newLocation] = await db
      .insert(locations)
      .values(validated)
      .returning();
    res.status(201).json({ data: newLocation });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues });
      return;
    }
    res.status(500).json({ error: error.message });
  }
});

// GET location by ID
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(rawId, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid location ID" });
      return;
    }

    const [location] = await db
      .select()
      .from(locations)
      .where(eq(locations.id, id))
      .limit(1);

    if (!location) {
      res.status(404).json({ error: "Location not found" });
      return;
    }

    res.json({ data: location });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

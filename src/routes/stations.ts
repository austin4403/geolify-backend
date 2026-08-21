import { Router, Request, Response } from "express";
import { db } from "../db";
import { stations } from "../db/schema";
import { z } from "zod";
import { eq, desc, ilike, or } from "drizzle-orm";

const router = Router();

// Zod Validation Schema for creating a Station
const createStationSchema = z.object({
  projectId: z.number().optional(),
  code: z.string().min(1, "Station code is required (e.g. ST-04)"),
  name: z.string().min(1, "Station name is required"),
  latitude: z.number().min(-90).max(90, "Latitude must be between -90 and 90"),
  longitude: z.number().min(-180).max(180, "Longitude must be between -180 and 180"),
  elevation: z.number().optional(),
  gpsAccuracy: z.number().nonnegative().optional(),
  vegetation: z.string().optional(),
  soilDescription: z.string().optional(),
  landmarks: z.string().optional(),
  outcropExposure: z.enum(["in-situ", "float", "subcrop"]).default("in-situ"),
  weathering: z.enum(["fresh", "slight", "moderate", "high"]).default("moderate"),
  photoUrls: z.array(z.string().url("Must be a valid photo URL")).default([]),
  metadata: z.record(z.string(), z.any()).optional(),
});

// Zod Validation Schema for updating a Station
const updateStationSchema = createStationSchema.partial();

// 1. GET /api/stations - List all stations (with search query support)
router.get("/", async (req: Request, res: Response) => {
  try {
    const searchQuery = req.query.q as string | undefined;

    let query = db.select().from(stations);

    if (searchQuery) {
      const search = `%${searchQuery}%`;
      const allStations = await db
        .select()
        .from(stations)
        .where(
          or(
            ilike(stations.code, search),
            ilike(stations.name, search),
            ilike(stations.landmarks, search),
            ilike(stations.soilDescription, search)
          )
        )
        .orderBy(desc(stations.createdAt));
      res.json({ data: allStations });
      return;
    }

    const allStations = await query.orderBy(desc(stations.createdAt));
    res.json({ data: allStations });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 2. GET /api/stations/:id - Get a specific station WITH all its rocks & 3D structural measurements
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(rawId, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid station ID" });
      return;
    }

    // Drizzle Relational Query: fetches the station and embeds its rockSamples and structuralMeasurements!
    const station = await db.query.stations.findFirst({
      where: eq(stations.id, id),
      with: {
        rockSamples: true,
        structuralMeasurements: true,
      },
    });

    if (!station) {
      res.status(404).json({ error: `Station #${id} not found` });
      return;
    }

    res.json({ data: station });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 3. POST /api/stations - Create a new field observation station
router.post("/", async (req: Request, res: Response) => {
  try {
    const validatedData = createStationSchema.parse(req.body);

    const [newStation] = await db
      .insert(stations)
      .values(validatedData)
      .returning();

    res.status(201).json({ data: newStation });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues });
      return;
    }
    res.status(500).json({ error: error.message });
  }
});

// 4. PATCH /api/stations/:id - Update an existing station
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(rawId, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid station ID" });
      return;
    }

    const validatedUpdates = updateStationSchema.parse(req.body);

    const [updatedStation] = await db
      .update(stations)
      .set({ ...validatedUpdates, updatedAt: new Date() })
      .where(eq(stations.id, id))
      .returning();

    if (!updatedStation) {
      res.status(404).json({ error: `Station #${id} not found` });
      return;
    }

    res.json({ data: updatedStation });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues });
      return;
    }
    res.status(500).json({ error: error.message });
  }
});

// 5. DELETE /api/stations/:id - Delete a station (and its rocks/structures via cascade)
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(rawId, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid station ID" });
      return;
    }

    const [deletedStation] = await db
      .delete(stations)
      .where(eq(stations.id, id))
      .returning();

    if (!deletedStation) {
      res.status(404).json({ error: `Station #${id} not found` });
      return;
    }

    res.json({ message: `Station #${id} (${deletedStation.code}) deleted successfully` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

import { Router, Request, Response } from "express";
import { db } from "../db";
import { rockSamples, stations } from "../db/schema";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";

const router = Router({ mergeParams: true });

// Mineral Schema for empirical field observations and deductive identification
const mineralSchema = z.object({
  color: z.string().optional(),
  luster: z.string().optional(),
  habit: z.string().optional(),
  cleavage: z.string().optional(),
  fracture: z.string().optional(),
  streak: z.string().optional(),
  hardness: z.number().min(1).max(10, "Mohs hardness must be between 1 and 10").optional(),
  hclReaction: z.boolean().optional(),
  magnetism: z.boolean().optional(),
  probableMineral: z.string().optional(), // Inferred deduction: e.g. "Quartz", "Biotite"
});

// Zod Validation Schema for Rock Samples (MANDATORY PHOTOS!)
const createRockSampleSchema = z.object({
  sampleBagId: z.string().min(1, "Sample bag ID is required (e.g. SB-01)"),
  probableRock: z.string().optional(),
  grainSize: z.enum(["fine", "medium", "coarse", "pegmatitic"]).optional(),
  texture: z.string().optional(),
  maficPercent: z.number().min(0).max(100).optional(),
  felsicPercent: z.number().min(0).max(100).optional(),
  maficMinerals: z.array(mineralSchema).default([]),
  felsicMinerals: z.array(mineralSchema).default([]),
  // Every rock MUST have at least 1 photo URL (Cloudflare R2)
  photoUrls: z
    .array(z.string().url("Must be a valid Cloudflare R2 image URL"))
    .min(1, "Every rock sample must have at least one photo attached!"),
  notes: z.string().optional(),
});

// Partial schema for updates
const updateRockSampleSchema = createRockSampleSchema.partial();

// 1. GET /api/stations/:stationId/rocks - List all rocks collected at a station
router.get("/stations/:stationId/rocks", async (req: Request, res: Response) => {
  try {
    const rawStationId = Array.isArray(req.params.stationId)
      ? req.params.stationId[0]
      : req.params.stationId;
    const stationId = parseInt(rawStationId, 10);

    if (isNaN(stationId)) {
      res.status(400).json({ error: "Invalid station ID" });
      return;
    }

    const samples = await db
      .select()
      .from(rockSamples)
      .where(eq(rockSamples.stationId, stationId))
      .orderBy(desc(rockSamples.createdAt));

    res.json({ data: samples });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 2. POST /api/stations/:stationId/rocks - Add a rock sample to a station
router.post("/stations/:stationId/rocks", async (req: Request, res: Response) => {
  try {
    const rawStationId = Array.isArray(req.params.stationId)
      ? req.params.stationId[0]
      : req.params.stationId;
    const stationId = parseInt(rawStationId, 10);

    if (isNaN(stationId)) {
      res.status(400).json({ error: "Invalid station ID" });
      return;
    }

    // Check if the parent station exists first
    const station = await db
      .select({ id: stations.id })
      .from(stations)
      .where(eq(stations.id, stationId))
      .limit(1);

    if (station.length === 0) {
      res.status(404).json({ error: `Cannot add rock sample: Station #${stationId} not found` });
      return;
    }

    // Validate payload (enforces at least 1 photo URL!)
    const validatedData = createRockSampleSchema.parse(req.body);

    const [newSample] = await db
      .insert(rockSamples)
      .values({
        ...validatedData,
        stationId,
      })
      .returning();

    res.status(201).json({ data: newSample });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues });
      return;
    }
    res.status(500).json({ error: error.message });
  }
});

// 3. GET /api/rocks/:id - Get one rock sample by its ID
router.get("/rocks/:id", async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(rawId, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid rock sample ID" });
      return;
    }

    const [sample] = await db
      .select()
      .from(rockSamples)
      .where(eq(rockSamples.id, id))
      .limit(1);

    if (!sample) {
      res.status(404).json({ error: `Rock sample #${id} not found` });
      return;
    }

    res.json({ data: sample });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 4. PATCH /api/rocks/:id - Update rock sample details
router.patch("/rocks/:id", async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(rawId, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid rock sample ID" });
      return;
    }

    const validatedUpdates = updateRockSampleSchema.parse(req.body);

    const [updatedSample] = await db
      .update(rockSamples)
      .set({
        ...validatedUpdates,
        updatedAt: new Date(),
      })
      .where(eq(rockSamples.id, id))
      .returning();

    if (!updatedSample) {
      res.status(404).json({ error: `Rock sample #${id} not found` });
      return;
    }

    res.json({ data: updatedSample });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues });
      return;
    }
    res.status(500).json({ error: error.message });
  }
});

// 5. DELETE /api/rocks/:id - Delete a rock sample
router.delete("/rocks/:id", async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(rawId, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid rock sample ID" });
      return;
    }

    const [deletedSample] = await db
      .delete(rockSamples)
      .where(eq(rockSamples.id, id))
      .returning();

    if (!deletedSample) {
      res.status(404).json({ error: `Rock sample #${id} not found` });
      return;
    }

    res.json({ message: `Rock sample #${id} (${deletedSample.sampleBagId}) deleted successfully` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

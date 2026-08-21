import { Router, Request, Response } from "express";
import { db } from "../db";
import { structuralMeasurements, stations } from "../db/schema";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";

const router = Router({ mergeParams: true });

// Zod Validation Schema for 3D Structural Geology Measurements
const createStructuralMeasurementSchema = z.object({
  structureType: z.enum([
    "foliation",
    "bedding",
    "fault",
    "joint",
    "fold",
    "lineation",
    "vein",
    "shear_zone",
    "contact",
  ]),
  // Strike: 0° to <360° (Compass Azimuth / Right-Hand Rule)
  strike: z.number().min(0).max(359.999, "Strike must be between 0° and 359.99°").optional(),
  // Dip Angle: 0° (flat horizontal) to 90° (vertical)
  dipAngle: z.number().min(0).max(90, "Dip angle must be between 0° and 90°").optional(),
  // Dip Direction: 0° to <360° Azimuth
  dipDirection: z.number().min(0).max(359.999, "Dip direction must be between 0° and 359.99°").optional(),
  // Fold Type (if structure is a fold)
  foldType: z.enum(["anticline", "syncline", "monocline", "chevron", "isoclinal", "overturned"]).optional(),
  // Plunge (0° to 90° inclination for fold axis / lineation)
  plunge: z.number().min(0).max(90, "Plunge must be between 0° and 90°").optional(),
  // Trend (0° to <360° azimuth for fold axis / lineation)
  trend: z.number().min(0).max(359.999, "Trend must be between 0° and 359.99°").optional(),
  notes: z.string().optional(),
});

const updateStructuralMeasurementSchema = createStructuralMeasurementSchema.partial();

// 1. GET /api/stations/:stationId/structures - List all measurements at a station
router.get("/stations/:stationId/structures", async (req: Request, res: Response) => {
  try {
    const rawStationId = Array.isArray(req.params.stationId)
      ? req.params.stationId[0]
      : req.params.stationId;
    const stationId = parseInt(rawStationId, 10);

    if (isNaN(stationId)) {
      res.status(400).json({ error: "Invalid station ID" });
      return;
    }

    const measurements = await db
      .select()
      .from(structuralMeasurements)
      .where(eq(structuralMeasurements.stationId, stationId))
      .orderBy(desc(structuralMeasurements.createdAt));

    res.json({ data: measurements });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 2. POST /api/stations/:stationId/structures - Add a 3D structural measurement
router.post("/stations/:stationId/structures", async (req: Request, res: Response) => {
  try {
    const rawStationId = Array.isArray(req.params.stationId)
      ? req.params.stationId[0]
      : req.params.stationId;
    const stationId = parseInt(rawStationId, 10);

    if (isNaN(stationId)) {
      res.status(400).json({ error: "Invalid station ID" });
      return;
    }

    // Check if station exists
    const station = await db
      .select({ id: stations.id })
      .from(stations)
      .where(eq(stations.id, stationId))
      .limit(1);

    if (station.length === 0) {
      res.status(404).json({ error: `Cannot record measurement: Station #${stationId} not found` });
      return;
    }

    const validatedData = createStructuralMeasurementSchema.parse(req.body);

    const [newMeasurement] = await db
      .insert(structuralMeasurements)
      .values({
        ...validatedData,
        stationId,
      })
      .returning();

    res.status(201).json({ data: newMeasurement });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues });
      return;
    }
    res.status(500).json({ error: error.message });
  }
});

// 3. GET /api/structures/:id - Get a specific measurement by ID
router.get("/structures/:id", async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(rawId, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid measurement ID" });
      return;
    }

    const [measurement] = await db
      .select()
      .from(structuralMeasurements)
      .where(eq(structuralMeasurements.id, id))
      .limit(1);

    if (!measurement) {
      res.status(404).json({ error: `Structural measurement #${id} not found` });
      return;
    }

    res.json({ data: measurement });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 4. PATCH /api/structures/:id - Update measurement details
router.patch("/structures/:id", async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(rawId, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid measurement ID" });
      return;
    }

    const validatedUpdates = updateStructuralMeasurementSchema.parse(req.body);

    const [updatedMeasurement] = await db
      .update(structuralMeasurements)
      .set(validatedUpdates)
      .where(eq(structuralMeasurements.id, id))
      .returning();

    if (!updatedMeasurement) {
      res.status(404).json({ error: `Structural measurement #${id} not found` });
      return;
    }

    res.json({ data: updatedMeasurement });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues });
      return;
    }
    res.status(500).json({ error: error.message });
  }
});

// 5. DELETE /api/structures/:id - Delete a structural measurement
router.delete("/structures/:id", async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(rawId, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid measurement ID" });
      return;
    }

    const [deletedMeasurement] = await db
      .delete(structuralMeasurements)
      .where(eq(structuralMeasurements.id, id))
      .returning();

    if (!deletedMeasurement) {
      res.status(404).json({ error: `Structural measurement #${id} not found` });
      return;
    }

    res.json({ message: `Structural measurement #${id} deleted successfully` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

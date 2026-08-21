import { Router, Request, Response } from "express";
import { db } from "../db";
import { boreholes, projects } from "../db/schema";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";

const router = Router({ mergeParams: true });

// Zod Schema for Borehole & Hydrogeological Data
const createBoreholeSchema = z.object({
  projectId: z.number().optional(),
  boreholeNumber: z.string().min(1, "Borehole number is required (e.g. BH-01)"),
  name: z.string().min(1, "Borehole/Location name is required"),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  elevation: z.number().optional(),
  totalDepth: z.number().nonnegative("Total depth must be >= 0").optional(),
  staticWaterLevel: z.number().nonnegative("SWL must be >= 0").optional(),
  dynamicWaterLevel: z.number().nonnegative("DWL must be >= 0").optional(),
  dischargeRate: z.number().nonnegative("Discharge rate must be >= 0").optional(),
  aquiferType: z.enum(["unconfined", "confined", "semi_confined", "fractured_basement", "alluvial", "sedimentary"]).optional(),
  aquiferDepths: z
    .array(
      z.object({
        fromDepth: z.number().nonnegative(),
        toDepth: z.number().nonnegative(),
        yieldEstimate: z.string().optional(),
      })
    )
    .default([]),
  lithologyLogs: z
    .array(
      z.object({
        fromDepth: z.number().nonnegative(),
        toDepth: z.number().nonnegative(),
        formationName: z.string().min(1),
        description: z.string().optional(),
        color: z.string().optional(),
      })
    )
    .default([]),
  waterQuality: z
    .object({
      pH: z.number().min(0).max(14).optional(),
      tdsPpm: z.number().nonnegative().optional(),
      electricalConductivityUsCm: z.number().nonnegative().optional(),
      salinityPpt: z.number().nonnegative().optional(),
      temperatureCelsius: z.number().optional(),
      turbidityNtu: z.number().nonnegative().optional(),
      potabilityStatus: z.enum(["potable", "requires_treatment", "non_potable"]).optional(),
    })
    .default({}),
  vesSoundings: z
    .array(
      z.object({
        ab2: z.number().positive("AB/2 must be positive"),
        mn2: z.number().positive("MN/2 must be positive"),
        apparentResistivityOhmM: z.number().nonnegative("Resistivity must be >= 0"),
      })
    )
    .default([]),
  pumpingTestLogs: z
    .array(
      z.object({
        elapsedTimeMinutes: z.number().nonnegative(),
        waterLevelMbgl: z.number().nonnegative(),
        drawdownMeters: z.number().nonnegative(),
        dischargeYieldM3Hr: z.number().nonnegative(),
      })
    )
    .default([]),
  photoUrls: z.array(z.string().url()).default([]),
  notes: z.string().optional(),
});

const updateBoreholeSchema = createBoreholeSchema.partial();

// 1. GET /api/boreholes - List all boreholes (or filter by project)
router.get("/boreholes", async (req: Request, res: Response) => {
  try {
    const projectIdQuery = req.query.projectId as string | undefined;

    let query = db.select().from(boreholes);

    if (projectIdQuery) {
      const pid = parseInt(projectIdQuery, 10);
      if (!isNaN(pid)) {
        const results = await db
          .select()
          .from(boreholes)
          .where(eq(boreholes.projectId, pid))
          .orderBy(desc(boreholes.createdAt));
        res.json({ data: results });
        return;
      }
    }

    const allBoreholes = await query.orderBy(desc(boreholes.createdAt));
    res.json({ data: allBoreholes });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 2. GET /api/projects/:projectId/boreholes - List boreholes in a specific project
router.get("/projects/:projectId/boreholes", async (req: Request, res: Response) => {
  try {
    const rawProjectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
    const projectId = parseInt(rawProjectId, 10);

    if (isNaN(projectId)) {
      res.status(400).json({ error: "Invalid project ID" });
      return;
    }

    const results = await db
      .select()
      .from(boreholes)
      .where(eq(boreholes.projectId, projectId))
      .orderBy(desc(boreholes.createdAt));

    res.json({ data: results });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 3. POST /api/boreholes (or /api/projects/:projectId/boreholes) - Create a borehole record
router.post("/boreholes", async (req: Request, res: Response) => {
  try {
    const validatedData = createBoreholeSchema.parse(req.body);

    const [newBorehole] = await db
      .insert(boreholes)
      .values(validatedData)
      .returning();

    res.status(201).json({ data: newBorehole });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues });
      return;
    }
    res.status(500).json({ error: error.message });
  }
});

router.post("/projects/:projectId/boreholes", async (req: Request, res: Response) => {
  try {
    const rawProjectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
    const projectId = parseInt(rawProjectId, 10);

    if (isNaN(projectId)) {
      res.status(400).json({ error: "Invalid project ID" });
      return;
    }

    const validatedData = createBoreholeSchema.parse({
      ...req.body,
      projectId,
    });

    const [newBorehole] = await db
      .insert(boreholes)
      .values(validatedData)
      .returning();

    res.status(201).json({ data: newBorehole });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues });
      return;
    }
    res.status(500).json({ error: error.message });
  }
});

// 4. GET /api/boreholes/:id - Get a single borehole with lithology & pumping test logs
router.get("/boreholes/:id", async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(rawId, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid borehole ID" });
      return;
    }

    const [borehole] = await db
      .select()
      .from(boreholes)
      .where(eq(boreholes.id, id))
      .limit(1);

    if (!borehole) {
      res.status(404).json({ error: `Borehole #${id} not found` });
      return;
    }

    res.json({ data: borehole });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 5. PATCH /api/boreholes/:id - Update borehole details
router.patch("/boreholes/:id", async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(rawId, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid borehole ID" });
      return;
    }

    const validatedUpdates = updateBoreholeSchema.parse(req.body);

    const [updatedBorehole] = await db
      .update(boreholes)
      .set({
        ...validatedUpdates,
        updatedAt: new Date(),
      })
      .where(eq(boreholes.id, id))
      .returning();

    if (!updatedBorehole) {
      res.status(404).json({ error: `Borehole #${id} not found` });
      return;
    }

    res.json({ data: updatedBorehole });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues });
      return;
    }
    res.status(500).json({ error: error.message });
  }
});

// 6. DELETE /api/boreholes/:id - Delete a borehole
router.delete("/boreholes/:id", async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(rawId, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid borehole ID" });
      return;
    }

    const [deleted] = await db
      .delete(boreholes)
      .where(eq(boreholes.id, id))
      .returning();

    if (!deleted) {
      res.status(404).json({ error: `Borehole #${id} not found` });
      return;
    }

    res.json({ message: `Borehole #${id} (${deleted.boreholeNumber}) deleted successfully` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

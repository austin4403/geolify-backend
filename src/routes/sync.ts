import { Router, Request, Response } from "express";
import { db } from "../db";
import { stations, rockSamples, structuralMeasurements, boreholes } from "../db/schema";
import { requireAuth, requireProjectRole } from "../middleware/auth";
import { eq, and, gt, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { broadcastProjectEvent } from "./events";

const router = Router({ mergeParams: true });

// Schema for client sync mutations
const stationSyncSchema = z.object({
  id: z.number().optional(),
  clientUuid: z.string().uuid(),
  code: z.string().min(1),
  name: z.string().min(1),
  latitude: z.number(),
  longitude: z.number(),
  elevation: z.number().optional(),
  gpsAccuracy: z.number().optional(),
  vegetation: z.string().optional(),
  soilDescription: z.string().optional(),
  landmarks: z.string().optional(),
  outcropExposure: z.string().optional(),
  weathering: z.string().optional(),
  photoUrls: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  deletedAt: z.string().datetime().optional().nullable(),
  updatedAt: z.string().datetime(),
});

const rockSampleSyncSchema = z.object({
  id: z.number().optional(),
  clientUuid: z.string().uuid(),
  stationClientUuid: z.string().uuid().optional(),
  stationId: z.number().optional(),
  sampleBagId: z.string().min(1),
  probableRock: z.string().optional(),
  grainSize: z.string().optional(),
  texture: z.string().optional(),
  maficPercent: z.number().optional(),
  felsicPercent: z.number().optional(),
  maficMinerals: z.array(z.any()).optional(),
  felsicMinerals: z.array(z.any()).optional(),
  photoUrls: z.array(z.string()).default([]),
  notes: z.string().optional(),
  deletedAt: z.string().datetime().optional().nullable(),
  updatedAt: z.string().datetime(),
});

const structuralMeasurementSyncSchema = z.object({
  id: z.number().optional(),
  clientUuid: z.string().uuid(),
  stationClientUuid: z.string().uuid().optional(),
  stationId: z.number().optional(),
  structureType: z.string().min(1),
  strike: z.number().optional(),
  dipAngle: z.number().optional(),
  dipDirection: z.number().optional(),
  foldType: z.string().optional(),
  plunge: z.number().optional(),
  trend: z.number().optional(),
  notes: z.string().optional(),
  deletedAt: z.string().datetime().optional().nullable(),
  updatedAt: z.string().datetime(),
});

const boreholeSyncSchema = z.object({
  id: z.number().optional(),
  clientUuid: z.string().uuid(),
  boreholeNumber: z.string().min(1),
  name: z.string().min(1),
  latitude: z.number(),
  longitude: z.number(),
  elevation: z.number().optional(),
  totalDepth: z.number().optional(),
  staticWaterLevel: z.number().optional(),
  dynamicWaterLevel: z.number().optional(),
  dischargeRate: z.number().optional(),
  aquiferType: z.string().optional(),
  aquiferDepths: z.array(z.any()).optional(),
  lithologyLogs: z.array(z.any()).optional(),
  waterQuality: z.record(z.string(), z.any()).optional(),
  vesSoundings: z.array(z.any()).optional(),
  pumpingTestLogs: z.array(z.any()).optional(),
  photoUrls: z.array(z.string()).optional(),
  notes: z.string().optional(),
  deletedAt: z.string().datetime().optional().nullable(),
  updatedAt: z.string().datetime(),
});

const syncPushPayloadSchema = z.object({
  stations: z.array(stationSyncSchema).default([]),
  rockSamples: z.array(rockSampleSyncSchema).default([]),
  structuralMeasurements: z.array(structuralMeasurementSyncSchema).default([]),
  boreholes: z.array(boreholeSyncSchema).default([]),
});

/**
 * Generic single-table Last-Write-Wins sync helper
 */
async function syncEntity<T extends { id?: number; clientUuid: string; updatedAt: string; deletedAt?: string | null }>(
  table: any,
  items: T[],
  prepareData: (item: T, existing?: any) => Record<string, any>,
  onSaved?: (item: T, id: number) => void
): Promise<number> {
  let processed = 0;
  for (const item of items) {
    const [existing] = await db
      .select()
      .from(table)
      .where(item.clientUuid ? eq(table.clientUuid, item.clientUuid) : item.id ? eq(table.id, item.id) : eq(table.id, -1))
      .limit(1);

    const clientUpdatedAt = new Date(item.updatedAt);
    const deletedAt = item.deletedAt ? new Date(item.deletedAt) : null;

    if (existing) {
      if (clientUpdatedAt >= existing.updatedAt) {
        const updateData = prepareData(item, existing);
        await db
          .update(table)
          .set({ ...updateData, deletedAt, updatedAt: new Date() })
          .where(eq(table.id, existing.id));
        onSaved?.(item, existing.id);
      }
    } else {
      const insertData = prepareData(item);
      const [inserted] = await db
        .insert(table)
        .values({ ...insertData, clientUuid: item.clientUuid, deletedAt, createdAt: clientUpdatedAt, updatedAt: new Date() })
        .returning({ id: table.id });
      if (inserted) {
        onSaved?.(item, inserted.id);
      }
    }
    processed++;
  }
  return processed;
}

/**
 * GET /api/projects/:projectId/sync/pull?since=ISOString
 * Returns all entities updated or soft-deleted since timestamp
 */
router.get(
  "/projects/:projectId/sync/pull",
  requireAuth,
  requireProjectRole("viewer"),
  async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.projectId as string, 10);
      const sinceQuery = req.query.since as string | undefined;
      const sinceDate = sinceQuery ? new Date(sinceQuery) : new Date(0);

      if (sinceQuery && isNaN(sinceDate.getTime())) {
        res.status(400).json({ error: "Invalid 'since' timestamp format. Use ISO 8601 string." });
        return;
      }

      const changedStations = await db
        .select()
        .from(stations)
        .where(and(eq(stations.projectId, projectId), gt(stations.updatedAt, sinceDate)));

      const allProjectStations = await db
        .select({ id: stations.id, clientUuid: stations.clientUuid })
        .from(stations)
        .where(eq(stations.projectId, projectId));

      const stationIds = allProjectStations.map((s) => s.id);

      let changedRocks: any[] = [];
      let changedStructures: any[] = [];

      if (stationIds.length > 0) {
        changedRocks = await db
          .select()
          .from(rockSamples)
          .where(and(inArray(rockSamples.stationId, stationIds), gt(rockSamples.updatedAt, sinceDate)));

        changedStructures = await db
          .select()
          .from(structuralMeasurements)
          .where(and(inArray(structuralMeasurements.stationId, stationIds), gt(structuralMeasurements.updatedAt, sinceDate)));
      }

      const changedBoreholes = await db
        .select()
        .from(boreholes)
        .where(and(eq(boreholes.projectId, projectId), gt(boreholes.updatedAt, sinceDate)));

      res.json({
        syncedAt: new Date().toISOString(),
        projectId,
        stations: changedStations,
        rockSamples: changedRocks,
        structuralMeasurements: changedStructures,
        boreholes: changedBoreholes,
      });
    } catch (error: any) {
      res.status(500).json({ error: "Sync pull failed: " + error.message });
    }
  }
);

/**
 * POST /api/projects/:projectId/sync/push
 * Ingests offline batch mutations with Last-Write-Wins conflict resolution
 */
router.post(
  "/projects/:projectId/sync/push",
  requireAuth,
  requireProjectRole("editor"),
  async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.projectId as string, 10);
      const parsed = syncPushPayloadSchema.parse(req.body);
      const stationIdMap = new Map<string, number>();

      // 1. Process Stations
      const processedStations = await syncEntity(
        stations,
        parsed.stations,
        (st, existing) => ({
          projectId,
          code: st.code,
          name: st.name,
          latitude: st.latitude,
          longitude: st.longitude,
          elevation: st.elevation ?? existing?.elevation,
          gpsAccuracy: st.gpsAccuracy ?? existing?.gpsAccuracy,
          vegetation: st.vegetation ?? existing?.vegetation,
          soilDescription: st.soilDescription ?? existing?.soilDescription,
          landmarks: st.landmarks ?? existing?.landmarks,
          outcropExposure: st.outcropExposure ?? existing?.outcropExposure,
          weathering: st.weathering ?? existing?.weathering,
          photoUrls: existing ? Array.from(new Set([...(existing.photoUrls || []), ...(st.photoUrls || [])])) : (st.photoUrls || []),
          metadata: { ...(existing?.metadata || {}), ...(st.metadata || {}) },
        }),
        (st, id) => stationIdMap.set(st.clientUuid, id)
      );

      // Preload remaining stations for clientUuid resolution
      const allStations = await db.select({ id: stations.id, clientUuid: stations.clientUuid }).from(stations).where(eq(stations.projectId, projectId));
      for (const s of allStations) {
        if (s.clientUuid && !stationIdMap.has(s.clientUuid)) stationIdMap.set(s.clientUuid, s.id);
      }

      // 2. Process Rock Samples
      const validRocks = parsed.rockSamples.filter((rk) => rk.stationId || (rk.stationClientUuid && stationIdMap.has(rk.stationClientUuid)));
      const processedRocks = await syncEntity(
        rockSamples,
        validRocks,
        (rk, existing) => ({
          stationId: rk.stationId || (rk.stationClientUuid ? stationIdMap.get(rk.stationClientUuid) : undefined),
          sampleBagId: rk.sampleBagId,
          probableRock: rk.probableRock,
          grainSize: rk.grainSize,
          texture: rk.texture,
          maficPercent: rk.maficPercent,
          felsicPercent: rk.felsicPercent,
          maficMinerals: rk.maficMinerals || [],
          felsicMinerals: rk.felsicMinerals || [],
          photoUrls: existing ? Array.from(new Set([...(existing.photoUrls || []), ...(rk.photoUrls || [])])) : (rk.photoUrls || []),
          notes: rk.notes,
        })
      );

      // 3. Process Structural Measurements
      const validStructures = parsed.structuralMeasurements.filter((st) => st.stationId || (st.stationClientUuid && stationIdMap.has(st.stationClientUuid)));
      const processedStructures = await syncEntity(
        structuralMeasurements,
        validStructures,
        (st) => ({
          stationId: st.stationId || (st.stationClientUuid ? stationIdMap.get(st.stationClientUuid) : undefined),
          structureType: st.structureType,
          strike: st.strike,
          dipAngle: st.dipAngle,
          dipDirection: st.dipDirection,
          foldType: st.foldType,
          plunge: st.plunge,
          trend: st.trend,
          notes: st.notes,
        })
      );

      // 4. Process Boreholes
      const processedBoreholes = await syncEntity(
        boreholes,
        parsed.boreholes,
        (bh) => ({
          projectId,
          boreholeNumber: bh.boreholeNumber,
          name: bh.name,
          latitude: bh.latitude,
          longitude: bh.longitude,
          elevation: bh.elevation,
          totalDepth: bh.totalDepth,
          staticWaterLevel: bh.staticWaterLevel,
          dynamicWaterLevel: bh.dynamicWaterLevel,
          dischargeRate: bh.dischargeRate,
          aquiferType: bh.aquiferType,
          aquiferDepths: bh.aquiferDepths || [],
          lithologyLogs: bh.lithologyLogs || [],
          waterQuality: bh.waterQuality || {},
          vesSoundings: bh.vesSoundings || [],
          pumpingTestLogs: bh.pumpingTestLogs || [],
          photoUrls: bh.photoUrls || [],
          notes: bh.notes,
        })
      );

      // Broadcast sync event to all active collaborators via SSE
      broadcastProjectEvent(projectId, "project:sync", {
        userId: req.user?.userId,
        timestamp: new Date().toISOString(),
        processed: {
          stations: processedStations,
          rockSamples: processedRocks,
          structuralMeasurements: processedStructures,
          boreholes: processedBoreholes,
        },
      });

      res.status(200).json({
        status: "success",
        syncedAt: new Date().toISOString(),
        processed: {
          stations: processedStations,
          rockSamples: processedRocks,
          structuralMeasurements: processedStructures,
          boreholes: processedBoreholes,
        },
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Validation error in sync payload", issues: error.issues });
        return;
      }
      res.status(500).json({ error: "Sync push failed: " + error.message });
    }
  }
);

/**
 * GET /api/projects/:projectId/sync/stats
 * Diagnostic sync summary for mobile clients
 */
router.get(
  "/projects/:projectId/sync/stats",
  requireAuth,
  requireProjectRole("viewer"),
  async (req: Request, res: Response) => {
    try {
      const projectId = parseInt(req.params.projectId as string, 10);
      res.json({
        projectId,
        serverTime: new Date().toISOString(),
        status: "healthy",
      });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to fetch sync stats: " + error.message });
    }
  }
);

export default router;

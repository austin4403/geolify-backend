import { Router, Request, Response } from "express";
import { db } from "../db";
import { stations, rockSamples, structuralMeasurements, boreholes } from "../db/schema";
import { requireAuth, requireProjectRole } from "../middleware/auth";
import { eq, and, gt, inArray, isNull, or } from "drizzle-orm";
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

      // 1. Fetch updated/created stations in this project
      const changedStations = await db
        .select()
        .from(stations)
        .where(
          and(
            eq(stations.projectId, projectId),
            gt(stations.updatedAt, sinceDate)
          )
        );

      // Get all station IDs in project for cascading children query
      const allProjectStations = await db
        .select({ id: stations.id, clientUuid: stations.clientUuid })
        .from(stations)
        .where(eq(stations.projectId, projectId));

      const stationIds = allProjectStations.map((s) => s.id);

      let changedRocks: any[] = [];
      let changedStructures: any[] = [];

      if (stationIds.length > 0) {
        // 2. Fetch updated rock samples
        changedRocks = await db
          .select()
          .from(rockSamples)
          .where(
            and(
              inArray(rockSamples.stationId, stationIds),
              gt(rockSamples.updatedAt, sinceDate)
            )
          );

        // 3. Fetch updated structural measurements
        changedStructures = await db
          .select()
          .from(structuralMeasurements)
          .where(
            and(
              inArray(structuralMeasurements.stationId, stationIds),
              gt(structuralMeasurements.updatedAt, sinceDate)
            )
          );
      }

      // 4. Fetch updated boreholes
      const changedBoreholes = await db
        .select()
        .from(boreholes)
        .where(
          and(
            eq(boreholes.projectId, projectId),
            gt(boreholes.updatedAt, sinceDate)
          )
        );

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

      // Preload existing stations in project into memory map
      const existingStations = await db
        .select({ id: stations.id, clientUuid: stations.clientUuid, updatedAt: stations.updatedAt })
        .from(stations)
        .where(eq(stations.projectId, projectId));

      for (const s of existingStations) {
        if (s.clientUuid) {
          stationIdMap.set(s.clientUuid, s.id);
        }
      }

      let processedStations = 0;
      let processedRocks = 0;
      let processedStructures = 0;
      let processedBoreholes = 0;

      // 1. Process Stations
      for (const st of parsed.stations) {
        const existing = existingStations.find(
          (s) => s.clientUuid === st.clientUuid || (st.id && s.id === st.id)
        );

        const clientUpdatedAt = new Date(st.updatedAt);
        const deletedAt = st.deletedAt ? new Date(st.deletedAt) : null;

        if (existing) {
          // Last-Write-Wins: update if incoming timestamp is >= server
          if (clientUpdatedAt >= existing.updatedAt) {
            await db
              .update(stations)
              .set({
                code: st.code,
                name: st.name,
                latitude: st.latitude,
                longitude: st.longitude,
                elevation: st.elevation,
                gpsAccuracy: st.gpsAccuracy,
                vegetation: st.vegetation,
                soilDescription: st.soilDescription,
                landmarks: st.landmarks,
                outcropExposure: st.outcropExposure,
                weathering: st.weathering,
                photoUrls: st.photoUrls || [],
                metadata: st.metadata || {},
                deletedAt,
                updatedAt: new Date(),
              })
              .where(eq(stations.id, existing.id));
            stationIdMap.set(st.clientUuid, existing.id);
          }
        } else {
          // Insert new station
          const [inserted] = await db
            .insert(stations)
            .values({
              projectId,
              clientUuid: st.clientUuid,
              code: st.code,
              name: st.name,
              latitude: st.latitude,
              longitude: st.longitude,
              elevation: st.elevation,
              gpsAccuracy: st.gpsAccuracy,
              vegetation: st.vegetation,
              soilDescription: st.soilDescription,
              landmarks: st.landmarks,
              outcropExposure: st.outcropExposure,
              weathering: st.weathering,
              photoUrls: st.photoUrls || [],
              metadata: st.metadata || {},
              deletedAt,
              createdAt: clientUpdatedAt,
              updatedAt: new Date(),
            })
            .returning({ id: stations.id });
          if (inserted) {
            stationIdMap.set(st.clientUuid, inserted.id);
          }
        }
        processedStations++;
      }

      // 2. Process Rock Samples
      for (const rk of parsed.rockSamples) {
        const resolvedStationId =
          rk.stationId || (rk.stationClientUuid ? stationIdMap.get(rk.stationClientUuid) : undefined);

        if (!resolvedStationId) {
          continue; // Cannot link rock without resolved station
        }

        const [existingRock] = await db
          .select({ id: rockSamples.id, updatedAt: rockSamples.updatedAt })
          .from(rockSamples)
          .where(
            rk.clientUuid
              ? eq(rockSamples.clientUuid, rk.clientUuid)
              : rk.id
              ? eq(rockSamples.id, rk.id)
              : eq(rockSamples.id, -1)
          )
          .limit(1);

        const clientUpdatedAt = new Date(rk.updatedAt);
        const deletedAt = rk.deletedAt ? new Date(rk.deletedAt) : null;

        if (existingRock) {
          if (clientUpdatedAt >= existingRock.updatedAt) {
            await db
              .update(rockSamples)
              .set({
                stationId: resolvedStationId,
                sampleBagId: rk.sampleBagId,
                probableRock: rk.probableRock,
                grainSize: rk.grainSize,
                texture: rk.texture,
                maficPercent: rk.maficPercent,
                felsicPercent: rk.felsicPercent,
                maficMinerals: rk.maficMinerals || [],
                felsicMinerals: rk.felsicMinerals || [],
                photoUrls: rk.photoUrls || [],
                notes: rk.notes,
                deletedAt,
                updatedAt: new Date(),
              })
              .where(eq(rockSamples.id, existingRock.id));
          }
        } else {
          await db.insert(rockSamples).values({
            stationId: resolvedStationId,
            clientUuid: rk.clientUuid,
            sampleBagId: rk.sampleBagId,
            probableRock: rk.probableRock,
            grainSize: rk.grainSize,
            texture: rk.texture,
            maficPercent: rk.maficPercent,
            felsicPercent: rk.felsicPercent,
            maficMinerals: rk.maficMinerals || [],
            felsicMinerals: rk.felsicMinerals || [],
            photoUrls: rk.photoUrls || [],
            notes: rk.notes,
            deletedAt,
            createdAt: clientUpdatedAt,
            updatedAt: new Date(),
          });
        }
        processedRocks++;
      }

      // 3. Process Structural Measurements
      for (const st of parsed.structuralMeasurements) {
        const resolvedStationId =
          st.stationId || (st.stationClientUuid ? stationIdMap.get(st.stationClientUuid) : undefined);

        if (!resolvedStationId) {
          continue;
        }

        const [existingStructure] = await db
          .select({ id: structuralMeasurements.id, updatedAt: structuralMeasurements.updatedAt })
          .from(structuralMeasurements)
          .where(
            st.clientUuid
              ? eq(structuralMeasurements.clientUuid, st.clientUuid)
              : st.id
              ? eq(structuralMeasurements.id, st.id)
              : eq(structuralMeasurements.id, -1)
          )
          .limit(1);

        const clientUpdatedAt = new Date(st.updatedAt);
        const deletedAt = st.deletedAt ? new Date(st.deletedAt) : null;

        if (existingStructure) {
          if (clientUpdatedAt >= existingStructure.updatedAt) {
            await db
              .update(structuralMeasurements)
              .set({
                stationId: resolvedStationId,
                structureType: st.structureType,
                strike: st.strike,
                dipAngle: st.dipAngle,
                dipDirection: st.dipDirection,
                foldType: st.foldType,
                plunge: st.plunge,
                trend: st.trend,
                notes: st.notes,
                deletedAt,
                updatedAt: new Date(),
              })
              .where(eq(structuralMeasurements.id, existingStructure.id));
          }
        } else {
          await db.insert(structuralMeasurements).values({
            stationId: resolvedStationId,
            clientUuid: st.clientUuid,
            structureType: st.structureType,
            strike: st.strike,
            dipAngle: st.dipAngle,
            dipDirection: st.dipDirection,
            foldType: st.foldType,
            plunge: st.plunge,
            trend: st.trend,
            notes: st.notes,
            deletedAt,
            createdAt: clientUpdatedAt,
            updatedAt: new Date(),
          });
        }
        processedStructures++;
      }

      // 4. Process Boreholes
      for (const bh of parsed.boreholes) {
        const [existingBorehole] = await db
          .select({ id: boreholes.id, updatedAt: boreholes.updatedAt })
          .from(boreholes)
          .where(
            bh.clientUuid
              ? eq(boreholes.clientUuid, bh.clientUuid)
              : bh.id
              ? eq(boreholes.id, bh.id)
              : eq(boreholes.id, -1)
          )
          .limit(1);

        const clientUpdatedAt = new Date(bh.updatedAt);
        const deletedAt = bh.deletedAt ? new Date(bh.deletedAt) : null;

        if (existingBorehole) {
          if (clientUpdatedAt >= existingBorehole.updatedAt) {
            await db
              .update(boreholes)
              .set({
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
                deletedAt,
                updatedAt: new Date(),
              })
              .where(eq(boreholes.id, existingBorehole.id));
          }
        } else {
          await db.insert(boreholes).values({
            projectId,
            clientUuid: bh.clientUuid,
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
            deletedAt,
            createdAt: clientUpdatedAt,
            updatedAt: new Date(),
          });
        }
        processedBoreholes++;
      }

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

export default router;

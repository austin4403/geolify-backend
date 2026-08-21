import { Router, Request, Response } from "express";
import { db } from "../db";
import { projects, stations, rockSamples, structuralMeasurements, boreholes } from "../db/schema";
import { eq } from "drizzle-orm";

const router = Router();

// 1. GET /api/projects/:projectId/export/geojson - GeoJSON FeatureCollection Export
router.get("/projects/:projectId/export/geojson", async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
    const projectId = parseInt(rawId, 10);

    if (isNaN(projectId)) {
      res.status(400).json({ error: "Invalid project ID" });
      return;
    }

    const project = await db.query.projects.findFirst({
      where: eq(projects.id, projectId),
      with: {
        stations: {
          with: {
            rockSamples: true,
            structuralMeasurements: true,
          },
        },
        boreholes: true,
      },
    });

    if (!project) {
      res.status(404).json({ error: `Project #${projectId} not found` });
      return;
    }

    const features: any[] = [];

    // Add stations and rocks as Point features
    project.stations.forEach((st) => {
      features.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [st.longitude, st.latitude, st.elevation || 0],
        },
        properties: {
          featureType: "geological_station",
          id: st.id,
          code: st.code,
          name: st.name,
          exposure: st.outcropExposure,
          weathering: st.weathering,
          vegetation: st.vegetation,
          soil: st.soilDescription,
          landmarks: st.landmarks,
          rockSamplesCount: st.rockSamples.length,
          rockSamples: st.rockSamples.map((r) => ({
            bagId: r.sampleBagId,
            probableRock: r.probableRock,
            grainSize: r.grainSize,
            texture: r.texture,
            maficPercent: r.maficPercent,
            felsicPercent: r.felsicPercent,
          })),
          structuralMeasurements: st.structuralMeasurements.map((s) => ({
            type: s.structureType,
            strike: s.strike,
            dipAngle: s.dipAngle,
            dipDirection: s.dipDirection,
            foldType: s.foldType,
          })),
        },
      });
    });

    // Add boreholes as Point features
    project.boreholes.forEach((bh) => {
      features.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [bh.longitude, bh.latitude, bh.elevation || 0],
        },
        properties: {
          featureType: "hydrogeological_borehole",
          id: bh.id,
          boreholeNumber: bh.boreholeNumber,
          name: bh.name,
          totalDepth: bh.totalDepth,
          staticWaterLevel: bh.staticWaterLevel,
          dynamicWaterLevel: bh.dynamicWaterLevel,
          dischargeRate: bh.dischargeRate,
          aquiferType: bh.aquiferType,
          waterQuality: bh.waterQuality,
        },
      });
    });

    const geoJson = {
      type: "FeatureCollection",
      metadata: {
        projectId: project.id,
        projectName: project.name,
        projectType: project.projectType,
        exportedAt: new Date().toISOString(),
        totalFeatures: features.length,
      },
      features,
    };

    res.setHeader("Content-Disposition", `attachment; filename="geolify-project-${project.id}.geojson"`);
    res.setHeader("Content-Type", "application/geo+json");
    res.json(geoJson);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 2. GET /api/projects/:projectId/export/csv - CSV Tabular Data Export
router.get("/projects/:projectId/export/csv", async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
    const projectId = parseInt(rawId, 10);
    const target = (req.query.target as string) || "samples"; // "samples", "stations", "boreholes", "structures"

    if (isNaN(projectId)) {
      res.status(400).json({ error: "Invalid project ID" });
      return;
    }

    if (target === "boreholes") {
      const bList = await db.select().from(boreholes).where(eq(boreholes.projectId, projectId));
      let csv = "ID,Borehole_Number,Name,Latitude,Longitude,Elevation_m,Total_Depth_m,SWL_mbgl,DWL_mbgl,Discharge_Yield,Aquifer_Type\n";
      bList.forEach((b) => {
        csv += `${b.id},"${b.boreholeNumber}","${b.name}",${b.latitude},${b.longitude},${b.elevation || ""},${b.totalDepth || ""},${b.staticWaterLevel || ""},${b.dynamicWaterLevel || ""},${b.dischargeRate || ""},"${b.aquiferType || ""}"\n`;
      });

      res.setHeader("Content-Disposition", `attachment; filename="boreholes-project-${projectId}.csv"`);
      res.setHeader("Content-Type", "text/csv");
      res.send(csv);
      return;
    }

    // Default: Rock Samples CSV
    const stList = await db.query.stations.findMany({
      where: eq(stations.projectId, projectId),
      with: { rockSamples: true },
    });

    let csv = "Station_Code,Station_Name,Sample_Bag_ID,Probable_Rock,Grain_Size,Texture,Mafic_Percent,Felsic_Percent,Latitude,Longitude,Notes\n";
    stList.forEach((st) => {
      st.rockSamples.forEach((r) => {
        csv += `"${st.code}","${st.name}","${r.sampleBagId}","${r.probableRock || ""}","${r.grainSize || ""}","${r.texture || ""}",${r.maficPercent || ""},${r.felsicPercent || ""},${st.latitude},${st.longitude},"${(r.notes || "").replace(/"/g, '""')}"\n`;
      });
    });

    res.setHeader("Content-Disposition", `attachment; filename="rock-samples-project-${projectId}.csv"`);
    res.setHeader("Content-Type", "text/csv");
    res.send(csv);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 3. GET /api/projects/:projectId/export/summary - Complete Executive Summary Report
router.get("/projects/:projectId/export/summary", async (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
    const projectId = parseInt(rawId, 10);

    if (isNaN(projectId)) {
      res.status(400).json({ error: "Invalid project ID" });
      return;
    }

    const project = await db.query.projects.findFirst({
      where: eq(projects.id, projectId),
      with: {
        collaborators: true,
        stations: {
          with: {
            rockSamples: true,
            structuralMeasurements: true,
          },
        },
        boreholes: true,
      },
    });

    if (!project) {
      res.status(404).json({ error: `Project #${projectId} not found` });
      return;
    }

    const totalStations = project.stations.length;
    const totalRocks = project.stations.reduce((acc, s) => acc + s.rockSamples.length, 0);
    const totalStructures = project.stations.reduce((acc, s) => acc + s.structuralMeasurements.length, 0);
    const totalBoreholes = project.boreholes.length;

    res.json({
      reportTitle: `Geolify Survey Report — ${project.name}`,
      project: {
        id: project.id,
        name: project.name,
        type: project.projectType,
        clientOrOrg: project.clientOrOrg,
        status: project.status,
        createdAt: project.createdAt,
      },
      metrics: {
        totalStations,
        totalRocksCollected: totalRocks,
        totalStructuralMeasurements: totalStructures,
        totalBoreholesSurveyed: totalBoreholes,
        collaboratorsCount: project.collaborators.length,
      },
      data: {
        stations: project.stations,
        boreholes: project.boreholes,
        collaborators: project.collaborators,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

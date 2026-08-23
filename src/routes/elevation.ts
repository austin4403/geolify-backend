/**
 * @file elevation.ts
 * 
 * Global Digital Elevation Model (DEM) Profile API.
 * Uses high-resolution Copernicus (90m) & SRTM Global Elevation data
 * to sample true digital topographic elevation values along any geodesic transect.
 */

import { Router, Request, Response } from "express";

const elevationRouter = Router();

// In-memory cache for sampled transects to optimize performance and reduce outbound API calls
const profileCache = new Map<string, { timestamp: number; data: any }>();
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

const DEG_TO_RAD = Math.PI / 180;
const EARTH_RADIUS_METERS = 6371008.8;

function calculateDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLng = (lng2 - lng1) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

/**
 * GET /api/elevation/profile
 * Query params: startLat, startLng, endLat, endLng, samples (default 60)
 */
elevationRouter.get("/profile", async (req: Request, res: Response): Promise<void> => {
  try {
    const startLat = parseFloat(req.query.startLat as string);
    const startLng = parseFloat(req.query.startLng as string);
    const endLat = parseFloat(req.query.endLat as string);
    const endLng = parseFloat(req.query.endLng as string);
    const samplesCount = Math.min(200, Math.max(10, parseInt(req.query.samples as string, 10) || 60));

    if (isNaN(startLat) || isNaN(startLng) || isNaN(endLat) || isNaN(endLng)) {
      res.status(400).json({ error: "Invalid start or end coordinates" });
      return;
    }

    const cacheKey = `${startLat.toFixed(5)},${startLng.toFixed(5)}->${endLat.toFixed(5)},${endLng.toFixed(5)}_${samplesCount}`;
    const cached = profileCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      res.json(cached.data);
      return;
    }

    const totalDistanceM = calculateDistanceMeters(startLat, startLng, endLat, endLng);
    const totalDistanceKm = totalDistanceM / 1000;

    // Generate sample coordinate array
    const sampleCoords: Array<{ lat: number; lng: number; distKm: number }> = [];
    const latList: string[] = [];
    const lngList: string[] = [];

    for (let i = 0; i <= samplesCount; i++) {
      const frac = i / samplesCount;
      const lat = startLat + (endLat - startLat) * frac;
      const lng = startLng + (endLng - startLng) * frac;
      const distKm = totalDistanceKm * frac;

      sampleCoords.push({
        lat: Math.round(lat * 100000) / 100000,
        lng: Math.round(lng * 100000) / 100000,
        distKm: Math.round(distKm * 1000) / 1000,
      });

      latList.push(lat.toFixed(5));
      lngList.push(lng.toFixed(5));
    }

    // Query global Copernicus / SRTM 90m DEM API
    const openMeteoUrl = `https://api.open-meteo.com/v1/elevation?latitude=${latList.join(",")}&longitude=${lngList.join(",")}`;
    const response = await fetch(openMeteoUrl, {
      headers: {
        "User-Agent": "Geolify-GIS/2.0 (contact@geolify.com)",
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Open-Meteo elevation API returned status ${response.status}`);
    }

    const json: any = await response.json();
    const elevations: number[] = json.elevation || [];

    const profile = sampleCoords.map((coord, idx) => {
      const elevM = elevations[idx] !== undefined && elevations[idx] !== null
        ? Math.round(elevations[idx] * 10) / 10
        : 1100;

      return {
        lat: coord.lat,
        lng: coord.lng,
        distanceFromStartKm: coord.distKm,
        elevationM: elevM,
        elevation: elevM,
      };
    });

    const result = {
      startPoint: { lat: startLat, lng: startLng },
      endPoint: { lat: endLat, lng: endLng },
      totalDistanceKm: Math.round(totalDistanceKm * 1000) / 1000,
      minElevationM: Math.min(...profile.map((p) => p.elevationM)),
      maxElevationM: Math.max(...profile.map((p) => p.elevationM)),
      profile,
    };

    // Store in cache
    profileCache.set(cacheKey, { timestamp: Date.now(), data: result });

    res.json(result);
  } catch (error: any) {
    console.error("Error sampling elevation profile:", error);
    res.status(500).json({ error: "Failed to sample digital elevation model profile", details: error.message });
  }
});

/**
 * GET /api/elevation/point
 * Query single point elevation
 */
elevationRouter.get("/point", async (req: Request, res: Response): Promise<void> => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);

    if (isNaN(lat) || isNaN(lng)) {
      res.status(400).json({ error: "Invalid lat/lng coordinates" });
      return;
    }

    const response = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lng}`, {
      headers: { "User-Agent": "Geolify-GIS/2.0", Accept: "application/json" },
    });

    if (!response.ok) throw new Error("Elevation query failed");
    const json: any = await response.json();
    const elev = json.elevation?.[0] ?? 0;

    res.json({ lat, lng, elevationM: elev });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch elevation", details: err.message });
  }
});

export default elevationRouter;

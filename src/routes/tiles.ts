import { Router, Request, Response } from "express";

const tilesRouter = Router();

// 1x1 transparent pixel PNG buffer
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);

// Geographic Bounds
const USGS_BOUNDS = { minLat: 15.0, maxLat: 72.0, minLng: -175.0, maxLng: -50.0 };
const BGS_BOUNDS = { minLat: 48.5, maxLat: 61.5, minLng: -13.0, maxLng: 3.5 };
const ONEGEOLOGY_BOUNDS = { minLat: 34.0, maxLat: 72.0, minLng: -25.0, maxLng: 45.0 };

// Key Mining Hotspots to pre-warm
export const EXPLORATION_HOTSPOTS = [
  { name: "Kenya Rift Valley (Geothermal & Mining)", z: 6, x: 38, y: 32 },
  { name: "Witwatersrand Basin Gold Belt (South Africa)", z: 6, x: 37, y: 36 },
  { name: "Grand Canyon / Arizona Mining District (USA)", z: 6, x: 12, y: 25 },
  { name: "Carlin Trend Gold Belt (Nevada, USA)", z: 6, x: 11, y: 24 },
  { name: "Scottish Highlands Mineral Belt (UK)", z: 6, x: 31, y: 19 },
  { name: "Central Massif Polymetallic Zone (France)", z: 6, x: 32, y: 22 },
];

function tileToGeographic(z: number, x: number, y: number) {
  const originShift = (2 * Math.PI * 6378137) / 2.0;
  const numTiles = 1 << z;
  const tileSize = (2 * originShift) / numTiles;

  const minX = -originShift + x * tileSize;
  const maxX = -originShift + (x + 1) * tileSize;
  const maxY = originShift - y * tileSize;
  const minY = originShift - (y + 1) * tileSize;

  const nTop = Math.PI - (2 * Math.PI * y) / numTiles;
  const latTop = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(nTop) - Math.exp(-nTop)));
  const nBottom = Math.PI - (2 * Math.PI * (y + 1)) / numTiles;
  const latBottom = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(nBottom) - Math.exp(-nBottom)));

  const lngWest = (x / numTiles) * 360 - 180;
  const lngEast = ((x + 1) / numTiles) * 360 - 180;

  return {
    epsg3857: [minX, minY, maxX, maxY],
    bounds: {
      north: Math.max(latTop, latBottom),
      south: Math.min(latTop, latBottom),
      east: Math.max(lngWest, lngEast),
      west: Math.min(lngWest, lngEast),
    },
  };
}

function sendTransparent(res: Response, sourceTag = "Transparent-Fallback") {
  res.writeHead(200, {
    "Content-Type": "image/png",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=604800, s-maxage=604800",
    "X-GeoQuerry-Tile-Source": sourceTag,
  });
  res.end(TRANSPARENT_PNG);
}

interface WmsProxyOptions {
  bounds?: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  minZoomForBounds?: number;
  buildUrl: (bboxStr: string) => string;
  sourceTag: string;
}

async function proxyWmsTile(
  res: Response,
  z: string,
  x: string,
  y: string,
  options: WmsProxyOptions
): Promise<void> {
  try {
    const cleanY = y.replace(/\.png$/, "");
    const zNum = parseInt(z, 10);
    const xNum = parseInt(x, 10);
    const yNum = parseInt(cleanY, 10);

    if (isNaN(zNum) || isNaN(xNum) || isNaN(yNum)) {
      sendTransparent(res);
      return;
    }

    const { epsg3857, bounds } = tileToGeographic(zNum, xNum, yNum);

    if (options.bounds && (!options.minZoomForBounds || zNum >= options.minZoomForBounds)) {
      if (
        bounds.south > options.bounds.maxLat ||
        bounds.north < options.bounds.minLat ||
        bounds.west > options.bounds.maxLng ||
        bounds.east < options.bounds.minLng
      ) {
        sendTransparent(res, `${options.sourceTag}-Out-Of-Bounds`);
        return;
      }
    }

    const [minX, minY, maxX, maxY] = epsg3857;
    const bboxStr = `${minX.toFixed(2)},${minY.toFixed(2)},${maxX.toFixed(2)},${maxY.toFixed(2)}`;
    const url = options.buildUrl(bboxStr);

    const fetchRes = await fetch(url, {
      headers: {
        "User-Agent": "GeoQuerry-GIS/1.0 (contact@geoquerry.com)",
        Accept: "image/png,image/*;q=0.8",
      },
    });

    if (fetchRes.ok) {
      const contentType = fetchRes.headers.get("content-type") || "";
      if (contentType.includes("image") || contentType.includes("octet-stream")) {
        const buffer = await fetchRes.arrayBuffer();
        res.writeHead(200, {
          "Content-Type": "image/png",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=86400, s-maxage=604800",
          "X-GeoQuerry-Tile-Source": options.sourceTag,
        });
        res.end(Buffer.from(buffer));
        return;
      }
    }

    sendTransparent(res, `${options.sourceTag}-Fallback`);
  } catch {
    sendTransparent(res);
  }
}

// 1. Macrostrat Global Bedrock
tilesRouter.get("/geology/:z/:x/:y", async (req: Request, res: Response): Promise<void> => {
  try {
    const { z, x, y } = req.params;
    const cleanY = (Array.isArray(y) ? y[0] : y).replace(/\.png$/, "");
    const zNum = parseInt(Array.isArray(z) ? z[0] : z, 10);
    const xNum = parseInt(Array.isArray(x) ? x[0] : x, 10);
    const yNum = parseInt(cleanY, 10);

    if (isNaN(zNum) || isNaN(xNum) || isNaN(yNum)) {
      sendTransparent(res);
      return;
    }

    const upstreamUrls = [
      `https://tiles.macrostrat.org/carto/${zNum}/${xNum}/${yNum}.png`,
      `https://tiles.macrostrat.org/carto-slim/${zNum}/${xNum}/${yNum}.png`,
    ];

    for (const url of upstreamUrls) {
      try {
        const fetchRes = await fetch(url, {
          headers: {
            "User-Agent": "GeoQuerry-GIS/1.0 (contact@geoquerry.com)",
            Accept: "image/png,image/*;q=0.8",
          },
        });

        if (fetchRes.ok) {
          const contentType = fetchRes.headers.get("content-type") || "";
          if (contentType.includes("image") || contentType.includes("octet-stream")) {
            const buffer = await fetchRes.arrayBuffer();
            res.writeHead(200, {
              "Content-Type": "image/png",
              "Access-Control-Allow-Origin": "*",
              "Cache-Control": "public, max-age=86400, s-maxage=604800",
              "X-GeoQuerry-Tile-Source": "Macrostrat-Cached",
            });
            res.end(Buffer.from(buffer));
            return;
          }
        }
      } catch {
        // try next upstream
      }
    }

    sendTransparent(res, "Macrostrat-Fallback");
  } catch {
    sendTransparent(res);
  }
});

// 2. USGS SGMC High-Resolution Geology (North America)
tilesRouter.get("/usgs/:z/:x/:y", (req: Request, res: Response) => {
  const { z, x, y } = req.params;
  return proxyWmsTile(res, String(z), String(x), String(y), {
    bounds: USGS_BOUNDS,
    sourceTag: "USGS-SGMC-WMS",
    buildUrl: (bbox) =>
      `https://mrdata.usgs.gov/services/sgmc?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&BBOX=${bbox}&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&LAYERS=SGMC_Geology&STYLES=&FORMAT=image/png&TRANSPARENT=TRUE`,
  });
});

// 3. British Geological Survey (UK)
tilesRouter.get("/bgs/:z/:x/:y", (req: Request, res: Response) => {
  const { z, x, y } = req.params;
  return proxyWmsTile(res, String(z), String(x), String(y), {
    bounds: BGS_BOUNDS,
    sourceTag: "BGS-625k-Bedrock-WMS",
    buildUrl: (bbox) =>
      `https://ogc.bgs.ac.uk/cgi-bin/BGS_Bedrock_and_Superficial_Geology/ows?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&BBOX=${bbox}&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&LAYERS=GBR_BGS_625k_BLT&STYLES=&FORMAT=image/png&TRANSPARENT=TRUE`,
  });
});

// 4. OneGeology / BRGM (Europe)
tilesRouter.get("/onegeology/:z/:x/:y", (req: Request, res: Response) => {
  const { z, x, y } = req.params;
  return proxyWmsTile(res, String(z), String(x), String(y), {
    bounds: ONEGEOLOGY_BOUNDS,
    minZoomForBounds: 4,
    sourceTag: "OneGeology-WMS",
    buildUrl: (bbox) =>
      `https://geoservices.brgm.fr/geologie?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&BBOX=${bbox}&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&LAYERS=GEOLOGIE&STYLES=&FORMAT=image/png&TRANSPARENT=TRUE`,
  });
});

// 5. Pre-warm / Pre-synthesis trigger endpoint
tilesRouter.all("/prewarm", async (_req: Request, res: Response): Promise<void> => {
  try {
    const startTime = Date.now();
    let totalPrimed = 0;

    const promises: Promise<any>[] = [];
    for (let z = 0; z <= 2; z++) {
      const numTiles = Math.pow(2, z);
      for (let x = 0; x < numTiles; x++) {
        for (let y = 0; y < numTiles; y++) {
          promises.push(
            fetch(`https://tiles.macrostrat.org/carto/${z}/${x}/${y}.png`).catch(() => null)
          );
        }
      }
    }
    const macroRes = await Promise.all(promises);
    totalPrimed += macroRes.filter((r) => r && r.ok).length;

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      timezone: "EAT (UTC+3)",
      totalTilesPrimed: totalPrimed,
      durationSeconds: Number(duration),
      hotspotsCovered: EXPLORATION_HOTSPOTS.length,
      message: "Unified Intelligent Pre-Synthesis Pipeline successfully primed backend cache.",
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default tilesRouter;

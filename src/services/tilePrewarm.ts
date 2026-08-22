/**
 * @file tilePrewarm.ts
 * 
 * Scheduled Nightly Pre-Synthesis Cron Service (00:00 hrs Kenyan Time / EAT)
 * Pre-warms global macro pyramids and active mining basins.
 */

const BASE_URL = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

const EXPLORATION_HOTSPOTS = [
  { name: "Kenya Rift Valley", z: 6, x: 38, y: 32 },
  { name: "Witwatersrand Basin", z: 6, x: 37, y: 36 },
  { name: "Grand Canyon / Arizona", z: 6, x: 12, y: 25 },
  { name: "Carlin Trend Nevada", z: 6, x: 11, y: 24 },
  { name: "Scottish Highlands", z: 6, x: 31, y: 19 },
  { name: "Central Massif France", z: 6, x: 32, y: 22 },
];

export async function executeTilePrewarm(): Promise<{ primed: number; duration: number }> {
  const start = Date.now();
  let primed = 0;

  try {
    // 1. Pre-warm Global Pyramids (z = 0 to 2)
    const macroFetches: Promise<any>[] = [];
    for (let z = 0; z <= 2; z++) {
      const numTiles = Math.pow(2, z);
      for (let x = 0; x < numTiles; x++) {
        for (let y = 0; y < numTiles; y++) {
          macroFetches.push(
            fetch(`${BASE_URL}/api/tiles/geology/${z}/${x}/${y}.png`).catch(() => null)
          );
        }
      }
    }
    const macroRes = await Promise.all(macroFetches);
    primed += macroRes.filter((r) => r && r.ok).length;

    // 2. Pre-warm Hotspots
    const hotspotFetches: Promise<any>[] = [];
    for (const spot of EXPLORATION_HOTSPOTS) {
      hotspotFetches.push(
        fetch(`${BASE_URL}/api/tiles/geology/${spot.z}/${spot.x}/${spot.y}.png`).catch(() => null),
        fetch(`${BASE_URL}/api/tiles/usgs/${spot.z}/${spot.x}/${spot.y}.png`).catch(() => null),
        fetch(`${BASE_URL}/api/tiles/bgs/${spot.z}/${spot.x}/${spot.y}.png`).catch(() => null),
        fetch(`${BASE_URL}/api/tiles/onegeology/${spot.z}/${spot.x}/${spot.y}.png`).catch(() => null)
      );
    }
    const hotspotRes = await Promise.all(hotspotFetches);
    primed += hotspotRes.filter((r) => r && r.ok).length;
  } catch (err: any) {
    console.warn("Tile prewarm execution warning:", err.message);
  }

  const duration = (Date.now() - start) / 1000;
  return { primed, duration };
}

/**
 * Starts the nightly background timer scheduled for 00:00 EAT (21:00 UTC)
 */
export function startNightlyTilePrewarmCron() {
  const checkIntervalMs = 60 * 1000; // Check every 60 seconds

  setInterval(() => {
    const now = new Date();
    const utcHours = now.getUTCHours();
    const utcMinutes = now.getUTCMinutes();

    // 21:00 UTC == 00:00 EAT (Kenyan Time)
    if (utcHours === 21 && utcMinutes === 0) {
      console.log("🕒 [00:00 EAT Cron] Triggering Scheduled Unified Tile Pre-Synthesis Pipeline...");
      executeTilePrewarm().then(({ primed, duration }) => {
        console.log(`✅ [00:00 EAT Cron] Pre-warmed ${primed} geological tiles in ${duration.toFixed(2)}s`);
      });
    }
  }, checkIntervalMs);
}

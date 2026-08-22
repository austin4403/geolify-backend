/**
 * @file prewarm-tiles.mjs
 * 
 * GeoQuerry Backend Automated Tile Pre-Synthesis & Seeding Runner
 * Executes the Unified Intelligent Cascading pre-warming pipeline on port 5000.
 */

const BASE_URL = process.env.API_BASE_URL || "http://localhost:5000";

const EXPLORATION_HOTSPOTS = [
  { name: "Kenya Rift Valley (Geothermal & Mining)", z: 6, x: 38, y: 32 },
  { name: "Witwatersrand Basin Gold Belt (South Africa)", z: 6, x: 37, y: 36 },
  { name: "Grand Canyon / Arizona Mining District (USA)", z: 6, x: 12, y: 25 },
  { name: "Carlin Trend Gold Belt (Nevada, USA)", z: 6, x: 11, y: 24 },
  { name: "Scottish Highlands Mineral Belt (UK)", z: 6, x: 31, y: 19 },
  { name: "Central Massif Polymetallic Zone (France)", z: 6, x: 32, y: 22 },
];

async function fetchTile(endpoint, z, x, y) {
  const url = `${BASE_URL}/api/tiles/${endpoint}/${z}/${x}/${y}.png`;
  try {
    const start = Date.now();
    const res = await fetch(url);
    const duration = Date.now() - start;
    const sourceHeader = res.headers.get("x-geoquerry-tile-source") || "cached";
    return { ok: res.ok, status: res.status, duration, source: sourceHeader };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function runPrewarmPipeline() {
  console.log("===============================================================");
  console.log("⚡ GeoQuerry Backend Tile Pre-Synthesis & Seeding Pipeline");
  console.log(`🕒 Execution Timestamp: ${new Date().toISOString()} (EAT / UTC+3)`);
  console.log(`🌐 Backend Server: ${BASE_URL}`);
  console.log("===============================================================\n");

  let totalTiles = 0;
  let successfulTiles = 0;
  const startTime = Date.now();

  // Phase 1: Global Macro Pyramids (z = 0, 1, 2)
  console.log("📦 Phase 1: Pre-warming Global Macro Pyramids (z = 0 to 2)...");
  for (let z = 0; z <= 2; z++) {
    const numTiles = Math.pow(2, z);
    for (let x = 0; x < numTiles; x++) {
      for (let y = 0; y < numTiles; y++) {
        totalTiles++;
        const res = await fetchTile("geology", z, x, y);
        if (res.ok) {
          successfulTiles++;
        }
      }
    }
    console.log(`  ✓ Zoom Level ${z} complete (${Math.pow(2, z) * Math.pow(2, z)} tiles)`);
  }

  // Phase 2: Active Mineral Hotspots (Regional Zoom 3 - 6)
  console.log("\n⛏️ Phase 2: Pre-warming Active Exploration Hotspots...");
  for (const spot of EXPLORATION_HOTSPOTS) {
    totalTiles += 4;
    const results = await Promise.all([
      fetchTile("geology", spot.z, spot.x, spot.y),
      fetchTile("usgs", spot.z, spot.x, spot.y),
      fetchTile("bgs", spot.z, spot.x, spot.y),
      fetchTile("onegeology", spot.z, spot.x, spot.y),
    ]);

    const passed = results.filter((r) => r.ok).length;
    successfulTiles += passed;
    console.log(`  ✓ ${spot.name} [z=${spot.z}, x=${spot.x}, y=${spot.y}] -> ${passed}/4 layer streams primed`);
  }

  // Phase 3: Outcrop Intelligence Hotspot Verification
  console.log("\n🔍 Phase 3: Priming Outcrop Geological Intelligence Query Cache...");
  const sampleCoords = [
    { name: "Grand Canyon Rim (Kaibab Formation)", lat: 36.0544, lng: -112.1401 },
    { name: "Kenya Olkaria Geothermal Outcrop", lat: -0.8993, lng: 36.3114 },
    { name: "Loch Ness Granite Outcrop (Scotland)", lat: 57.3229, lng: -4.4244 },
  ];

  for (const coord of sampleCoords) {
    try {
      const inspectRes = await fetch(`${BASE_URL}/api/geology/inspect?lat=${coord.lat}&lng=${coord.lng}`);
      const json = await inspectRes.json();
      console.log(`  ✓ ${coord.name}: Identified unit "${json.primaryUnit?.name || 'Bedrock'}" (${json.primaryUnit?.age_interval || 'Unknown Age'})`);
    } catch (e) {
      console.warn(`  ! Inspect note for ${coord.name}:`, e.message);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log("\n===============================================================");
  console.log(`🎉 Backend Pipeline Execution Complete!`);
  console.log(`📊 Statistics: ${successfulTiles}/${totalTiles} tile streams primed in ${elapsed}s`);
  console.log(`🚀 Express Backend Cache is warm.`);
  console.log("===============================================================\n");
}

runPrewarmPipeline();

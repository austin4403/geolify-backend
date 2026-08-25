import { extractFromWikipedia } from "./wikipedia.extractor";
import { loadMinerals } from "./loader";

export async function runMineralIngestionPipeline() {
  console.log("💎 Starting GeoQuerry Mineral Ingestion Pipeline...\n");

  const startTime = Date.now();

  // 1. Extract
  const extractedMinerals = await extractFromWikipedia();
  console.log(`📦 Extracted ${extractedMinerals.length} raw species from Wikipedia.`);

  // 2. Load (Merges with curated dataset internally)
  await loadMinerals(extractedMinerals);

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n🎉 Pipeline finished successfully in ${duration}s.`);
}

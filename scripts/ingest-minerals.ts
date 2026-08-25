/**
 * @file ingest-minerals.ts
 *
 * Slim CLI entrypoint for the GeoQuerry Mineral Ingestion ETL pipeline.
 */

import { runMineralIngestionPipeline } from "../src/services/mineralIngestion";

runMineralIngestionPipeline()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ Ingestion pipeline failed:", err);
    process.exit(1);
  });
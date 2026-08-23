import { refSql } from "../src/db/refDb";

async function setupRefDb() {
  console.log("🚀 Initializing reference database (geoquerry-ref-data)...");

  // Ensure pg_trgm extension for fast text search if supported
  try {
    await refSql`CREATE EXTENSION IF NOT EXISTS pg_trgm;`;
  } catch (err: any) {
    console.warn("Notice on extension:", err.message);
  }

  // Create minerals table
  await refSql`
    CREATE TABLE IF NOT EXISTS minerals (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      formula TEXT,
      crystal_system TEXT,
      mineral_class TEXT,
      mohs_hardness_min DOUBLE PRECISION,
      mohs_hardness_max DOUBLE PRECISION,
      specific_gravity DOUBLE PRECISION,
      luster TEXT,
      color TEXT,
      streak TEXT,
      cleavage TEXT,
      fracture TEXT,
      optical_properties TEXT,
      ima_status TEXT DEFAULT 'Approved',
      tenacity TEXT,
      diaphaneity TEXT,
      diagnostic_features TEXT,
      common_associated_rocks TEXT,
      industrial_uses TEXT,
      occurrence TEXT,
      image_url TEXT,
      rruff_id TEXT,
      mindat_id INTEGER,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `;

  // Create indexes for fast querying and filtering
  await refSql`CREATE INDEX IF NOT EXISTS idx_minerals_name ON minerals (name);`;
  await refSql`CREATE INDEX IF NOT EXISTS idx_minerals_class ON minerals (mineral_class);`;
  await refSql`CREATE INDEX IF NOT EXISTS idx_minerals_crystal_system ON minerals (crystal_system);`;
  await refSql`CREATE INDEX IF NOT EXISTS idx_minerals_hardness ON minerals (mohs_hardness_min, mohs_hardness_max);`;

  console.log("✅ Reference database minerals table and indexes successfully verified!");
}

setupRefDb()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Error setting up reference database:", err);
    process.exit(1);
  });

import { refSql } from "../src/db/refDb";

async function setupRefDb() {
  console.log("🚀 Initializing reference database (geoquerry-ref-data)...");

  // 1. Ensure pg_trgm extension for fast fuzzy text & trigram search
  try {
    await refSql`CREATE EXTENSION IF NOT EXISTS pg_trgm;`;
    console.log("✓ pg_trgm extension verified.");
  } catch (err: any) {
    console.warn("Notice on extension:", err.message);
  }

  // 2. Create minerals table with native text[] arrays and rich JSONB structures
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
      synonyms TEXT[] DEFAULT ARRAY[]::TEXT[],
      localities TEXT[] DEFAULT ARRAY[]::TEXT[],
      associated_rocks TEXT[] DEFAULT ARRAY[]::TEXT[],
      industrial_uses TEXT[] DEFAULT ARRAY[]::TEXT[],
      raman_spectra JSONB DEFAULT '[]'::jsonb,
      structured_localities JSONB DEFAULT '[]'::jsonb,
      occurrence TEXT,
      image_url TEXT,
      rruff_id TEXT,
      mindat_id INTEGER,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `;

  // 3. Ensure columns exist on existing databases
  await refSql`ALTER TABLE minerals ADD COLUMN IF NOT EXISTS synonyms TEXT[] DEFAULT ARRAY[]::TEXT[];`;
  await refSql`ALTER TABLE minerals ADD COLUMN IF NOT EXISTS localities TEXT[] DEFAULT ARRAY[]::TEXT[];`;
  await refSql`ALTER TABLE minerals ADD COLUMN IF NOT EXISTS associated_rocks TEXT[] DEFAULT ARRAY[]::TEXT[];`;
  await refSql`ALTER TABLE minerals ADD COLUMN IF NOT EXISTS industrial_uses TEXT[] DEFAULT ARRAY[]::TEXT[];`;
  await refSql`ALTER TABLE minerals ADD COLUMN IF NOT EXISTS raman_spectra JSONB DEFAULT '[]'::jsonb;`;
  await refSql`ALTER TABLE minerals ADD COLUMN IF NOT EXISTS structured_localities JSONB DEFAULT '[]'::jsonb;`;

  // 4. Create high-speed GIN and B-Tree indexes
  await refSql`CREATE INDEX IF NOT EXISTS idx_minerals_name ON minerals (name);`;
  await refSql`CREATE INDEX IF NOT EXISTS idx_minerals_class ON minerals (mineral_class);`;
  await refSql`CREATE INDEX IF NOT EXISTS idx_minerals_crystal_system ON minerals (crystal_system);`;
  await refSql`CREATE INDEX IF NOT EXISTS idx_minerals_hardness ON minerals (mohs_hardness_min, mohs_hardness_max);`;
  
  // GIN Array indexes
  await refSql`CREATE INDEX IF NOT EXISTS idx_minerals_localities_gin ON minerals USING gin (localities);`;
  await refSql`CREATE INDEX IF NOT EXISTS idx_minerals_synonyms_gin ON minerals USING gin (synonyms);`;
  await refSql`CREATE INDEX IF NOT EXISTS idx_minerals_associated_rocks_gin ON minerals USING gin (associated_rocks);`;
  await refSql`CREATE INDEX IF NOT EXISTS idx_minerals_industrial_uses_gin ON minerals USING gin (industrial_uses);`;

  // GIN pg_trgm index for fuzzy matching
  await refSql`CREATE INDEX IF NOT EXISTS idx_minerals_name_trgm ON minerals USING gin (name gin_trgm_ops);`;

  console.log("✅ Reference database minerals table and GIN indexes successfully verified!");
}

setupRefDb()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Error setting up reference database:", err);
    process.exit(1);
  });

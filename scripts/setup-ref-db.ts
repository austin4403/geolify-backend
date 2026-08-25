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
      mohsHardnessMin DOUBLE PRECISION,
      mohsHardnessMax DOUBLE PRECISION,
      specificGravity DOUBLE PRECISION,
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

  // 3. Ensure array columns exist and migrate legacy scalar columns
  await refSql`ALTER TABLE minerals ADD COLUMN IF NOT EXISTS synonyms TEXT[] DEFAULT ARRAY[]::TEXT[];`;
  await refSql`ALTER TABLE minerals ADD COLUMN IF NOT EXISTS localities TEXT[] DEFAULT ARRAY[]::TEXT[];`;
  await refSql`ALTER TABLE minerals ADD COLUMN IF NOT EXISTS associated_rocks TEXT[] DEFAULT ARRAY[]::TEXT[];`;
  await refSql`ALTER TABLE minerals ADD COLUMN IF NOT EXISTS industrial_uses TEXT[] DEFAULT ARRAY[]::TEXT[];`;
  await refSql`ALTER TABLE minerals ADD COLUMN IF NOT EXISTS raman_spectra JSONB DEFAULT '[]'::jsonb;`;
  await refSql`ALTER TABLE minerals ADD COLUMN IF NOT EXISTS structured_localities JSONB DEFAULT '[]'::jsonb;`;

  // Convert industrial_uses if it was previously scalar text
  await refSql`
    DO $$ 
    BEGIN 
      IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'minerals' AND column_name = 'industrial_uses' AND data_type = 'text'
      ) THEN 
        ALTER TABLE minerals 
          ALTER COLUMN industrial_uses TYPE text[] 
          USING CASE 
            WHEN industrial_uses IS NULL OR industrial_uses = '' THEN ARRAY[]::text[]
            ELSE string_to_array(industrial_uses, ', ')
          END;
        ALTER TABLE minerals ALTER COLUMN industrial_uses SET DEFAULT ARRAY[]::text[];
      END IF;
    END $$;
  `;

  // Migrate legacy common_associated_rocks if present
  await refSql`
    DO $$ 
    BEGIN 
      IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'minerals' AND column_name = 'common_associated_rocks'
      ) THEN 
        UPDATE minerals 
        SET associated_rocks = string_to_array(common_associated_rocks, ', ') 
        WHERE (associated_rocks IS NULL OR cardinality(associated_rocks) = 0) AND common_associated_rocks IS NOT NULL;
        ALTER TABLE minerals DROP COLUMN IF EXISTS common_associated_rocks;
      END IF;
    END $$;
  `;

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

  // 5. Create pre-aggregated Facets Cache table and refresh function
  await refSql`
    CREATE TABLE IF NOT EXISTS mineral_facets_cache (
      id INT PRIMARY KEY DEFAULT 1,
      classes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      crystal_systems TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      localities TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      associated_rocks TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      industrial_uses TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    );
  `;

  await refSql`
    CREATE OR REPLACE FUNCTION refresh_mineral_facets_cache() RETURNS VOID AS $$
    BEGIN
      INSERT INTO mineral_facets_cache (id, classes, crystal_systems, localities, associated_rocks, industrial_uses, updated_at)
      VALUES (
        1,
        (SELECT COALESCE(array_agg(DISTINCT mineral_class ORDER BY mineral_class), ARRAY[]::TEXT[]) FROM minerals WHERE mineral_class IS NOT NULL),
        (SELECT COALESCE(array_agg(DISTINCT crystal_system ORDER BY crystal_system), ARRAY[]::TEXT[]) FROM minerals WHERE crystal_system IS NOT NULL),
        (SELECT COALESCE(array_agg(DISTINCT val ORDER BY val), ARRAY[]::TEXT[]) FROM (SELECT unnest(localities) AS val FROM minerals WHERE localities IS NOT NULL) sub),
        (SELECT COALESCE(array_agg(DISTINCT val ORDER BY val), ARRAY[]::TEXT[]) FROM (SELECT unnest(associated_rocks) AS val FROM minerals WHERE associated_rocks IS NOT NULL) sub),
        (SELECT COALESCE(array_agg(DISTINCT val ORDER BY val), ARRAY[]::TEXT[]) FROM (SELECT unnest(industrial_uses) AS val FROM minerals WHERE industrial_uses IS NOT NULL) sub),
        NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        classes = EXCLUDED.classes,
        crystal_systems = EXCLUDED.crystal_systems,
        localities = EXCLUDED.localities,
        associated_rocks = EXCLUDED.associated_rocks,
        industrial_uses = EXCLUDED.industrial_uses,
        updated_at = NOW();
    END;
    $$ LANGUAGE plpgsql;
  `;

  // Refresh facets cache immediately
  await refSql`SELECT refresh_mineral_facets_cache();`;

  console.log("✅ Reference database minerals table, GIN indexes, and pre-computed facets cache successfully verified!");
}

setupRefDb()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Error setting up reference database:", err);
    process.exit(1);
  });

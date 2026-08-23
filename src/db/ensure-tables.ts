import { sql } from "./index";

async function main() {
  console.log("Ensuring minerals table exists...");
  await sql`
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
  console.log("✅ Minerals table verified!");
}

main().catch((err) => {
  console.error("Migration error:", err);
  process.exit(1);
});

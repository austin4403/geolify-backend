import { sql } from "drizzle-orm";
import { refDb } from "../../db/refDb";
import { minerals, InsertMineral } from "../../db/schema";
import { ExtractedMineral } from "./wikipedia.extractor";
import { CURATED_MINERAL_DATASET } from "../mineralSourcing";

export async function loadMinerals(extracted: ExtractedMineral[]) {
  console.log("💾 Merging and Loading into Reference Database...");

  const mergedMap = new Map<string, InsertMineral>();

  // 1. Seed Curated Dataset (Curated takes priority)
  for (const item of CURATED_MINERAL_DATASET) {
    const key = item.name.toLowerCase().trim();
    mergedMap.set(key, {
      ...item,
      metadata: {
        strunzClassification: item.metadata?.strunzClassification || null,
        imaCode: item.metadata?.imaCode || "Approved",
        isCurated: true,
        priority: 100,
        source: item.metadata?.source || "Geoquerry Curated Mineralogy Reference",
      },
    });
  }

  // 2. Merge Extracted Wikipedia Dataset
  for (const item of extracted) {
    const key = item.name.toLowerCase().trim();
    if (!mergedMap.has(key)) {
      mergedMap.set(key, item);
    } else {
      const existing = mergedMap.get(key)!;
      if (!existing.mindatId && item.mindatId) {
        existing.mindatId = item.mindatId;
      }
      if (!existing.formula && item.formula) {
        existing.formula = item.formula;
      }
    }
  }

  const finalBatch = Array.from(mergedMap.values());
  console.log(`📦 Total unique mineral species ready for database: ${finalBatch.length}`);

  // 3. Upsert using Drizzle ORM with COALESCE to preserve rich attributes
  const BATCH_SIZE = 250;
  for (let i = 0; i < finalBatch.length; i += BATCH_SIZE) {
    const chunk = finalBatch.slice(i, i + BATCH_SIZE);

    await refDb.insert(minerals).values(chunk).onConflictDoUpdate({
      target: minerals.name,
      set: {
        formula: sql`COALESCE(excluded.formula, ${minerals.formula})`,
        crystalSystem: sql`COALESCE(excluded.crystal_system, ${minerals.crystalSystem})`,
        mineralClass: sql`COALESCE(excluded.mineral_class, ${minerals.mineralClass})`,
        mohsHardnessMin: sql`COALESCE(excluded.mohs_hardness_min, ${minerals.mohsHardnessMin})`,
        mohsHardnessMax: sql`COALESCE(excluded.mohs_hardness_max, ${minerals.mohsHardnessMax})`,
        specificGravity: sql`COALESCE(excluded.specific_gravity, ${minerals.specificGravity})`,
        luster: sql`COALESCE(excluded.luster, ${minerals.luster})`,
        color: sql`COALESCE(excluded.color, ${minerals.color})`,
        streak: sql`COALESCE(excluded.streak, ${minerals.streak})`,
        cleavage: sql`COALESCE(excluded.cleavage, ${minerals.cleavage})`,
        fracture: sql`COALESCE(excluded.fracture, ${minerals.fracture})`,
        opticalProperties: sql`COALESCE(excluded.optical_properties, ${minerals.opticalProperties})`,
        imaStatus: sql`COALESCE(excluded.ima_status, ${minerals.imaStatus})`,
        tenacity: sql`COALESCE(excluded.tenacity, ${minerals.tenacity})`,
        diaphaneity: sql`COALESCE(excluded.diaphaneity, ${minerals.diaphaneity})`,
        diagnosticFeatures: sql`COALESCE(excluded.diagnostic_features, ${minerals.diagnosticFeatures})`,
        commonAssociatedRocks: sql`COALESCE(excluded.common_associated_rocks, ${minerals.commonAssociatedRocks})`,
        industrialUses: sql`COALESCE(excluded.industrial_uses, ${minerals.industrialUses})`,
        occurrence: sql`COALESCE(excluded.occurrence, ${minerals.occurrence})`,
        imageUrl: sql`COALESCE(excluded.image_url, ${minerals.imageUrl})`,
        rruffId: sql`COALESCE(excluded.rruff_id, ${minerals.rruffId})`,
        mindatId: sql`COALESCE(excluded.mindat_id, ${minerals.mindatId})`,
        // 💡 ARCHITECTURE: Deep merge JSONB metadata preserving keys from prior pipelines (e.g. RRUFF/Mindat)
        metadata: sql`COALESCE(${minerals.metadata}, '{}'::jsonb) || jsonb_strip_nulls(excluded.metadata)`,
        updatedAt: new Date(),
      },
    });

    process.stdout.write(`\r🚀 Ingested ${Math.min(i + BATCH_SIZE, finalBatch.length)} / ${finalBatch.length}`);
  }
  console.log("\n✅ Load complete.");
}

/**
 * @file ingest-minerals.ts
 * 
 * Pipeline to fetch and ingest all ~6,000 IMA-recognized mineral species
 * into the dedicated Reference Database (geoquerry-ref-data), while preserving
 * enriched physical, optical, and diagnostic attributes for curated rock-forming species.
 */

import { refDb, refSql } from "../src/db/refDb";
import { minerals } from "../src/db/schema";
import { CURATED_MINERAL_DATASET } from "../src/services/mineralSourcing";
import { sql } from "drizzle-orm";

const SUBPAGES = [
  "List_of_minerals_recognized_by_the_International_Mineralogical_Association_(A)",
  "List_of_minerals_recognized_by_the_International_Mineralogical_Association_(B)",
  "List_of_minerals_recognized_by_the_International_Mineralogical_Association_(C)",
  "List_of_minerals_recognized_by_the_International_Mineralogical_Association_(D)",
  "List_of_minerals_recognized_by_the_International_Mineralogical_Association_(E)",
  "List_of_minerals_recognized_by_the_International_Mineralogical_Association_(F)",
  "List_of_minerals_recognized_by_the_International_Mineralogical_Association_(G)",
  "List_of_minerals_recognized_by_the_International_Mineralogical_Association_(H)",
  "List_of_minerals_recognized_by_the_International_Mineralogical_Association_(I)",
  "List_of_minerals_recognized_by_the_International_Mineralogical_Association_(J)",
  "List_of_minerals_recognized_by_the_International_Mineralogical_Association_(K)",
  "List_of_minerals_recognized_by_the_International_Mineralogical_Association_(L)",
  "List_of_minerals_recognized_by_the_International_Mineralogical_Association_(M)",
  "List_of_minerals_recognized_by_the_International_Mineralogical_Association_(N)",
  "List_of_minerals_recognized_by_the_International_Mineralogical_Association_(O)",
  "List_of_minerals_recognized_by_the_International_Mineralogical_Association_(P–Q)",
  "List_of_minerals_recognized_by_the_International_Mineralogical_Association_(R)",
  "List_of_minerals_recognized_by_the_International_Mineralogical_Association_(S)",
  "List_of_minerals_recognized_by_the_International_Mineralogical_Association_(T)",
  "List_of_minerals_recognized_by_the_International_Mineralogical_Association_(U–V)",
  "List_of_minerals_recognized_by_the_International_Mineralogical_Association_(W–X)",
  "List_of_minerals_recognized_by_the_International_Mineralogical_Association_(Y–Z)",
];

function getMineralClassFromStrunz(code?: string): string {
  if (!code) return "Unclassified";
  const num = code.trim().split(".")[0];
  switch (num) {
    case "1": case "01": return "Native Elements";
    case "2": case "02": return "Sulfides";
    case "3": case "03": return "Halides";
    case "4": case "04": return "Oxides";
    case "5": case "05": return "Carbonates";
    case "6": case "06": return "Borates";
    case "7": case "07": return "Sulfates";
    case "8": case "08": return "Phosphates";
    case "9": case "09": return "Silicates";
    case "10": return "Organic Compounds";
    default: return "Silicates";
  }
}

// Clean Wikipedia formatting (strip links, references, html tags)
function cleanText(text?: string): string | undefined {
  if (!text) return undefined;
  return text
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, "$1") // [[Target|Label]] -> Label
    .replace(/<[^>]+>/g, " ")                           // strip HTML
    .replace(/\{\{[^\}]+\}\}/g, "")                     // strip templates
    .replace(/\[http[^\s\]]+\s*([^\]]*)\]/g, "$1")      // external links
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim() || undefined;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchPageWithRetry(pageName: string, retries = 3): Promise<string> {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(pageName)}&format=json&prop=wikitext`;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "GeolifyMineralsPipeline/2.0 (geology-database@geolify.internal)" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data.parse?.wikitext?.["*"] || "";
    } catch (err: any) {
      if (i === retries - 1) throw err;
      await delay(1000 * (i + 1));
    }
  }
  return "";
}

async function runMineralIngestion() {
  console.log("💎 Starting Comprehensive IMA Minerals Ingestion into geoquerry-ref-data...\n");

  const mineralMap = new Map<string, any>();

  // 1. Populate with Curated Dataset (highest fidelity attributes)
  for (const item of CURATED_MINERAL_DATASET) {
    mineralMap.set(item.name.toLowerCase().trim(), {
      ...item,
      metadata: {
        isCurated: true,
        priority: 100,
        source: "Geolify Curated Mineralogy Reference",
      },
    });
  }
  console.log(`📌 Seeded ${mineralMap.size} rich curated reference minerals.`);

  // 2. Fetch and parse all IMA subpages
  for (const pageName of SUBPAGES) {
    const letter = pageName.match(/\(([^\)]+)\)/)?.[1] || pageName;
    process.stdout.write(`📥 Fetching Letter (${letter})... `);

    try {
      const wikitext = await fetchPageWithRetry(pageName);
      const lines = wikitext.split("\n");
      let count = 0;

      for (const line of lines) {
        // Line format: #[[MineralName]] (IMA...) Strunz [mindat] ... (IUPAC: ...)
        const nameMatch = line.match(/^#\s*\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/);
        if (!nameMatch) continue;

        const rawName = nameMatch[1].trim();
        // Skip disambiguation or non-mineral entries
        if (!rawName || rawName.includes("List of") || rawName.includes("Category:")) continue;

        const key = rawName.toLowerCase();

        // Extract Strunz classification
        const strunzMatch = line.match(/\]\]\s*(?:\([^\)]+\)\s*)?([0-9]{1,2}\.[A-Z0-9\.]+)/i);
        const strunzCode = strunzMatch ? strunzMatch[1] : undefined;
        const mineralClass = getMineralClassFromStrunz(strunzCode);

        // Extract Mindat ID
        const mindatMatch = line.match(/mindat\.org\/min-([0-9]+)\.html/i);
        const mindatId = mindatMatch ? parseInt(mindatMatch[1], 10) : undefined;

        // Extract formula / chemical description
        const formulaMatch = line.match(/<br\s*\/?>\s*\((?:IUPAC:\s*)?([^\)]+)\)/i) || line.match(/\(IUPAC:\s*([^\)]+)\)/i);
        const formula = formulaMatch ? cleanText(formulaMatch[1]) : undefined;

        // Extract IMA status / approval
        const imaMatch = line.match(/\((IMA[^\)]+|[0-9]{4}[^\)]*)\)/i);
        const imaCode = imaMatch ? imaMatch[1] : "Approved";

        if (mineralMap.has(key)) {
          // Enrich existing curated entry with mindat ID if missing
          const existing = mineralMap.get(key);
          if (!existing.mindatId && mindatId) existing.mindatId = mindatId;
        } else {
          mineralMap.set(key, {
            name: rawName,
            formula: formula || null,
            crystalSystem: null,
            mineralClass: mineralClass,
            mohsHardnessMin: null,
            mohsHardnessMax: null,
            specificGravity: null,
            luster: null,
            color: null,
            streak: null,
            cleavage: null,
            fracture: null,
            opticalProperties: null,
            imaStatus: "Approved",
            tenacity: null,
            diaphaneity: null,
            diagnosticFeatures: formula ? `Chemical Formula / IUPAC: ${formula}` : null,
            commonAssociatedRocks: null,
            industrialUses: null,
            occurrence: null,
            imageUrl: null,
            rruffId: null,
            mindatId: mindatId || null,
            metadata: {
              strunzClassification: strunzCode || null,
              imaCode: imaCode,
              isCurated: false,
              priority: 10,
              source: "IMA / RRUFF Master Species List",
            },
          });
        }
        count++;
      }

      console.log(`✅ Parsed ${count} species`);
      await delay(200); // Polite rate limit
    } catch (err: any) {
      console.log(`⚠️ Failed: ${err.message}`);
    }
  }

  const allMinerals = Array.from(mineralMap.values());
  console.log(`\n📦 Total unique mineral species ready for database: ${allMinerals.length}`);

  // 3. Batch insert into geoquerry-ref-data
  console.log("💾 Writing records to reference database in batches...");
  const BATCH_SIZE = 250;
  let inserted = 0;

  for (let i = 0; i < allMinerals.length; i += BATCH_SIZE) {
    const batch = allMinerals.slice(i, i + BATCH_SIZE);

    // Use Postgres upsert (ON CONFLICT (name) DO UPDATE)
    for (const item of batch) {
      await refSql`
        INSERT INTO minerals (
          name, formula, crystal_system, mineral_class, mohs_hardness_min, mohs_hardness_max,
          specific_gravity, luster, color, streak, cleavage, fracture, optical_properties,
          ima_status, tenacity, diaphaneity, diagnostic_features, common_associated_rocks,
          industrial_uses, occurrence, image_url, rruff_id, mindat_id, metadata, updated_at
        ) VALUES (
          ${item.name}, ${item.formula}, ${item.crystalSystem}, ${item.mineralClass}, ${item.mohsHardnessMin}, ${item.mohsHardnessMax},
          ${item.specificGravity}, ${item.luster}, ${item.color}, ${item.streak}, ${item.cleavage}, ${item.fracture}, ${item.opticalProperties},
          ${item.imaStatus}, ${item.tenacity}, ${item.diaphaneity}, ${item.diagnosticFeatures}, ${item.commonAssociatedRocks},
          ${item.industrialUses}, ${item.occurrence}, ${item.imageUrl}, ${item.rruffId}, ${item.mindatId}, ${JSON.stringify(item.metadata)}, NOW()
        )
        ON CONFLICT (name) DO UPDATE SET
          formula = COALESCE(EXCLUDED.formula, minerals.formula),
          crystal_system = COALESCE(EXCLUDED.crystal_system, minerals.crystal_system),
          mineral_class = COALESCE(EXCLUDED.mineral_class, minerals.mineral_class),
          mohs_hardness_min = COALESCE(EXCLUDED.mohs_hardness_min, minerals.mohs_hardness_min),
          mohs_hardness_max = COALESCE(EXCLUDED.mohs_hardness_max, minerals.mohs_hardness_max),
          specific_gravity = COALESCE(EXCLUDED.specific_gravity, minerals.specific_gravity),
          luster = COALESCE(EXCLUDED.luster, minerals.luster),
          color = COALESCE(EXCLUDED.color, minerals.color),
          streak = COALESCE(EXCLUDED.streak, minerals.streak),
          cleavage = COALESCE(EXCLUDED.cleavage, minerals.cleavage),
          fracture = COALESCE(EXCLUDED.fracture, minerals.fracture),
          optical_properties = COALESCE(EXCLUDED.optical_properties, minerals.optical_properties),
          diagnostic_features = COALESCE(EXCLUDED.diagnostic_features, minerals.diagnostic_features),
          common_associated_rocks = COALESCE(EXCLUDED.common_associated_rocks, minerals.common_associated_rocks),
          industrial_uses = COALESCE(EXCLUDED.industrial_uses, minerals.industrial_uses),
          occurrence = COALESCE(EXCLUDED.occurrence, minerals.occurrence),
          image_url = COALESCE(EXCLUDED.image_url, minerals.image_url),
          rruff_id = COALESCE(EXCLUDED.rruff_id, minerals.rruff_id),
          mindat_id = COALESCE(EXCLUDED.mindat_id, minerals.mindat_id),
          metadata = EXCLUDED.metadata,
          updated_at = NOW();
      `;
    }

    inserted += batch.length;
    process.stdout.write(`\r🚀 Ingested ${inserted} / ${allMinerals.length} minerals...`);
  }

  // 4. Verify Total Count in Database
  const [countRes] = await refSql`SELECT count(*)::int as total FROM minerals;`;
  console.log(`\n\n🎉 SUCCESS: Reference database now contains ${countRes.total} mineral species!`);
}

runMineralIngestion()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ Ingestion failed:", err);
    process.exit(1);
  });

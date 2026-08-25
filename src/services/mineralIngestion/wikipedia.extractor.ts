import { cleanText, getMineralClassFromStrunz, StrunzCodeSchema } from "../../utils/wikitext";
import { MineralMetadata } from "../../types/minerals";

export const SUBPAGES = [
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

const WIKI_API = "https://en.wikipedia.org/w/api.php";

// 💡 ARCHITECTURE: Safe concurrency. Fetch 3 pages at a time, not 22 sequentially, not 22 all at once.
async function processInChunks<T, R>(items: T[], chunkSize: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(chunk.map(fn));
    results.push(...chunkResults);
  }
  return results;
}

function sleepWithJitter(baseMs: number): Promise<void> {
  const jitter = Math.floor(Math.random() * 300);
  return new Promise((resolve) => setTimeout(resolve, baseMs + jitter));
}

async function fetchWikitext(pageName: string, retries = 3): Promise<string> {
  // 💡 ARCHITECTURE: &maxlag=5 prevents Wikimedia server overload
  const url = `${WIKI_API}?action=parse&page=${encodeURIComponent(pageName)}&format=json&prop=wikitext&maxlag=5`;

  for (let attempt = 0; attempt < retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s request timeout

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "GeolifyMineralsPipeline/2.0 (geology-database@geolify.internal)" },
      });

      // Handle 429 Too Many Requests or 503 Maxlag with Retry-After header
      if (res.status === 429 || res.status === 503) {
        const retryAfterSec = parseInt(res.headers.get("retry-after") || "5", 10);
        console.warn(`⚠️ Wikipedia rate-limit/lag (${res.status}). Waiting ${retryAfterSec}s before retry...`);
        await new Promise((resolve) => setTimeout(resolve, retryAfterSec * 1000));
        continue;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = (await res.json()) as any;
      const wikitext = data.parse?.wikitext?.["*"];
      if (!wikitext) {
        console.warn(`⚠️ No wikitext returned for page: ${pageName}`);
        return "";
      }
      return wikitext;
    } catch (err: any) {
      const isLastAttempt = attempt === retries - 1;
      const errorDetail = err?.cause?.code || err?.message || String(err);
      if (isLastAttempt) {
        throw new Error(`Failed to fetch Wikipedia page "${pageName}": ${errorDetail}`);
      }
      const backoffMs = 1000 * Math.pow(2, attempt);
      await sleepWithJitter(backoffMs);
    } finally {
      clearTimeout(timeout);
    }
  }
  return "";
}

import { RamanSpectrum, StructuredLocality } from "../../types/minerals";

export interface ExtractedMineral {
  name: string;
  formula: string | null;
  crystalSystem: string | null;
  mineralClass: string;
  mohsHardnessMin: number | null;
  mohsHardnessMax: number | null;
  specificGravity: number | null;
  luster: string | null;
  color: string | null;
  streak: string | null;
  cleavage: string | null;
  fracture: string | null;
  opticalProperties: string | null;
  imaStatus: "Approved" | "Grandfathered" | "Discredited" | "Questionable" | "Unclassified";
  tenacity: string | null;
  diaphaneity: string | null;
  diagnosticFeatures: string | null;
  synonyms: string[];
  localities: string[];
  associatedRocks: string[];
  industrialUses: string[];
  ramanSpectra: RamanSpectrum[];
  structuredLocalities: StructuredLocality[];
  occurrence: string | null;
  imageUrl: string | null;
  rruffId: string | null;
  mindatId: number | null;
  metadata: MineralMetadata;
}

export async function extractFromWikipedia(): Promise<ExtractedMineral[]> {
  console.log("📥 Extracting species from Wikipedia IMA lists...");

  const pageResults = await processInChunks(SUBPAGES, 3, async (pageName) => {
    const letterMatch = pageName.match(/\(([^\)]+)\)/);
    const letter = letterMatch ? letterMatch[1] : pageName;
    const wikitext = await fetchWikitext(pageName);
    const lines = wikitext.split("\n");
    const pageMinerals: ExtractedMineral[] = [];

    for (const line of lines) {
      const nameMatch = line.match(/^#\s*\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/);
      if (!nameMatch) continue;

      const rawName = nameMatch[1].trim();
      if (!rawName || rawName.includes("List of") || rawName.includes("Category:")) continue;

      // Strunz classification code
      const strunzMatch = line.match(/\]\]\s*(?:\([^\)]+\)\s*)?([0-9]{1,2}\.[A-Z0-9\.]+)/i);
      const rawStrunz = strunzMatch ? strunzMatch[1] : undefined;
      const strunzValidation = StrunzCodeSchema.safeParse(rawStrunz);
      const strunzCode = strunzValidation.success ? strunzValidation.data : undefined;

      const mineralClass = getMineralClassFromStrunz(strunzCode);
      const mindatIdMatch = line.match(/mindat\.org\/min-([0-9]+)\.html/i);
      const mindatId = mindatIdMatch ? parseInt(mindatIdMatch[1], 10) || null : null;

      const formulaMatch =
        line.match(/<br\s*\/?>\s*\((?:IUPAC:\s*)?([^\)]+)\)/i) ||
        line.match(/\(IUPAC:\s*([^\)]+)\)/i);
      const formula = formulaMatch ? cleanText(formulaMatch[1]) || null : null;

      const imaMatch = line.match(/\((IMA[^\)]+|[0-9]{4}[^\)]*)\)/i);
      const imaCode = imaMatch ? imaMatch[1] : "Approved";
      let imaStatus: "Approved" | "Grandfathered" | "Discredited" | "Questionable" | "Unclassified" = "Approved";
      const lowerIma = imaCode.toLowerCase();
      if (lowerIma.includes("grandfathered") || lowerIma.includes("(g)")) {
        imaStatus = "Grandfathered";
      } else if (lowerIma.includes("discredited") || lowerIma.includes("(d)")) {
        imaStatus = "Discredited";
      } else if (lowerIma.includes("questionable") || lowerIma.includes("(q)")) {
        imaStatus = "Questionable";
      }

      pageMinerals.push({
        name: rawName,
        formula,
        crystalSystem: null,
        mineralClass,
        mohsHardnessMin: null,
        mohsHardnessMax: null,
        specificGravity: null,
        luster: null,
        color: null,
        streak: null,
        cleavage: null,
        fracture: null,
        opticalProperties: null,
        imaStatus,
        tenacity: null,
        diaphaneity: null,
        diagnosticFeatures: formula ? `Chemical Formula / IUPAC: ${formula}` : null,
        synonyms: [],
        localities: [],
        associatedRocks: [],
        industrialUses: [],
        ramanSpectra: [],
        structuredLocalities: [],
        occurrence: null,
        imageUrl: null,
        rruffId: null,
        mindatId,
        metadata: {
          strunzClassification: strunzCode || null,
          imaCode,
          isCurated: false,
          priority: 10,
          source: "Wikipedia IMA Master List",
        },
      });
    }

    console.log(`  ✓ Loaded letter [${letter}]: ${pageMinerals.length} minerals`);
    return pageMinerals;
  });

  return pageResults.flat();
}

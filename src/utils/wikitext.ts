import { z } from "zod";

export const STRUNZ_CLASS_MAP: Record<string, string> = {
  "01": "Native Elements",
  "02": "Sulfides and Sulfosalts",
  "03": "Halides",
  "04": "Oxides and Hydroxides",
  "05": "Carbonates and Nitrates",
  "06": "Borates",
  "07": "Sulfates, Selenates, Tellurates, Chromates, Molybdates, Tungstates",
  "08": "Phosphates, Arsenates, Vanadates",
  "09": "Silicates and Germanates",
  "10": "Organic Compounds",
};

export const StrunzCodeSchema = z
  .string()
  .regex(/^\d{1,2}\.[A-Z0-9]{1,2}\.[A-Z0-9]{1,2}$/, "Invalid Strunz format")
  .optional();

export function getMineralClassFromStrunz(code?: string): string {
  if (!code) return "Unclassified";
  const num = code.trim().split(".")[0].padStart(2, "0");
  const mapped = STRUNZ_CLASS_MAP[num];
  return mapped || "Unclassified";
}

export function extractIUPACFormula(line: string): string | null {
  // 1. Check for {{chem2|...}} or {{chem|...}} template first
  const chem2Match = line.match(/\{\{chem2\|([^\}]+)\}\}/i);
  if (chem2Match) {
    const raw = chem2Match[1].trim().replace(/\(([0-9]+[\+\-])\)/g, "$1");
    return cleanText(raw) || null;
  }

  const chemMatch = line.match(/\{\{chem\|([^\}]+)\}\}/i);
  if (chemMatch) {
    const parts = chemMatch[1].split("|").map((s) => s.trim()).filter(Boolean);
    const raw = parts.join("");
    return cleanText(raw) || null;
  }

  // 2. Check for IUPAC or <br>(...)
  const iupacIdx = line.search(/<br\s*\/?>\s*\(|\(IUPAC:/i);
  if (iupacIdx === -1) return null;

  // Find opening parenthesis
  const startParenIdx = line.indexOf("(", iupacIdx);
  if (startParenIdx === -1) return null;

  let depth = 0;
  let endParenIdx = -1;

  // Traverse balanced parentheses to avoid cutting off nested Roman numerals like (III)
  for (let i = startParenIdx; i < line.length; i++) {
    if (line[i] === "(") {
      depth++;
    } else if (line[i] === ")") {
      depth--;
      if (depth === 0) {
        endParenIdx = i;
        break;
      }
    }
  }

  if (endParenIdx === -1) return null;

  let rawContent = line.slice(startParenIdx + 1, endParenIdx).trim();
  rawContent = rawContent.replace(/^IUPAC:\s*/i, "").trim();

  // Strip wrapping {{chem2|...}} if still inside
  const innerChem2 = rawContent.match(/^\{\{chem2\|([^\}]+)\}\}$/i);
  if (innerChem2) {
    return cleanText(innerChem2[1].replace(/\(([0-9]+[\+\-])\)/g, "$1")) || null;
  }

  // If this extracted chunk is an IMA status identifier (e.g. "(IMA1990-007)"), ignore
  if (/^IMA\d+/i.test(rawContent)) return null;

  // Auto-balance any residual unmatched parentheses from messy wikitext
  const openCount = (rawContent.match(/\(/g) || []).length;
  const closeCount = (rawContent.match(/\)/g) || []).length;
  if (openCount > closeCount) {
    rawContent += ")".repeat(openCount - closeCount);
  }

  return cleanText(rawContent) || null;
}

export function cleanText(text?: string): string | undefined {
  if (!text) return undefined;
  const cleaned = text
    // 1. Flatten subscripts/superscripts first (e.g. SiO<sub>2</sub> -> SiO2)
    .replace(/<sub>(.*?)<\/sub>/gi, "$1")
    .replace(/<sup>(.*?)<\/sup>/gi, "$1")
    // 2. Extract link text [[Link|Display]] -> Display
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, "$1")
    // 3. Strip remaining tags, templates, external URLs, and non-breaking spaces
    .replace(/<[^>]+>/g, " ")
    .replace(/\{\{[^\}]+\}\}/g, "")
    .replace(/\[http[^\s\]]+\s*([^\]]*)\]/g, "$1")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || undefined;
}

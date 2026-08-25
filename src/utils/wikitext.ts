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

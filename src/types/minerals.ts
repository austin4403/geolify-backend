import { InferSelectModel } from "drizzle-orm";
import { minerals } from "../db/schema";

export interface MineralMetadata {
  strunzClassification: string | null;
  imaCode: string;
  isCurated: boolean;
  priority: number;
  source: string;
}

export interface RamanSpectrum {
  laserWavelengthNm: number;
  peaks: { cm1: number; intensity: number }[];
}

export interface StructuredLocality {
  mine?: string;
  region?: string;
  country: string;
  coordinates?: [number, number]; // [lng, lat]
  notes?: string;
}

export type MineralRecord = InferSelectModel<typeof minerals>;
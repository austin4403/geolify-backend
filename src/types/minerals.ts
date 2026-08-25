import { InferSelectModel } from "drizzle-orm";
import { minerals } from "../db/schema";

// 💡 ARCHITECTURE: Strictly type the JSONB metadata instead of `any`
export interface MineralMetadata {
  strunzClassification: string | null;
  imaCode: string;
  isCurated: boolean;
  priority: number;
  source: string;
}

export type MineralRecord = InferSelectModel<typeof minerals>;
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as dotenv from "dotenv";
import * as schema from "./schema";

dotenv.config({ path: ".env.local" });
dotenv.config();

const refDatabaseUrl =
  process.env.REF_DATABASE_URL ||
  process.env.DATABASE_URL ||
  (process.env.NODE_ENV === "test" ? "postgresql://mock_user:mock_pass@localhost:5432/geoquerry_mock" : "");

if (!refDatabaseUrl) {
  throw new Error("REF_DATABASE_URL / DATABASE_URL is missing. Please check your .env.local file.");
}

// Serverless SQL connection to the reference database
export const refSql = neon(refDatabaseUrl);

// Drizzle client with schema for the reference database
export const refDb = drizzle(refSql, { schema });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as dotenv from "dotenv";
import * as schema from "./schema";

dotenv.config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing. Please check your .env.local file.");
}

const sql = neon(process.env.DATABASE_URL);
export const db = drizzle(sql, { schema });
export { sql };

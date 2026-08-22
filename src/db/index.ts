import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as dotenv from "dotenv";
import * as schema from "./schema";

dotenv.config({ path: ".env.local" });
dotenv.config();

const databaseUrl =
  process.env.DATABASE_URL ||
  (process.env.NODE_ENV === "test" ? "postgresql://mock_user:mock_pass@localhost:5432/geolify_mock" : "");

if (!databaseUrl) {
  throw new Error("DATABASE_URL is missing. Please check your .env.local file.");
}

// this is to initialize the serveless connection to the client
const sql = neon(databaseUrl);

// this is to initialize the drizzle client with the schema
export const db = drizzle(sql, { schema });
export { sql };
export * from "./schema";

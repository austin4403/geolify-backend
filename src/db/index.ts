import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as dotenv from "dotenv";
import * as schema from "./schema";

dotenv.config({ path: ".env.local" });

// this is to check if the database url actually got loaded from the .env file
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing. Please check your .env.local file.");
}

// this is to initialize the serveless connection to the client
const sql = neon(process.env.DATABASE_URL);

// this is to initialize the drizzle client with the schema
export const db = drizzle(sql, { schema });
export { sql };
export * from "./schema";

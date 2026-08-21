import { pgTable, text, serial, timestamp, doublePrecision, jsonb } from "drizzle-orm/pg-core";

export const locations = pgTable("locations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category").notNull().default("general"),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  metadata: jsonb("metadata").$type<Record<string, any>>().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const savedPlaces = pgTable("saved_places", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  locationId: serial("location_id").references(() => locations.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

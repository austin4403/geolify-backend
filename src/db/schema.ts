import { pgTable, text, serial, timestamp, doublePrecision, jsonb, integer, boolean, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// 0. User Profiles & Onboarding (Linked to Neon Auth / OIDC)
export const userProfiles = pgTable("user_profiles", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().unique(),            // Unique ID from Neon Auth / OIDC
  fullName: text("full_name").notNull(),
  username: text("username").notNull().unique(),
  profession: text("profession"),                        // "Exploration Geologist", "Hydrogeologist", "GIS Specialist", etc.
  organization: text("organization"),                    // Company / University / Ministry
  country: text("country").notNull().default("KE"),      // ISO country code (e.g. "KE", "US", "CA")
  preferredCurrency: text("preferred_currency").notNull().default("KES"), // "KES", "USD", "EUR", "GBP"
  unitSystem: text("unit_system").notNull().default("metric"),           // "metric" (m, km) vs "imperial" (ft, mi)
  avatarUrl: text("avatar_url"),                         // Cloudflare R2 / S3 profile photo URL
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
  benefitTier: text("benefit_tier").notNull().default("standard"), // "core_dev", "student", "beta_developer", "standard"
  discountPercent: doublePrecision("discount_percent").notNull().default(0), // 100, 70, 40, 0
  discountExpiresAt: timestamp("discount_expires_at"),   // null = lifetime (e.g. core_dev)
  subscriptionTier: text("subscription_tier").notNull().default("free"), // "free", "pro", "premium", "enterprise"
  subscriptionStatus: text("subscription_status").notNull().default("active"), // "active", "canceled", "past_due", "trialing"
  subscriptionExpiresAt: timestamp("subscription_expires_at"), // null for active free/lifetime
  paymentProvider: text("payment_provider"),             // "stripe", "mpesa", "paystack", "manual", null
  paymentCustomerId: text("payment_customer_id"),       // Stripe customer ID or M-Pesa phone/account
  studentVerificationStatus: text("student_verification_status").default("none"), // "none", "pending", "approved", "rejected"
  studentIdCardUrl: text("student_id_card_url"),
  institutionName: text("institution_name"),
  metadata: jsonb("metadata").$type<Record<string, any>>().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// 1. Projects (Master container for all survey domains)
export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),                     // Project owner / creator
  name: text("name").notNull(),                          // e.g. "Kanyoko Basin Hydrogeology Assessment"
  projectType: text("project_type").notNull(),           // "field_mapping", "hydrogeology", "petroleum", "mining", "geotechnical"
  description: text("description"),
  clientOrOrg: text("client_or_org"),                    // e.g. "Ministry of Water & Sanitation"
  status: text("status").notNull().default("in_progress"), // "planning", "in_progress", "completed", "archived"
  budgetEstimated: doublePrecision("budget_estimated"),
  budgetCurrency: text("budget_currency").default("KES"),
  bounds: jsonb("bounds").$type<{
    minLat?: number;
    maxLat?: number;
    minLng?: number;
    maxLng?: number;
  }>().default({}),
  metadata: jsonb("metadata").$type<Record<string, any>>().default({}),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// 2. Project Collaborators (Multi-User RBAC)
export const projectCollaborators = pgTable("project_collaborators", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  role: text("role").notNull().default("editor"),         // "owner", "editor", "viewer"
  invitedAt: timestamp("invited_at").defaultNow().notNull(),
});

// 3. Stations (Field Observation Points)
export const stations = pgTable("stations", {
  id: serial("id").primaryKey(),
  clientUuid: uuid("client_uuid"),                       // Offline client-generated UUID for conflict-free sync
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
  code: text("code").notNull(),                          // e.g. "ST-04"
  name: text("name").notNull(),                          // e.g. "River Kanyoko Outcrop"
  latitude: doublePrecision("latitude").notNull(),       // GPS Latitude
  longitude: doublePrecision("longitude").notNull(),     // GPS Longitude
  elevation: doublePrecision("elevation"),               // Meters above sea level
  gpsAccuracy: doublePrecision("gps_accuracy"),          // GPS accuracy in meters
  vegetation: text("vegetation"),                        // e.g. "Dense vegetation, acacia shrubs"
  soilDescription: text("soil_description"),             // e.g. "Dark to red transported sand soil"
  landmarks: text("landmarks"),                          // e.g. "Near seasonal river and reservoir dam"
  outcropExposure: text("outcrop_exposure").default("in-situ"), // "in-situ", "float", "subcrop"
  weathering: text("weathering").default("moderate"),    // "fresh", "slight", "moderate", "high"
  photoUrls: jsonb("photo_urls").$type<string[]>().default([]), // Optional station/outcrop landscape photos
  metadata: jsonb("metadata").$type<Record<string, any>>().default({}),
  deletedAt: timestamp("deleted_at"),                    // Soft-delete marker for offline sync
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// 4. Rock Samples (Multiple samples per station with mandatory photos)
export const rockSamples = pgTable("rock_samples", {
  id: serial("id").primaryKey(),
  clientUuid: uuid("client_uuid"),                       // Offline client-generated UUID
  stationId: integer("station_id")
    .notNull()
    .references(() => stations.id, { onDelete: "cascade" }),
  sampleBagId: text("sample_bag_id").notNull(),          // e.g. "SB-01"
  probableRock: text("probable_rock"),                   // e.g. "Quartzofeldspathic gneiss"
  grainSize: text("grain_size"),                         // "fine", "medium", "coarse", "pegmatitic"
  texture: text("texture"),                              // "foliated", "massive", "banded", "porphyritic"
  maficPercent: doublePrecision("mafic_percent"),        // e.g. 40 (%)
  felsicPercent: doublePrecision("felsic_percent"),      // e.g. 60 (%)
  maficMinerals: jsonb("mafic_minerals").$type<Array<{
    color?: string;
    luster?: string;
    habit?: string;
    cleavage?: string;
    fracture?: string;
    streak?: string;
    hardness?: number;                                   // Mohs Hardness 1-10
    hclReaction?: boolean;
    magnetism?: boolean;
    probableMineral?: string;                            // e.g. "Biotite", "Hornblende"
  }>>().default([]),
  felsicMinerals: jsonb("felsic_minerals").$type<Array<{
    color?: string;
    luster?: string;
    habit?: string;
    cleavage?: string;
    fracture?: string;
    streak?: string;
    hardness?: number;                                   // Mohs Hardness 1-10
    hclReaction?: boolean;
    magnetism?: boolean;
    probableMineral?: string;                            // e.g. "Quartz", "K-Feldspar"
  }>>().default([]),
  photoUrls: jsonb("photo_urls").$type<string[]>().notNull(), // MANDATORY: Every rock sample must have photo(s)
  notes: text("notes"),
  deletedAt: timestamp("deleted_at"),                    // Soft-delete marker for offline sync
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// 5. Structural Measurements (3D Foliation, Dip, Strike, Folds)
export const structuralMeasurements = pgTable("structural_measurements", {
  id: serial("id").primaryKey(),
  clientUuid: uuid("client_uuid"),                       // Offline client-generated UUID
  stationId: integer("station_id")
    .notNull()
    .references(() => stations.id, { onDelete: "cascade" }),
  structureType: text("structure_type").notNull(),       // "foliation", "bedding", "fault", "joint", "fold"
  strike: doublePrecision("strike"),                     // 0° - 359.99° (Right-hand rule or quadrant)
  dipAngle: doublePrecision("dip_angle"),                // 0° - 90°
  dipDirection: doublePrecision("dip_direction"),        // 0° - 359.99° Azimuth
  foldType: text("fold_type"),                           // "anticline", "syncline", "monocline"
  plunge: doublePrecision("plunge"),                     // For lineations / fold axes (0° - 90°)
  trend: doublePrecision("trend"),                       // Trend azimuth (0° - 359.99°)
  notes: text("notes"),
  deletedAt: timestamp("deleted_at"),                    // Soft-delete marker for offline sync
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// 6. Boreholes & Hydrogeological Surveys (Boreholes, Aquifers, Water Tables, VES)
export const boreholes = pgTable("boreholes", {
  id: serial("id").primaryKey(),
  clientUuid: uuid("client_uuid"),                       // Offline client-generated UUID
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
  boreholeNumber: text("borehole_number").notNull(),      // e.g. "BH-001" or "WRMA/BH/2026/04"
  name: text("name").notNull(),                           // e.g. "Masinga Community Water Project"
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  elevation: doublePrecision("elevation"),
  totalDepth: doublePrecision("total_depth"),             // Drilled depth in meters
  staticWaterLevel: doublePrecision("static_water_level"),// SWL in meters below ground level (mbgl)
  dynamicWaterLevel: doublePrecision("dynamic_water_level"), // DWL in meters during pumping
  dischargeRate: doublePrecision("discharge_rate"),       // Yield Q in m³/hr or liters/second
  aquiferType: text("aquifer_type"),                      // "unconfined", "confined", "fractured_basement", "alluvial"
  aquiferDepths: jsonb("aquifer_depths").$type<Array<{
    fromDepth: number;
    toDepth: number;
    yieldEstimate?: string;
  }>>().default([]),
  lithologyLogs: jsonb("lithology_logs").$type<Array<{
    fromDepth: number;
    toDepth: number;
    formationName: string;
    description?: string;
    color?: string;
  }>>().default([]),
  waterQuality: jsonb("water_quality").$type<{
    pH?: number;
    tdsPpm?: number;
    electricalConductivityUsCm?: number;
    salinityPpt?: number;
    temperatureCelsius?: number;
    turbidityNtu?: number;
    potabilityStatus?: "potable" | "requires_treatment" | "non_potable";
  }>().default({}),
  vesSoundings: jsonb("ves_soundings").$type<Array<{
    ab2: number;                                          // Half current electrode spacing AB/2 in meters
    mn2: number;                                          // Half potential electrode spacing MN/2 in meters
    apparentResistivityOhmM: number;                      // Apparent resistivity ρa (Ohm-m)
  }>>().default([]),
  pumpingTestLogs: jsonb("pumping_test_logs").$type<Array<{
    elapsedTimeMinutes: number;
    waterLevelMbgl: number;
    drawdownMeters: number;
    dischargeYieldM3Hr: number;
  }>>().default([]),
  photoUrls: jsonb("photo_urls").$type<string[]>().default([]),
  notes: text("notes"),
  deletedAt: timestamp("deleted_at"),                    // Soft-delete marker for offline sync
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// 7. Project Messages (Team Field Chat)
export const projectMessages = pgTable("project_messages", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  senderName: text("sender_name").notNull(),
  message: text("message").notNull(),
  metadata: jsonb("metadata").$type<Record<string, any>>().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// 8. Live Teammate Locations (Real-Time Field Tracking)
export const liveLocations = pgTable("live_locations", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  userName: text("user_name").notNull(),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  elevation: doublePrecision("elevation"),
  batteryLevel: doublePrecision("battery_level"),         // 0 to 100%
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// 9. Saved / Reference Locations (Points of Interest, Outcrops, Base Camps)
export const locations = pgTable("locations", {
  id: serial("id").primaryKey(),
  clientUuid: uuid("client_uuid"),                       // Offline client-generated UUID
  name: text("name").notNull(),
  description: text("description"),
  category: text("category").notNull().default("general"),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  metadata: jsonb("metadata").$type<Record<string, any>>().default({}),
  deletedAt: timestamp("deleted_at"),                    // Soft-delete marker for offline sync
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// 10. Payment Transactions (Stripe & M-Pesa Audit Ledger)
export const paymentTransactions = pgTable("payment_transactions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  provider: text("provider").notNull(),                  // "stripe", "mpesa", "paystack"
  transactionRef: text("transaction_ref").notNull(),     // Stripe Session ID / CheckoutRequestID
  mpesaReceiptNumber: text("mpesa_receipt_number"),      // e.g. "QK87JH2938"
  planId: text("plan_id").notNull(),                     // "pro", "premium", "enterprise"
  billingCycle: text("billing_cycle").notNull().default("monthly"), // "monthly", "annual"
  currency: text("currency").notNull().default("USD"),   // "USD", "KES"
  amount: doublePrecision("amount").notNull(),
  discountAmount: doublePrecision("discount_amount").default(0),
  phoneNumber: text("phone_number"),                     // For M-Pesa STK push
  status: text("status").notNull().default("pending"),   // "pending", "completed", "failed", "cancelled"
  metadata: jsonb("metadata").$type<Record<string, any>>().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Relational Definitions for Drizzle Queries
export const projectsRelations = relations(projects, ({ many }) => ({
  collaborators: many(projectCollaborators),
  stations: many(stations),
  boreholes: many(boreholes),
  messages: many(projectMessages),
  liveLocations: many(liveLocations),
}));

export const projectCollaboratorsRelations = relations(projectCollaborators, ({ one }) => ({
  project: one(projects, {
    fields: [projectCollaborators.projectId],
    references: [projects.id],
  }),
}));

export const stationsRelations = relations(stations, ({ one, many }) => ({
  project: one(projects, {
    fields: [stations.projectId],
    references: [projects.id],
  }),
  rockSamples: many(rockSamples),
  structuralMeasurements: many(structuralMeasurements),
}));

export const rockSamplesRelations = relations(rockSamples, ({ one }) => ({
  station: one(stations, {
    fields: [rockSamples.stationId],
    references: [stations.id],
  }),
}));

export const structuralMeasurementsRelations = relations(structuralMeasurements, ({ one }) => ({
  station: one(stations, {
    fields: [structuralMeasurements.stationId],
    references: [stations.id],
  }),
}));

export const boreholesRelations = relations(boreholes, ({ one }) => ({
  project: one(projects, {
    fields: [boreholes.projectId],
    references: [projects.id],
  }),
}));

export const projectMessagesRelations = relations(projectMessages, ({ one }) => ({
  project: one(projects, {
    fields: [projectMessages.projectId],
    references: [projects.id],
  }),
}));

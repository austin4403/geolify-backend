CREATE TABLE "rock_samples" (
	"id" serial PRIMARY KEY NOT NULL,
	"station_id" integer NOT NULL,
	"sample_bag_id" text NOT NULL,
	"probable_rock" text,
	"grain_size" text,
	"texture" text,
	"mafic_percent" double precision,
	"felsic_percent" double precision,
	"mafic_minerals" jsonb DEFAULT '[]'::jsonb,
	"felsic_minerals" jsonb DEFAULT '[]'::jsonb,
	"photo_urls" jsonb DEFAULT '[]'::jsonb,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stations" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"elevation" double precision,
	"gps_accuracy" double precision,
	"vegetation" text,
	"soil_description" text,
	"landmarks" text,
	"outcrop_exposure" text DEFAULT 'in-situ',
	"weathering" text DEFAULT 'moderate',
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "structural_measurements" (
	"id" serial PRIMARY KEY NOT NULL,
	"station_id" integer NOT NULL,
	"structure_type" text NOT NULL,
	"strike" double precision,
	"dip_angle" double precision,
	"dip_direction" double precision,
	"fold_type" text,
	"plunge" double precision,
	"trend" double precision,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rock_samples" ADD CONSTRAINT "rock_samples_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structural_measurements" ADD CONSTRAINT "structural_measurements_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;
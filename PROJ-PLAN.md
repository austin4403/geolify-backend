# 🌍 GeoQuerry Backend — Master Architecture Specification

This document records the complete, agreed-upon architectural design decisions established during the system alignment interview.

---

## 🏛️ 1. System Architecture & Tech Stack

* **Server Runtime**: Node.js, Express, TypeScript (NodeNext / ES2022)
* **Cloud Database**: Serverless PostgreSQL 18 via **Neon**
* **ORM & Migrations**: **Drizzle ORM** (`drizzle-orm`, `drizzle-kit`)
* **Validation Layer**: **Zod** (strict runtime boundary validation)
* **Authentication**: **Neon Auth / Better Auth** (Universal Bearer JWT & Session Cookies for Web, Desktop Tauri, and Mobile)
* **Object Storage**: **Cloudflare R2** (S3-compatible, $0 egress bandwidth charges)
* **Real-Time Live Collaboration**: **Server-Sent Events (SSE)** scoped per project

---

## 🗄️ 2. Core Entities & Relational Data Model

```mermaid
erDiagram
    USER_PROFILES ||--o{ PROJECTS : "owns / creates"
    PROJECTS ||--o{ PROJECT_COLLABORATORS : "shares with"
    PROJECTS ||--o{ STATIONS : "contains (Geology)"
    PROJECTS ||--o{ BOREHOLES : "contains (Hydrogeology)"
    PROJECTS ||--o{ PROJECT_MESSAGES : "chat history"
    PROJECTS ||--o{ LIVE_LOCATIONS : "tracks members"
    STATIONS ||--o{ ROCK_SAMPLES : "has many"
    STATIONS ||--o{ STRUCTURAL_MEASUREMENTS : "has many"

    USER_PROFILES {
        serial id PK
        text user_id UK "Neon Auth User ID"
        text full_name
        text username UK
        text profession "Hydrogeologist / Exploration Geologist / etc."
        text organization
        text country "Default: KE, US, etc."
        text preferred_currency "KES, USD, EUR, etc."
        text unit_system "metric vs imperial"
        text avatar_url "Cloudflare R2 URL"
        boolean onboarding_completed
    }

    PROJECTS {
        serial id PK
        text user_id "Owner ID"
        text name "e.g. Kanyoko Basin Survey"
        text project_type "field_mapping / hydrogeology / petroleum / mining / geotechnical"
        text description
        text client_or_org
        text status "planning / in_progress / completed / archived"
        double budget_estimated
        text budget_currency "Base currency e.g. KES / USD"
        jsonb bounds "GeoJSON Polygon or Bounding Box"
        jsonb metadata
    }

    PROJECT_COLLABORATORS {
        serial id PK
        integer project_id FK
        text user_id "Invited collaborator"
        text role "owner / editor / viewer"
        timestamp invited_at
    }

    STATIONS {
        serial id PK
        integer project_id FK
        text code "e.g. ST-04"
        text name "e.g. River Kanyoko Outcrop"
        double latitude
        double longitude
        double elevation
        double gps_accuracy
        text vegetation
        text soil_description
        text landmarks
        text outcrop_exposure "in-situ / float / subcrop"
        text weathering "fresh / slight / moderate / high"
        jsonb photo_urls "Optional landscape photos"
    }

    ROCK_SAMPLES {
        serial id PK
        integer station_id FK
        text sample_bag_id "e.g. SB-01"
        text probable_rock "e.g. Quartzofeldspathic gneiss"
        text grain_size
        text texture "foliated / massive"
        double mafic_percent
        double felsic_percent
        jsonb mafic_minerals "color, luster, habit, cleavage, streak, hardness, HCl, magnetism, probableMineral"
        jsonb felsic_minerals "color, luster, habit, cleavage, streak, hardness, probableMineral"
        jsonb photo_urls "MANDATORY: Cloudflare R2 photos"
        text notes
    }

    STRUCTURAL_MEASUREMENTS {
        serial id PK
        integer station_id FK
        text structure_type "foliation / bedding / fault / joint / fold"
        double strike "0° to <360°"
        double dip_angle "0° to 90°"
        double dip_direction "0° to <360° Azimuth"
        text fold_type "anticline / syncline"
        double plunge "0° to 90°"
        double trend "0° to <360°"
    }

    BOREHOLES {
        serial id PK
        integer project_id FK
        text borehole_number "e.g. BH-01"
        text name
        double latitude
        double longitude
        double elevation
        double total_depth "meters"
        double static_water_level "SWL mbgl"
        double dynamic_water_level "DWL mbgl"
        double discharge_rate "Yield m3/hr or L/s"
        text aquifer_type
        jsonb aquifer_depths
        jsonb lithology_logs "layer depths and rock types"
        jsonb water_quality "pH, TDS, EC, salinity, turbidity"
        jsonb ves_soundings "AB/2, MN/2, apparent resistivity"
        jsonb pumping_test_logs "step drawdown data"
        jsonb photo_urls
    }
```

---

## 🎯 3. Core Architecture Decisions

### A. Multi-Discipline Hybrid Projects
* Projects can hold both **Geological Outcrop Stations** and **Hydrogeological Boreholes** simultaneously.
* The selected `projectType` drives the primary UI layout, default templates, and dashboard metrics.

### B. Spatial Representation & GIS Readiness
* All points store raw decimal float `latitude`, `longitude`, and `elevation`.
* Survey areas and traverse tracks are stored and served as standard **GeoJSON FeatureCollections** for immediate rendering in MapLibre / Leaflet.

### C. Direct Cloudflare R2 Uploads
* Client requests a 1-time signed upload URL (`POST /api/uploads/presigned-url`).
* Client uploads binary images directly to Cloudflare R2 with live progress tracking.
* Server bandwidth is never consumed by multi-megabyte photo transfers.
* $0 egress fees allow viewing high-resolution field photos infinitely without bandwidth bills.

### D. Real-Time Team Collaboration & SSE Stream
* Live channel: `GET /api/projects/:projectId/events` (Server-Sent Events).
* Teammates broadcast live GPS coordinates (every 15–30s) rendered as moving markers on the web dashboard map.
* Instant team chat and observation notifications (new rock samples or borehole logs appear live on all screens).

### E. Reporting & Multi-Format Exporter
1. **GeoJSON**: For GIS spatial layers (QGIS, ArcGIS).
2. **CSV / Tabular**: For geochemical assays, borehole lithology tables, and pump test curves.
3. **Formatted Printable / PDF Report**: Comprehensive executive summary with maps, mineral deductions, and photo galleries.
4. **Project Sharing**: Share link / invite system for collaborators with role-based permissions (Viewer, Editor).

---

## 🛣️ 4. Action Plan & Roadmap

- [x] **Phase 1: Project Scaffolding & Database Connection**
  - [x] Express + TypeScript + Drizzle ORM + Neon PostgreSQL
  - [x] `src/db/schema.ts` relational tables

- [x] **Phase 2: Geological Field Mapping Engine**
  - [x] `src/routes/stations.ts` (Stations CRUD + Relational queries)
  - [x] `src/routes/rocks.ts` (Rock samples with mandatory photos & deductive mineralogy)
  - [x] `src/routes/structures.ts` (3D structural orientation: strike, dip, plunge, fold)
  - [x] `src/routes/profiles.ts` (User profiling, country-to-currency auto-inference)

- [x] **Phase 3: Multi-Domain Project & Collaboration Engine**
  - [x] `src/routes/projects.ts` (Project creation, domain selection, collaborator sharing)
  - [x] `src/routes/hydrogeology.ts` (Borehole logs, aquifers, water tests, VES resistivity curves)

- [x] **Phase 4: Cloudflare R2 Storage & Presigned URLs**
  - [x] `src/routes/uploads.ts` (Direct S3/R2 presigned upload generator with zero egress fees)

- [x] **Phase 5: Real-Time Team Collaboration (SSE)**
  - [x] `src/routes/events.ts` (Server-Sent Events stream, live GPS member tracking, project chat stream)

- [x] **Phase 6: Reporting & Export Engine**
  - [x] `src/routes/reports.ts` (GeoJSON spatial export, CSV tabular export, structured executive summary)

- [ ] **Phase 7: Final Neon Auth UI & Protected Route Integration**
  - [ ] Connect Better Auth / Neon Auth session verification middleware


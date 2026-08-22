import { Router } from "express";
import swaggerUi from "swagger-ui-express";

export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Geolify Backend API",
    version: "2.0.0",
    description: `
**Geolify** is an enterprise-grade geological field mapping, hydrogeological surveying, and real-time collaborative exploration API.

### Key Capabilities:
* 🗺️ **Geological Field Mapping**: Stations, Outcrops, Rock Sample Inventory, and 3D Structural Measurements (Dip/Strike/Plunge).
* 💧 **Hydrogeological Exploration**: Boreholes, Lithology interval logs, VES Geophysical soundings, and Pumping test logs.
* 📡 **Offline Field Sync**: Client UUID-based Delta Sync with Last-Write-Wins and soft deletes for offline fieldwork.
* 🔴 **Real-Time Collaboration**: Server-Sent Events (SSE) live teammate streaming and field team chat.
* 🛡️ **Security**: JWT/JWKS token authentication, RBAC authorization, and CSV formula injection shielding.
    `,
    contact: {
      name: "Geolify Engineering Team",
      url: "https://geolify.com",
    },
  },
  servers: [
    {
      url: "/",
      description: "Current Server Environment",
    },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Standard JWT / JWKS token (Clerk, Supabase, Neon Auth, Firebase, or OIDC)",
      },
      ApiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "x-user-id",
        description: "Development/Internal User ID identifier header",
      },
    },
    schemas: {
      ErrorResponse: {
        type: "object",
        properties: {
          error: { type: "string" },
        },
      },
      Station: {
        type: "object",
        properties: {
          id: { type: "integer" },
          clientUuid: { type: "string", format: "uuid" },
          projectId: { type: "integer" },
          code: { type: "string", example: "ST-01" },
          name: { type: "string", example: "River Kanyoko Outcrop" },
          latitude: { type: "number", example: -1.286389 },
          longitude: { type: "number", example: 36.817223 },
          elevation: { type: "number", example: 1680.5 },
          gpsAccuracy: { type: "number", example: 3.2 },
          vegetation: { type: "string" },
          soilDescription: { type: "string" },
          landmarks: { type: "string" },
          outcropExposure: { type: "string", enum: ["in-situ", "float", "subcrop"] },
          weathering: { type: "string", enum: ["fresh", "slight", "moderate", "high"] },
          photoUrls: { type: "array", items: { type: "string" } },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      RockSample: {
        type: "object",
        properties: {
          id: { type: "integer" },
          clientUuid: { type: "string", format: "uuid" },
          stationId: { type: "integer" },
          sampleBagId: { type: "string", example: "SB-04" },
          probableRock: { type: "string", example: "Quartzofeldspathic Gneiss" },
          grainSize: { type: "string", enum: ["fine", "medium", "coarse", "pegmatitic"] },
          texture: { type: "string", enum: ["foliated", "massive", "banded", "porphyritic"] },
          maficPercent: { type: "number", example: 35 },
          felsicPercent: { type: "number", example: 65 },
          photoUrls: { type: "array", items: { type: "string" } },
          notes: { type: "string" },
        },
      },
      Borehole: {
        type: "object",
        properties: {
          id: { type: "integer" },
          clientUuid: { type: "string", format: "uuid" },
          projectId: { type: "integer" },
          boreholeNumber: { type: "string", example: "WRMA/BH/2026/01" },
          name: { type: "string", example: "Masinga Community Water Project" },
          latitude: { type: "number", example: -1.1234 },
          longitude: { type: "number", example: 37.5678 },
          totalDepth: { type: "number", example: 150.0 },
          staticWaterLevel: { type: "number", example: 42.5 },
          dischargeRate: { type: "number", example: 12.8 },
          aquiferType: { type: "string", example: "fractured_basement" },
        },
      },
    },
  },
  security: [
    { BearerAuth: [] },
    { ApiKeyAuth: [] },
  ],
  paths: {
    "/api/health": {
      get: {
        summary: "System and Database Health Check",
        tags: ["System"],
        responses: {
          200: {
            description: "System health metrics and DB connectivity status",
          },
        },
      },
    },
    "/api/projects": {
      get: {
        summary: "List all accessible projects for authenticated user",
        tags: ["Projects"],
        responses: {
          200: { description: "Array of projects" },
        },
      },
      post: {
        summary: "Create a new project",
        tags: ["Projects"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name", "projectType"],
                properties: {
                  name: { type: "string" },
                  projectType: { type: "string" },
                  description: { type: "string" },
                  clientOrOrg: { type: "string" },
                  budgetEstimated: { type: "number" },
                },
              },
            },
          },
        },
        responses: {
          201: { description: "Project created" },
        },
      },
    },
    "/api/stations": {
      get: {
        summary: "List stations by project",
        tags: ["Stations"],
        parameters: [
          { name: "projectId", in: "query", required: true, schema: { type: "integer" } },
        ],
        responses: {
          200: { description: "Array of stations" },
        },
      },
      post: {
        summary: "Create station",
        tags: ["Stations"],
        responses: {
          201: { description: "Station created" },
        },
      },
    },
    "/api/projects/{projectId}/sync/pull": {
      get: {
        summary: "Delta Sync: Fetch changes since a specific timestamp",
        tags: ["Offline Sync"],
        parameters: [
          { name: "projectId", in: "path", required: true, schema: { type: "integer" } },
          { name: "since", in: "query", schema: { type: "string", format: "date-time" } },
        ],
        responses: {
          200: { description: "Changed stations, rock samples, structures, and boreholes" },
        },
      },
    },
    "/api/projects/{projectId}/sync/push": {
      post: {
        summary: "Delta Sync: Batch ingest offline mutations with Last-Write-Wins",
        tags: ["Offline Sync"],
        parameters: [
          { name: "projectId", in: "path", required: true, schema: { type: "integer" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  stations: { type: "array", items: { $ref: "#/components/schemas/Station" } },
                  rockSamples: { type: "array", items: { $ref: "#/components/schemas/RockSample" } },
                  boreholes: { type: "array", items: { $ref: "#/components/schemas/Borehole" } },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Sync success report" },
        },
      },
    },
    "/api/projects/{projectId}/events": {
      get: {
        summary: "Server-Sent Events (SSE) live collaboration stream",
        tags: ["Real-Time Collaboration"],
        parameters: [
          { name: "projectId", in: "path", required: true, schema: { type: "integer" } },
        ],
        responses: {
          200: { description: "SSE stream connection" },
        },
      },
    },
    "/api/projects/{projectId}/export/geojson": {
      get: {
        summary: "Export project survey features as standard GeoJSON FeatureCollection",
        tags: ["Reports & Exports"],
        parameters: [
          { name: "projectId", in: "path", required: true, schema: { type: "integer" } },
        ],
        responses: {
          200: { description: "GeoJSON FeatureCollection" },
        },
      },
    },
    "/api/projects/{projectId}/export/csv": {
      get: {
        summary: "Export sanitized project survey dataset as CSV",
        tags: ["Reports & Exports"],
        parameters: [
          { name: "projectId", in: "path", required: true, schema: { type: "integer" } },
          { name: "entity", in: "query", schema: { type: "string", enum: ["stations", "rocks", "structures", "boreholes"] } },
        ],
        responses: {
          200: { description: "CSV file attachment" },
        },
      },
    },
    "/api/uploads/presigned-url": {
      post: {
        summary: "Generate presigned direct upload URL for S3 / Cloudflare R2",
        tags: ["Storage"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["fileName", "contentType"],
                properties: {
                  fileName: { type: "string" },
                  contentType: { type: "string" },
                  folder: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Presigned upload URL and public file URL" },
        },
      },
    },
  },
};

const swaggerRouter = Router();

// Serve raw JSON spec for external tooling & code generation
swaggerRouter.get("/openapi.json", (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(openApiSpec);
});

// Serve interactive Swagger UI
swaggerRouter.use("/", swaggerUi.serve, swaggerUi.setup(openApiSpec));

export default swaggerRouter;

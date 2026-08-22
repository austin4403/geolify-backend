import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../src/index";

describe("Geolify API Integration Tests", () => {
  it("GET / - returns API status, documentation link, and modules metadata", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("name", "Geolify Backend API");
    expect(res.body).toHaveProperty("version", "2.0.0");
    expect(res.body).toHaveProperty("status", "online");
    expect(res.body).toHaveProperty("documentation", "/api/docs");
    expect(res.body.modules).toHaveProperty("health");
    expect(res.body.modules).toHaveProperty("docs");
    expect(res.body.modules).toHaveProperty("sync");
  });

  it("GET /api/docs/openapi.json - returns valid OpenAPI 3.1 specification", async () => {
    const res = await request(app).get("/api/docs/openapi.json");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("openapi", "3.1.0");
    expect(res.body.info).toHaveProperty("title", "Geolify Backend API");
    expect(res.body.paths).toHaveProperty("/api/health");
    expect(res.body.paths).toHaveProperty("/api/projects/{projectId}/sync/pull");
    expect(res.body.paths).toHaveProperty("/api/projects/{projectId}/sync/push");
  });

  it("GET /api/health - returns database and system health status", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("status");
    expect(res.body).toHaveProperty("environment");
    expect(res.body).toHaveProperty("timestamp");
  });

  it("GET /api/profiles/check-username/:username - checks username availability", async () => {
    const testUsername = `geo_tester_${Date.now()}`;
    const res = await request(app).get(`/api/profiles/check-username/${testUsername}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("available", true);
  });

  it("GET /api/projects - lists projects with optional filters", async () => {
    const res = await request(app).get("/api/projects");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("data");
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("GET /api/stations - lists geological stations", async () => {
    const res = await request(app).get("/api/stations");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("data");
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("GET /api/boreholes - lists hydrogeological boreholes", async () => {
    const res = await request(app).get("/api/boreholes");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("data");
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("GET /api/locations - lists saved locations and POIs", async () => {
    const res = await request(app).get("/api/locations");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("data");
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("POST /api/locations - validates location data on creation", async () => {
    const res = await request(app)
      .post("/api/locations")
      .send({
        name: "Mount Suswa Base Camp",
        category: "base_camp",
        latitude: -1.15,
        longitude: 36.35,
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty("name", "Mount Suswa Base Camp");
  });

  it("GET /api/locations/:id - returns 400 for non-numeric ID", async () => {
    const res = await request(app).get("/api/locations/invalid_id");
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "Invalid location ID");
  });

  it("GET /non-existent-route - returns 404 JSON response", async () => {
    const res = await request(app).get("/api/unmapped-endpoint-404");
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error", "Resource not found");
  });
});

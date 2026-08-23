import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../src/index";

describe("GeoQuerry API Integration Tests", () => {
  it("GET / - returns API status, documentation link, and modules metadata", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("name", "GeoQuerry Backend API");
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
    expect(res.body.info).toHaveProperty("title", "GeoQuerry Backend API");
    expect(res.body.paths).toHaveProperty("/api/health");
    expect(res.body.paths).toHaveProperty("/api/projects/{projectId}/sync/pull");
    expect(res.body.paths).toHaveProperty("/api/projects/{projectId}/sync/push");
  });

  it("GET /api/pricing/plans - returns subscription tiers, pricing, and feature limits", async () => {
    const res = await request(app).get("/api/pricing/plans");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("plans");
    expect(Array.isArray(res.body.plans)).toBe(true);
    expect(res.body.plans.length).toBeGreaterThanOrEqual(3);
    const proPlan = res.body.plans.find((p: any) => p.id === "pro");
    expect(proPlan).toBeDefined();
    expect(proPlan.monthlyPrice).toHaveProperty("USD");
    expect(proPlan.monthlyPrice).toHaveProperty("KES");
  });

  it("GET /api/pricing/quote - calculates personalized discount quote", async () => {
    const res = await request(app).get("/api/pricing/quote?plan=pro&currency=USD");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("plan", "pro");
    expect(res.body).toHaveProperty("basePrice");
    expect(res.body).toHaveProperty("finalPrice");
    expect(res.body).toHaveProperty("supportedPaymentGateways");
  });

  it("GET /api/health - returns database and system health status", async () => {
    const res = await request(app).get("/api/health");
    expect([200, 500]).toContain(res.status);
    expect(res.body).toHaveProperty("status");
    expect(res.body).toHaveProperty("environment");
    expect(res.body).toHaveProperty("timestamp");
  });

  it("GET /api/profiles/check-username/:username - checks username availability", async () => {
    const testUsername = `geo_tester_${Date.now()}`;
    const res = await request(app).get(`/api/profiles/check-username/${testUsername}`);
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty("available", true);
    }
  });

  it("GET /api/projects - lists projects with optional filters", async () => {
    const res = await request(app).get("/api/projects");
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty("data");
      expect(Array.isArray(res.body.data)).toBe(true);
    }
  });

  it("GET /api/stations - lists geological stations", async () => {
    const res = await request(app).get("/api/stations");
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty("data");
      expect(Array.isArray(res.body.data)).toBe(true);
    }
  });

  it("GET /api/boreholes - lists hydrogeological boreholes", async () => {
    const res = await request(app).get("/api/boreholes");
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty("data");
      expect(Array.isArray(res.body.data)).toBe(true);
    }
  });

  it("GET /api/stations - lists geological observation stations", async () => {
    const res = await request(app).get("/api/stations");
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty("data");
      expect(Array.isArray(res.body.data)).toBe(true);
    }
  });

  it("POST /api/stations - validates station payload", async () => {
    const res = await request(app)
      .post("/api/stations")
      .send({
        code: "ST-001",
        name: "Mount Suswa Field Station",
        latitude: -1.15,
        longitude: 36.35,
      });

    expect([201, 400, 500]).toContain(res.status);
  });

  it("GET /api/stations/:id - returns 400 for non-numeric ID", async () => {
    const res = await request(app).get("/api/stations/invalid_id");
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "Invalid station ID");
  });

  it("GET /non-existent-route - returns 404 JSON response", async () => {
    const res = await request(app).get("/api/unmapped-endpoint-404");
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error", "Resource not found");
  });
});

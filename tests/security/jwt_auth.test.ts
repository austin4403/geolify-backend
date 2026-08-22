import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../src/index";
import { verifyToken } from "../../src/middleware/auth";
import { SignJWT } from "jose";

describe("JWT Authentication, Customer Benefits & Admin RBAC Tests", () => {
  it("verifyToken correctly parses token payload and extracts user identity", async () => {
    // Generate test JWT
    const secret = new TextEncoder().encode("dev-secret-key-12345678901234567890");
    const jwt = await new SignJWT({
      sub: "geologist_user_99",
      email: "jane.doe@geoquerry.com",
      role: "editor",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("2h")
      .sign(secret);

    const user = await verifyToken(jwt);
    expect(user).not.toBeNull();
    expect(user?.userId).toBe("geologist_user_99");
    expect(user?.email).toBe("jane.doe@geoquerry.com");
  });

  it("GET /api/projects/:id/sync/pull - rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/projects/1/sync/pull");
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  it("POST /api/projects/:id/sync/push - rejects unauthenticated requests", async () => {
    const res = await request(app)
      .post("/api/projects/1/sync/push")
      .send({
        stations: [],
        rockSamples: [],
        structuralMeasurements: [],
        boreholes: [],
      });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  it("GET /api/admin/users - rejects non-lead-dev users with 403 Forbidden", async () => {
    const res = await request(app)
      .get("/api/admin/users")
      .set("x-user-id", "regular_user_123")
      .set("x-user-email", "geologist@commercial.com");

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toContain("restricted exclusively to the Lead Developer");
  });

  it("POST /api/admin/users/:userId/tier - rejects unauthorized non-lead-dev tier assignment", async () => {
    const res = await request(app)
      .post("/api/admin/users/target_user_456/tier")
      .set("x-user-id", "regular_user_123")
      .send({
        tier: "core_dev",
      });

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error");
  });

  it("POST /api/profiles/apply-student - rejects unauthenticated student application", async () => {
    const res = await request(app)
      .post("/api/profiles/apply-student")
      .send({
        institutionName: "University of Nairobi",
        studentIdCardUrl: "https://example.com/id.jpg",
      });

    expect(res.status).toBe(401);
  });
});

import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../src/index";
import { verifyToken } from "../../src/middleware/auth";
import { generateToken } from "../../src/routes/auth";

describe("JWT Authentication, Customer Benefits & Admin RBAC Tests", () => {
  it("verifyToken correctly parses valid signed JWT and extracts user identity", async () => {
    const token = await generateToken({
      userId: "geologist_user_99",
      email: "jane.doe@geoquerry.com",
      role: "editor",
    });

    const user = await verifyToken(token);
    expect(user).not.toBeNull();
    expect(user?.userId).toBe("geologist_user_99");
    expect(user?.email).toBe("jane.doe@geoquerry.com");
  });

  it("verifyToken rejects forged/unverified tokens with invalid secret", async () => {
    const forgedToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbiIsInJvbGUiOiJsZWFkX2FkbWluIn0.invalid_signature";
    const user = await verifyToken(forgedToken);
    expect(user).toBeNull();
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

  it("GET /api/admin/users - rejects x-user-id header spoofing with 401 Unauthorized", async () => {
    const res = await request(app)
      .get("/api/admin/users")
      .set("x-user-id", "lead_admin_user");

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  it("GET /api/admin/users - rejects non-admin users with 403 Forbidden", async () => {
    const regularUserToken = await generateToken({
      userId: "regular_user_123",
      email: "geologist@commercial.com",
      role: "users",
    });

    const res = await request(app)
      .get("/api/admin/users")
      .set("Authorization", `Bearer ${regularUserToken}`);

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error");
  });

  it("POST /api/admin/users/:userId/tier - rejects unauthorized non-lead-admin tier assignment", async () => {
    const regularUserToken = await generateToken({
      userId: "regular_user_123",
      email: "geologist@commercial.com",
      role: "users",
    });

    const res = await request(app)
      .post("/api/admin/users/target_user_456/tier")
      .set("Authorization", `Bearer ${regularUserToken}`)
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

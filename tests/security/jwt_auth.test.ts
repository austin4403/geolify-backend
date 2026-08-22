import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../src/index";
import { verifyToken } from "../../src/middleware/auth";
import { SignJWT } from "jose";

describe("JWT Authentication & Offline Field Sync Tests", () => {
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
});

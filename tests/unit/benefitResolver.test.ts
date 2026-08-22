import { describe, it, expect } from "vitest";
import {
  resolveBestBenefitTier,
  isAcademicEmail,
  BETA_END_DATE,
} from "../../src/utils/benefitResolver";

describe("GeoQuerry Benefit & Discount Tier Resolver", () => {
  describe("Academic Email Detection", () => {
    it("identifies valid educational institution domains", () => {
      expect(isAcademicEmail("geologist@harvard.edu")).toBe(true);
      expect(isAcademicEmail("student@uonbi.ac.ke")).toBe(true);
      expect(isAcademicEmail("researcher@cam.ac.uk")).toBe(true);
      expect(isAcademicEmail("field.tech@adelaide.edu.au")).toBe(true);
    });

    it("rejects commercial and personal email domains", () => {
      expect(isAcademicEmail("john.doe@gmail.com")).toBe(false);
      expect(isAcademicEmail("geologist@miningcompany.com")).toBe(false);
      expect(isAcademicEmail("consultant@geo-tech.org")).toBe(false);
      expect(isAcademicEmail("")).toBe(false);
      expect(isAcademicEmail(undefined)).toBe(false);
    });
  });

  describe("Tier Hierarchy & Best Benefit Resolution", () => {
    it("assigns Core Dev (100% Free Lifetime) when approved by Lead Dev", () => {
      const result = resolveBestBenefitTier({
        email: "lead.dev@geoquerry.com",
        isCoreDevApproved: true,
      });

      expect(result.tier).toBe("core_dev");
      expect(result.discountPercent).toBe(100);
      expect(result.discountExpiresAt).toBeNull();
    });

    it("assigns Student Tier (70% Off for 1 Year) for academic email during beta (Student 70% > Beta 40%)", () => {
      const regDate = new Date("2026-09-01T12:00:00Z");
      const result = resolveBestBenefitTier({
        email: "geology.student@mit.edu",
        registrationDate: regDate,
      });

      expect(result.tier).toBe("student");
      expect(result.discountPercent).toBe(70);
      expect(result.discountExpiresAt).not.toBeNull();
      
      // Verification of 1 year duration
      const diffDays = Math.round(
        (result.discountExpiresAt!.getTime() - regDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      expect(diffDays).toBe(365);
    });

    it("assigns Beta Developer (40% Off for 1 Year) for non-student during beta window", () => {
      const regDate = new Date("2026-09-01T12:00:00Z");
      const result = resolveBestBenefitTier({
        email: "exploration.geologist@commercial.com",
        registrationDate: regDate,
      });

      expect(result.tier).toBe("beta_developer");
      expect(result.discountPercent).toBe(40);
      expect(result.discountExpiresAt).not.toBeNull();
    });

    it("assigns Standard Tier (0%) for registrations after April 30, 2027", () => {
      const postBetaDate = new Date("2027-05-15T12:00:00Z");
      const result = resolveBestBenefitTier({
        email: "new.user@gmail.com",
        registrationDate: postBetaDate,
      });

      expect(result.tier).toBe("standard");
      expect(result.discountPercent).toBe(0);
      expect(result.discountExpiresAt).toBeNull();
    });

    it("assigns Student Tier (70%) even after beta window for academic users", () => {
      const postBetaDate = new Date("2027-06-01T12:00:00Z");
      const result = resolveBestBenefitTier({
        email: "student@oxford.ac.uk",
        registrationDate: postBetaDate,
      });

      expect(result.tier).toBe("student");
      expect(result.discountPercent).toBe(70);
      expect(result.discountExpiresAt).not.toBeNull();
    });
  });
});

import { describe, it, expect } from "vitest";
import {
  galPerWeekAreaBased,
  galPerWeekPerPlant,
  getZoneTypes,
  galPerWeekRange,
  ZoneType,
} from "@/domain/water-need-calculator";

describe("water-need-calculator", () => {
  describe("galPerWeekAreaBased", () => {
    it("calculates gallons per week for cool-season-turf using 0.623 conversion", () => {
      // 1000 sqft × 1.25 inches × 0.623 = 778.75 gal/week
      const result = galPerWeekAreaBased("cool-season-turf", 1000, 1.25);
      expect(result.gal_per_week).toBeCloseTo(778.75, 0);
      expect(result.source).toContain("cool-season");
    });

    it("calculates gallons per week for warm-season-turf with default depth", () => {
      // 1000 sqft × (0.5+1.0)/2 = 0.75 inches × 0.623 = 467.25 gal/week
      const result = galPerWeekAreaBased("warm-season-turf", 1000);
      expect(result.gal_per_week).toBeCloseTo(467.25, 1);
    });

    it("rounds result to 2 decimal places", () => {
      const result = galPerWeekAreaBased("shrub", 100, 0.5);
      expect(result.gal_per_week).toBe(31.15);
    });

    it("handles vegetable zone type", () => {
      // 500 sqft × 1.0 inches × 0.623 = 311.5 gal/week
      const result = galPerWeekAreaBased("vegetable", 500, 1.0);
      expect(result.gal_per_week).toBeCloseTo(311.5, 1);
      expect(result.source).toContain("vegetable");
    });

    it("handles xeric zone type", () => {
      // 2000 sqft × 0.25 inches × 0.623 = 311.5 gal/week
      const result = galPerWeekAreaBased("xeric", 2000, 0.25);
      expect(result.gal_per_week).toBeCloseTo(311.5, 1);
    });

    it("throws error for unknown zone type", () => {
      expect(() => galPerWeekAreaBased("unknown-zone" as ZoneType, 1000)).toThrow(
        "Unknown zone type"
      );
    });

    it("tolerance check: 0.623 conversion within bounds", () => {
      const result = galPerWeekAreaBased("cool-season-turf", 1000, 1.0);
      // 1000 × 1.0 × 0.623 = 623 gal/week
      expect(result.gal_per_week).toBe(623);
    });
  });

  describe("galPerWeekPerPlant", () => {
    it("calculates gallons per week for trees with default rate", () => {
      // 3 trees × 7.5 gal/week = 22.5 gal/week
      const result = galPerWeekPerPlant("trees", 3);
      expect(result.gal_per_week).toBe(22.5);
      expect(result.source).toContain("default");
    });

    it("calculates gallons per week for shrubs with custom rate", () => {
      // 5 shrubs × 2.5 gal/week = 12.5 gal/week
      const result = galPerWeekPerPlant("shrub", 5, 2.5);
      expect(result.gal_per_week).toBe(12.5);
      expect(result.source).toContain("custom");
    });

    it("calculates gallons per week for vegetables", () => {
      // 10 plants × 1.25 gal/week = 12.5 gal/week
      const result = galPerWeekPerPlant("vegetable", 10);
      expect(result.gal_per_week).toBe(12.5);
    });

    it("handles zero plants", () => {
      const result = galPerWeekPerPlant("trees", 0);
      expect(result.gal_per_week).toBe(0);
    });

    it("rounds result to 2 decimal places", () => {
      // 3 × 1.234 = 3.702 → 3.7
      const result = galPerWeekPerPlant("vegetable", 3, 1.234);
      expect(result.gal_per_week).toBe(3.70);
    });

    it("throws error for unknown zone type in per-plant", () => {
      expect(() => galPerWeekPerPlant("unknown-zone" as ZoneType, 5)).toThrow(
        "Unknown zone type"
      );
    });

    it("uses default rate when custom is undefined", () => {
      const withDefault = galPerWeekPerPlant("shrub", 4);
      const withCustom = galPerWeekPerPlant("shrub", 4, 3.5); // shrub default is 3.5
      expect(withDefault.gal_per_week).toBe(withCustom.gal_per_week);
    });
  });

  describe("galPerWeekRange", () => {
    it("returns min and max gal/week range for zone type", () => {
      // cool-season: [1.0, 1.5] inches × 1000 sqft × 0.623
      const [min, max] = galPerWeekRange("cool-season-turf", 1000);
      expect(min).toBeCloseTo(623, 1);
      expect(max).toBeCloseTo(934.5, 1);
    });

    it("range for warm-season turf", () => {
      // [0.5, 1.0] inches × 1000 sqft × 0.623
      const [min, max] = galPerWeekRange("warm-season-turf", 1000);
      expect(min).toBeCloseTo(311.5, 1);
      expect(max).toBeCloseTo(623, 1);
    });

    it("throws error for unknown zone type in range", () => {
      expect(() => galPerWeekRange("unknown-zone" as ZoneType, 1000)).toThrow(
        "Unknown zone type"
      );
    });

    it("range scales with area", () => {
      const [min1, max1] = galPerWeekRange("shrub", 100);
      const [min2, max2] = galPerWeekRange("shrub", 200);
      expect(min2).toBe(min1 * 2);
      expect(max2).toBe(max1 * 2);
    });
  });

  describe("getZoneTypes", () => {
    it("returns all zone types with labels", () => {
      const types = getZoneTypes();
      expect(types.length).toBeGreaterThan(0);
      expect(types.some((t) => t.value === "cool-season-turf")).toBe(true);
      expect(types.some((t) => t.value === "trees")).toBe(true);
    });

    it("each zone type has a label", () => {
      const types = getZoneTypes();
      types.forEach((type) => {
        expect(type.label).toBeTruthy();
        expect(typeof type.label).toBe("string");
      });
    });
  });

  describe("edge cases", () => {
    it("handles zero area", () => {
      const result = galPerWeekAreaBased("cool-season-turf", 0);
      expect(result.gal_per_week).toBe(0);
    });

    it("handles very large area", () => {
      const result = galPerWeekAreaBased("cool-season-turf", 100000, 1.0);
      // 100000 × 1.0 × 0.623 = 62300
      expect(result.gal_per_week).toBeCloseTo(62300, 0);
    });

    it("handles fractional depth", () => {
      const result = galPerWeekAreaBased("cool-season-turf", 1000, 0.333);
      // 1000 × 0.333 × 0.623 = 207.459 ≈ 207.46
      expect(result.gal_per_week).toBeCloseTo(207.46, 1);
    });
  });
});

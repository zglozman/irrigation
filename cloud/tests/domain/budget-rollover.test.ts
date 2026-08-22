import { describe, it, expect } from "vitest";
import { rolloverBudgetIfNeeded } from "@/domain/budget-rollover";

describe("budget-rollover", () => {
  describe("rolloverBudgetIfNeeded", () => {
    it("keeps budget if within 7 days", () => {
      const baseDate = new Date("2026-08-22T00:00:00Z");
      const weekStart = new Date("2026-08-22T00:00:00Z");

      const result = rolloverBudgetIfNeeded(
        {
          week_start_date: weekStart.toISOString(),
          delivered_gal_this_week: 100,
          rainfall_gal_this_week: 50,
        },
        baseDate
      );

      expect(result.deliveredGal).toBe(100);
      expect(result.rainfallGal).toBe(50);
      expect(result.weekStart).toBe(weekStart.toISOString());
    });

    it("resets budget if more than 7 days old", () => {
      const baseDate = new Date("2026-08-29T00:00:00Z");
      const oldWeekStart = new Date("2026-08-21T00:00:00Z"); // 8 days old

      const result = rolloverBudgetIfNeeded(
        {
          week_start_date: oldWeekStart.toISOString(),
          delivered_gal_this_week: 100,
          rainfall_gal_this_week: 50,
        },
        baseDate
      );

      expect(result.deliveredGal).toBe(0);
      expect(result.rainfallGal).toBe(0);
      expect(result.weekStart).toMatch(/2026-08-29/);
    });

    it("regression: resets BOTH delivered and rainfall on rollover", () => {
      // regression: rollover once reset only one
      const baseDate = new Date("2026-09-01T00:00:00Z");
      const oldWeekStart = new Date("2026-08-20T00:00:00Z"); // >7 days

      const result = rolloverBudgetIfNeeded(
        {
          week_start_date: oldWeekStart.toISOString(),
          delivered_gal_this_week: 250,
          rainfall_gal_this_week: 100,
        },
        baseDate
      );

      // Both should be reset to 0
      expect(result.deliveredGal).toBe(0);
      expect(result.rainfallGal).toBe(0);
      // And verify week start is updated
      expect(result.weekStart).toMatch(/2026-09-01/);
    });

    it("boundary case: exactly 7 days keeps budget", () => {
      const baseDate = new Date("2026-08-29T00:00:00Z");
      const weekStart = new Date("2026-08-22T00:00:00Z"); // Exactly 7 days

      const result = rolloverBudgetIfNeeded(
        {
          week_start_date: weekStart.toISOString(),
          delivered_gal_this_week: 100,
          rainfall_gal_this_week: 50,
        },
        baseDate
      );

      // At exactly 7 days, should still keep budget
      expect(result.deliveredGal).toBe(100);
      expect(result.rainfallGal).toBe(50);
    });

    it("boundary case: 7.5 days does not trigger rollover (floor is 7 days)", () => {
      const baseDate = new Date("2026-08-29T12:00:00Z");
      const weekStart = new Date("2026-08-22T00:00:00Z"); // 7.5 days

      const result = rolloverBudgetIfNeeded(
        {
          week_start_date: weekStart.toISOString(),
          delivered_gal_this_week: 100,
          rainfall_gal_this_week: 50,
        },
        baseDate
      );

      // Math.floor(7.5) = 7, and 7 > 7 is false, so no rollover
      expect(result.deliveredGal).toBe(100);
      expect(result.rainfallGal).toBe(50);
    });

    it("formats new week start date correctly as ISO string", () => {
      const baseDate = new Date("2026-08-29T14:30:00Z");
      const oldWeekStart = new Date("2026-08-20T00:00:00Z");

      const result = rolloverBudgetIfNeeded(
        {
          week_start_date: oldWeekStart.toISOString(),
          delivered_gal_this_week: 0,
          rainfall_gal_this_week: 0,
        },
        baseDate
      );

      // Should be a valid ISO string containing the date
      expect(result.weekStart).toMatch(/2026-08-29/);
    });

    it("handles zero-valued budget", () => {
      const baseDate = new Date("2026-08-22T00:00:00Z");
      const weekStart = new Date("2026-08-22T00:00:00Z");

      const result = rolloverBudgetIfNeeded(
        {
          week_start_date: weekStart.toISOString(),
          delivered_gal_this_week: 0,
          rainfall_gal_this_week: 0,
        },
        baseDate
      );

      expect(result.deliveredGal).toBe(0);
      expect(result.rainfallGal).toBe(0);
    });

    it("handles large values", () => {
      const baseDate = new Date("2026-08-22T00:00:00Z");
      const weekStart = new Date("2026-08-22T00:00:00Z");

      const result = rolloverBudgetIfNeeded(
        {
          week_start_date: weekStart.toISOString(),
          delivered_gal_this_week: 5000,
          rainfall_gal_this_week: 2000,
        },
        baseDate
      );

      expect(result.deliveredGal).toBe(5000);
      expect(result.rainfallGal).toBe(2000);
    });

    it("calculates days correctly across month boundary", () => {
      const baseDate = new Date("2026-09-05T00:00:00Z");
      const weekStart = new Date("2026-08-28T00:00:00Z"); // 8 days before Sep 5

      const result = rolloverBudgetIfNeeded(
        {
          week_start_date: weekStart.toISOString(),
          delivered_gal_this_week: 100,
          rainfall_gal_this_week: 50,
        },
        baseDate
      );

      expect(result.deliveredGal).toBe(0);
      expect(result.rainfallGal).toBe(0);
    });

    it("calculates days correctly across year boundary", () => {
      const baseDate = new Date("2027-01-05T00:00:00Z");
      const weekStart = new Date("2026-12-28T00:00:00Z"); // 8 days before Jan 5

      const result = rolloverBudgetIfNeeded(
        {
          week_start_date: weekStart.toISOString(),
          delivered_gal_this_week: 100,
          rainfall_gal_this_week: 50,
        },
        baseDate
      );

      expect(result.deliveredGal).toBe(0);
      expect(result.rainfallGal).toBe(0);
    });

    it("handles high-precision fractional days", () => {
      // Start: Sun Aug 22 00:00:00 UTC
      // Base: Sun Aug 29 12:00:00 UTC = 7.5 days later
      const baseDate = new Date("2026-08-29T12:00:00.000Z");
      const weekStart = new Date("2026-08-22T00:00:00.000Z");

      const result = rolloverBudgetIfNeeded(
        {
          week_start_date: weekStart.toISOString(),
          delivered_gal_this_week: 100,
          rainfall_gal_this_week: 50,
        },
        baseDate
      );

      // Fractional days: floor(7.5) = 7 days, which is NOT > 7, so no rollover
      // Actually, the code does Math.floor, so at 7.5 days old, daysOld = 7
      // and 7 > 7 is false, so it keeps the budget
      expect(result.deliveredGal).toBe(100);
    });
  });

  describe("edge cases", () => {
    it("handles same second (0 days old)", () => {
      const date = new Date("2026-08-22T12:30:45.123Z");
      const result = rolloverBudgetIfNeeded(
        {
          week_start_date: date.toISOString(),
          delivered_gal_this_week: 100,
          rainfall_gal_this_week: 50,
        },
        date
      );

      expect(result.deliveredGal).toBe(100);
      expect(result.rainfallGal).toBe(50);
    });

    it("handles very far in the future (resets)", () => {
      const weekStart = new Date("2026-08-22T00:00:00Z");
      const baseDate = new Date("2027-08-22T00:00:00Z"); // 365 days later

      const result = rolloverBudgetIfNeeded(
        {
          week_start_date: weekStart.toISOString(),
          delivered_gal_this_week: 100,
          rainfall_gal_this_week: 50,
        },
        baseDate
      );

      expect(result.deliveredGal).toBe(0);
      expect(result.rainfallGal).toBe(0);
    });
  });
});

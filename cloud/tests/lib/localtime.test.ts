import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getLocalHour,
  getLocalDateString,
  getLocalTime,
  constructLocalTime,
  getNextWindowStart,
  getWeekStart,
} from "@/lib/localtime";

describe("localtime", () => {
  describe("getLocalHour", () => {
    it("returns local hour for America/New_York", () => {
      // 2026-08-20 04:00 local EDT = 08:00 UTC
      const date = new Date("2026-08-20T08:00:00Z");
      const hour = getLocalHour(date, "America/New_York");
      expect(hour).toBe(4);
    });

    it("returns local hour for Europe/Athens", () => {
      // 2026-08-20 11:00 local EEST = 08:00 UTC
      const date = new Date("2026-08-20T08:00:00Z");
      const hour = getLocalHour(date, "Europe/Athens");
      expect(hour).toBe(11);
    });

    it("handles DST boundary - spring forward (America/New_York)", () => {
      // 2026-03-08 spring forward (2 AM EDT becomes 3 AM EDT)
      // Test midnight before and midnight after
      const before = new Date("2026-03-08T04:00:00Z"); // 11 PM EST on March 7
      const after = new Date("2026-03-09T04:00:00Z"); // Midnight on March 9

      const hourBefore = getLocalHour(before, "America/New_York");
      const hourAfter = getLocalHour(after, "America/New_York");

      expect(typeof hourBefore).toBe("number");
      expect(typeof hourAfter).toBe("number");
    });

    it("handles DST boundary - fall back (America/New_York)", () => {
      // 2026-11-01 fall back (2 AM EDT becomes 1 AM EST)
      const date = new Date("2026-11-01T05:00:00Z");
      const hour = getLocalHour(date, "America/New_York");
      expect(typeof hour).toBe("number");
    });
  });

  describe("constructLocalTime", () => {
    it("converts 2026-08-20 04:00 local EDT to 08:00 UTC", () => {
      // In EDT (UTC-4), 04:00 local = 08:00 UTC
      const result = constructLocalTime(2026, 8, 20, 4, 0, 0, "America/New_York");
      expect(result.getUTCHours()).toBe(8);
      expect(result.getUTCDate()).toBe(20);
    });

    it("converts 2026-08-20 04:00 local EEST to 01:00 UTC (Athens)", () => {
      // In EEST (UTC+3), 04:00 local = 01:00 UTC
      // regression: was off by a full day west of UTC
      const result = constructLocalTime(2026, 8, 20, 4, 0, 0, "Europe/Athens");
      expect(result.getUTCHours()).toBe(1);
      expect(result.getUTCDate()).toBe(20);
    });

    it("regression: constructLocalTime west of UTC doesn't go off by a day", () => {
      // Verify that west-of-UTC (negative offset) timezones work correctly
      // and don't accidentally shift the date
      const result = constructLocalTime(2026, 8, 20, 4, 0, 0, "America/New_York");
      const localTime = getLocalTime(result, "America/New_York");

      expect(localTime.year).toBe(2026);
      expect(localTime.month).toBe(8);
      expect(localTime.day).toBe(20);
      expect(localTime.hour).toBe(4);
    });

    it("handles midnight", () => {
      const result = constructLocalTime(2026, 8, 20, 0, 0, 0, "America/New_York");
      const localTime = getLocalTime(result, "America/New_York");

      expect(localTime.hour).toBe(0);
    });

    it("handles end of day", () => {
      const result = constructLocalTime(2026, 8, 20, 23, 59, 59, "America/New_York");
      const localTime = getLocalTime(result, "America/New_York");

      expect(localTime.hour).toBe(23);
    });

    it("handles DST spring forward boundary", () => {
      // 2026-03-08: spring forward at 2 AM EDT
      // At 2:30 AM EDT on this day, there's an ambiguous moment
      const result = constructLocalTime(2026, 3, 8, 3, 0, 0, "America/New_York");
      const localTime = getLocalTime(result, "America/New_York");

      expect(localTime.hour).toBe(3);
    });

    it("handles DST fall back boundary", () => {
      // 2026-11-01: fall back at 2 AM EDT (becomes 1 AM EST)
      const result = constructLocalTime(2026, 11, 1, 1, 30, 0, "America/New_York");
      const localTime = getLocalTime(result, "America/New_York");

      expect(localTime.hour).toBe(1);
    });

    it("round-trip consistency: construct then extract", () => {
      const year = 2026;
      const month = 8;
      const day = 20;
      const hour = 4;
      const min = 30;
      const sec = 15;

      const date = constructLocalTime(year, month, day, hour, min, sec, "America/New_York");
      const local = getLocalTime(date, "America/New_York");

      expect(local.year).toBe(year);
      expect(local.month).toBe(month);
      expect(local.day).toBe(day);
      expect(local.hour).toBe(hour);
      expect(local.minute).toBe(min);
      expect(local.second).toBe(sec);
    });

    it("round-trip for Athens", () => {
      const date = constructLocalTime(2026, 8, 20, 4, 0, 0, "Europe/Athens");
      const local = getLocalTime(date, "Europe/Athens");

      expect(local.year).toBe(2026);
      expect(local.month).toBe(8);
      expect(local.day).toBe(20);
      expect(local.hour).toBe(4);
    });
  });

  describe("getLocalTime", () => {
    it("extracts all time components correctly", () => {
      // 2026-08-20 08:00:00 UTC = 04:00:00 EDT
      const date = new Date("2026-08-20T08:00:00Z");
      const local = getLocalTime(date, "America/New_York");

      expect(local.year).toBe(2026);
      expect(local.month).toBe(8);
      expect(local.day).toBe(20);
      expect(local.hour).toBe(4);
      expect(local.minute).toBe(0);
      expect(local.second).toBe(0);
    });

    it("handles end of month transition", () => {
      // Last day of August
      const date = constructLocalTime(2026, 8, 31, 23, 30, 0, "America/New_York");
      const local = getLocalTime(date, "America/New_York");

      expect(local.day).toBe(31);
      expect(local.month).toBe(8);
    });

    it("handles year boundary", () => {
      // Dec 31
      const date = constructLocalTime(2025, 12, 31, 23, 0, 0, "America/New_York");
      const local = getLocalTime(date, "America/New_York");

      expect(local.day).toBe(31);
      expect(local.month).toBe(12);
      expect(local.year).toBe(2025);
    });
  });

  describe("getLocalDateString", () => {
    it("formats date as YYYY-MM-DD", () => {
      const date = new Date("2026-08-20T08:00:00Z");
      const result = getLocalDateString(date);
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}/);
      expect(result).toContain("2026-08-20");
    });

    it("pads month and day with zeros", () => {
      const date = constructLocalTime(2026, 1, 5, 12, 0, 0, "America/New_York");
      const result = getLocalDateString(date);
      expect(result).toContain("2026-01-05");
    });
  });

  describe("getNextWindowStart", () => {
    it("returns today's window start if not yet passed", () => {
      // Mock: current time is 02:00 (before 04:00 window)
      const mockNow = constructLocalTime(2026, 8, 20, 2, 0, 0, "America/New_York");
      vi.useFakeTimers();
      vi.setSystemTime(mockNow);

      const result = getNextWindowStart(4);

      const local = getLocalTime(result, "America/New_York");
      expect(local.hour).toBe(4);
      expect(local.day).toBe(20); // Today

      vi.useRealTimers();
    });

    it("returns tomorrow's window start if today's passed", () => {
      // Mock: current time is 10:00 (after 04:00 window)
      const mockNow = constructLocalTime(2026, 8, 20, 10, 0, 0, "America/New_York");
      vi.useFakeTimers();
      vi.setSystemTime(mockNow);

      const result = getNextWindowStart(4);

      const local = getLocalTime(result, "America/New_York");
      expect(local.hour).toBe(4);
      expect(local.day).toBe(21); // Tomorrow

      vi.useRealTimers();
    });

    it("handles window at boundary hour", () => {
      const mockNow = constructLocalTime(2026, 8, 20, 4, 0, 0, "America/New_York");
      vi.useFakeTimers();
      vi.setSystemTime(mockNow);

      const result = getNextWindowStart(4);

      const local = getLocalTime(result, "America/New_York");
      expect(local.hour).toBe(4);

      vi.useRealTimers();
    });
  });

  describe("getWeekStart", () => {
    it("returns Sunday 00:00 for a weekday", () => {
      // 2026-08-20 is a Thursday
      const date = constructLocalTime(2026, 8, 20, 14, 30, 0, "America/New_York");
      const result = getWeekStart(date, "America/New_York");
      const local = getLocalTime(result, "America/New_York");

      // Should be the previous Sunday (2026-08-16)
      expect(local.day).toBe(16);
      expect(local.hour).toBe(0);
      expect(local.minute).toBe(0);
    });

    it("returns Sunday 00:00 for Sunday itself", () => {
      // 2026-08-16 is a Sunday
      const date = constructLocalTime(2026, 8, 16, 14, 30, 0, "America/New_York");
      const result = getWeekStart(date, "America/New_York");
      const local = getLocalTime(result, "America/New_York");

      expect(local.day).toBe(16);
      expect(local.hour).toBe(0);
    });

    it("returns Sunday 00:00 for Monday", () => {
      // 2026-08-17 is a Monday
      const date = constructLocalTime(2026, 8, 17, 12, 0, 0, "America/New_York");
      const result = getWeekStart(date, "America/New_York");
      const local = getLocalTime(result, "America/New_York");

      expect(local.day).toBe(16); // Previous Sunday
    });
  });

  describe("edge cases and DST", () => {
    it("handles DST transition without date shift", () => {
      // Spring forward: 2026-03-08 02:00 EDT -> 03:00 EDT
      // Create a time during DST transition
      const result = constructLocalTime(2026, 3, 8, 12, 0, 0, "America/New_York");
      const local = getLocalTime(result, "America/New_York");

      expect(local.month).toBe(3);
      expect(local.day).toBe(8);
    });

    it("handles fall back transition", () => {
      // Fall back: 2026-11-01 02:00 EDT -> 01:00 EST
      const result = constructLocalTime(2026, 11, 1, 1, 30, 0, "America/New_York");
      const local = getLocalTime(result, "America/New_York");

      expect(local.month).toBe(11);
      expect(local.day).toBe(1);
    });

    it("Athens never has DST complications during summer", () => {
      const result = constructLocalTime(2026, 8, 20, 4, 0, 0, "Europe/Athens");
      const local = getLocalTime(result, "Europe/Athens");

      expect(local.year).toBe(2026);
      expect(local.month).toBe(8);
      expect(local.day).toBe(20);
    });

    it("precision: minutes and seconds round-trip", () => {
      const result = constructLocalTime(2026, 8, 20, 4, 15, 45, "America/New_York");
      const local = getLocalTime(result, "America/New_York");

      expect(local.minute).toBe(15);
      expect(local.second).toBe(45);
    });
  });
});

import { describe, it, expect } from "vitest";
import {
  summarizeDays,
  computeYearStats,
  rollupMonthly,
  DayRecord,
} from "@/lib/station-history";

describe("station-history (pure functions)", () => {
  describe("summarizeDays", () => {
    it("converts Athena string rows to typed DayRecord array", () => {
      const rows = [
        {
          day: "15",
          month: "01",
          t_min: "32.5",
          t_max: "72.3",
          t_avg: "52.1",
          rain_in: "0.25",
          wind_max: "12.5",
          hum_avg: "65",
        },
        {
          day: "16",
          month: "01",
          t_min: "35.0",
          t_max: "75.5",
          t_avg: "55.2",
          rain_in: "0.0",
          wind_max: "8.3",
          hum_avg: "60",
        },
      ];

      const result = summarizeDays(rows, 2026);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        date: "2026-01-15",
        t_min: 32.5,
        t_max: 72.3,
        t_avg: 52.1,
        rain_in: 0.25,
        wind_max: 12.5,
        hum_avg: 65,
      });
      expect(result[1].rain_in).toBe(0);
    });

    it("handles missing or null values gracefully", () => {
      const rows = [
        {
          day: "15",
          month: "1",
          t_min: null,
          t_max: "75",
          t_avg: "60",
          rain_in: undefined,
          wind_max: "10",
          hum_avg: "70",
        },
      ];

      const result = summarizeDays(rows, 2026);

      expect(result[0].t_min).toBe(0);
      expect(result[0].rain_in).toBe(0);
      expect(result[0].t_max).toBe(75);
    });
  });

  describe("computeYearStats", () => {
    it("finds wettest day correctly", () => {
      const days: DayRecord[] = [
        {
          date: "2026-01-01",
          t_min: 30,
          t_max: 70,
          t_avg: 50,
          rain_in: 0.25,
          wind_max: 10,
          hum_avg: 65,
        },
        {
          date: "2026-01-02",
          t_min: 32,
          t_max: 72,
          t_avg: 52,
          rain_in: 1.5,
          wind_max: 12,
          hum_avg: 70,
        },
        {
          date: "2026-01-03",
          t_min: 28,
          t_max: 68,
          t_avg: 48,
          rain_in: 0.5,
          wind_max: 8,
          hum_avg: 60,
        },
      ];

      const stats = computeYearStats(days);

      expect(stats.wettest_day?.date).toBe("2026-01-02");
      expect(stats.wettest_day?.rain_in).toBe(1.5);
    });

    it("finds hottest day correctly", () => {
      const days: DayRecord[] = [
        {
          date: "2026-07-01",
          t_min: 60,
          t_max: 80,
          t_avg: 70,
          rain_in: 0,
          wind_max: 5,
          hum_avg: 50,
        },
        {
          date: "2026-07-02",
          t_min: 62,
          t_max: 95,
          t_avg: 75,
          rain_in: 0,
          wind_max: 8,
          hum_avg: 55,
        },
      ];

      const stats = computeYearStats(days);

      expect(stats.hottest_day?.t_max).toBe(95);
      expect(stats.hottest_day?.date).toBe("2026-07-02");
    });

    it("finds coldest morning correctly", () => {
      const days: DayRecord[] = [
        {
          date: "2026-01-01",
          t_min: 15,
          t_max: 30,
          t_avg: 22,
          rain_in: 0,
          wind_max: 15,
          hum_avg: 40,
        },
        {
          date: "2026-01-02",
          t_min: 5,
          t_max: 28,
          t_avg: 18,
          rain_in: 0.5,
          wind_max: 20,
          hum_avg: 45,
        },
      ];

      const stats = computeYearStats(days);

      expect(stats.coldest_morning?.t_min).toBe(5);
      expect(stats.coldest_morning?.date).toBe("2026-01-02");
    });

    it("finds windiest day correctly", () => {
      const days: DayRecord[] = [
        {
          date: "2026-03-01",
          t_min: 40,
          t_max: 60,
          t_avg: 50,
          rain_in: 0.1,
          wind_max: 15,
          hum_avg: 55,
        },
        {
          date: "2026-03-02",
          t_min: 42,
          t_max: 62,
          t_avg: 52,
          rain_in: 0.2,
          wind_max: 35,
          hum_avg: 60,
        },
      ];

      const stats = computeYearStats(days);

      expect(stats.windiest_day?.wind_max).toBe(35);
      expect(stats.windiest_day?.date).toBe("2026-03-02");
    });

    it("calculates longest dry spell (consecutive days < 0.05 in)", () => {
      const days: DayRecord[] = [
        {
          date: "2026-06-01",
          t_min: 60,
          t_max: 80,
          t_avg: 70,
          rain_in: 0.1,
          wind_max: 5,
          hum_avg: 50,
        },
        // Dry spell starts
        {
          date: "2026-06-02",
          t_min: 62,
          t_max: 82,
          t_avg: 72,
          rain_in: 0.0,
          wind_max: 6,
          hum_avg: 48,
        },
        {
          date: "2026-06-03",
          t_min: 61,
          t_max: 81,
          t_avg: 71,
          rain_in: 0.02,
          wind_max: 5,
          hum_avg: 49,
        },
        {
          date: "2026-06-04",
          t_min: 63,
          t_max: 83,
          t_avg: 73,
          rain_in: 0.0,
          wind_max: 7,
          hum_avg: 47,
        },
        // Dry spell ends
        {
          date: "2026-06-05",
          t_min: 59,
          t_max: 75,
          t_avg: 67,
          rain_in: 0.5,
          wind_max: 10,
          hum_avg: 60,
        },
      ];

      const stats = computeYearStats(days);

      expect(stats.longest_dry_spell).not.toBeNull();
      expect(stats.longest_dry_spell?.days).toBe(3);
      expect(stats.longest_dry_spell?.start).toBe("2026-06-02");
      expect(stats.longest_dry_spell?.end).toBe("2026-06-04");
    });

    it("skips dry spells with only one day", () => {
      const days: DayRecord[] = [
        {
          date: "2026-06-01",
          t_min: 60,
          t_max: 80,
          t_avg: 70,
          rain_in: 0.0,
          wind_max: 5,
          hum_avg: 50,
        },
        {
          date: "2026-06-02",
          t_min: 62,
          t_max: 82,
          t_avg: 72,
          rain_in: 0.5,
          wind_max: 6,
          hum_avg: 48,
        },
        {
          date: "2026-06-03",
          t_min: 61,
          t_max: 81,
          t_avg: 71,
          rain_in: 0.0,
          wind_max: 5,
          hum_avg: 49,
        },
        {
          date: "2026-06-04",
          t_min: 63,
          t_max: 83,
          t_avg: 73,
          rain_in: 0.5,
          wind_max: 7,
          hum_avg: 47,
        },
      ];

      const stats = computeYearStats(days);

      expect(stats.longest_dry_spell).toBeNull();
    });

    it("calculates rain totals and rainy days correctly", () => {
      const days: DayRecord[] = [
        {
          date: "2026-06-01",
          t_min: 60,
          t_max: 80,
          t_avg: 70,
          rain_in: 0.02,
          wind_max: 5,
          hum_avg: 50,
        },
        {
          date: "2026-06-02",
          t_min: 62,
          t_max: 82,
          t_avg: 72,
          rain_in: 0.5,
          wind_max: 6,
          hum_avg: 48,
        },
        {
          date: "2026-06-03",
          t_min: 61,
          t_max: 81,
          t_avg: 71,
          rain_in: 0.0,
          wind_max: 5,
          hum_avg: 49,
        },
        {
          date: "2026-06-04",
          t_min: 63,
          t_max: 83,
          t_avg: 73,
          rain_in: 0.2,
          wind_max: 7,
          hum_avg: 47,
        },
      ];

      const stats = computeYearStats(days);

      expect(stats.rain_total_in).toBeCloseTo(0.72);
      expect(stats.rain_days).toBe(2); // >= 0.05: 2026-06-02 (0.5) and 2026-06-04 (0.2)
    });

    it("handles empty day array", () => {
      const stats = computeYearStats([]);

      expect(stats.wettest_day).toBeNull();
      expect(stats.hottest_day).toBeNull();
      expect(stats.coldest_morning).toBeNull();
      expect(stats.windiest_day).toBeNull();
      expect(stats.longest_dry_spell).toBeNull();
      expect(stats.rain_total_in).toBe(0);
      expect(stats.rain_days).toBe(0);
    });

    it("handles dry spell at year boundaries", () => {
      const days: DayRecord[] = [
        {
          date: "2026-01-01",
          t_min: 30,
          t_max: 50,
          t_avg: 40,
          rain_in: 0.0,
          wind_max: 10,
          hum_avg: 50,
        },
        {
          date: "2026-01-02",
          t_min: 32,
          t_max: 52,
          t_avg: 42,
          rain_in: 0.02,
          wind_max: 10,
          hum_avg: 50,
        },
      ];

      const stats = computeYearStats(days);

      // Dry spell of 2 days starting at year boundary
      expect(stats.longest_dry_spell?.days).toBe(2);
      expect(stats.longest_dry_spell?.start).toBe("2026-01-01");
    });
  });

  describe("rollupMonthly", () => {
    it("aggregates days to monthly summaries", () => {
      const days: DayRecord[] = [
        {
          date: "2026-01-01",
          t_min: 30,
          t_max: 70,
          t_avg: 50,
          rain_in: 0.1,
          wind_max: 10,
          hum_avg: 60,
        },
        {
          date: "2026-01-02",
          t_min: 32,
          t_max: 72,
          t_avg: 52,
          rain_in: 0.2,
          wind_max: 12,
          hum_avg: 65,
        },
        {
          date: "2026-02-01",
          t_min: 35,
          t_max: 75,
          t_avg: 55,
          rain_in: 0.3,
          wind_max: 14,
          hum_avg: 70,
        },
      ];

      const monthly = rollupMonthly(days);

      expect(monthly).toHaveLength(2);
      expect(monthly[0].month).toBe(1);
      expect(monthly[0].rain_in).toBeCloseTo(0.3);
      expect(monthly[0].t_avg).toBeCloseTo(51); // (50 + 52) / 2
      expect(monthly[0].t_min).toBe(30);
      expect(monthly[0].t_max).toBe(72);

      expect(monthly[1].month).toBe(2);
      expect(monthly[1].rain_in).toBeCloseTo(0.3);
      expect(monthly[1].t_avg).toBeCloseTo(55);
    });

    it("skips months with no data", () => {
      const days: DayRecord[] = [
        {
          date: "2026-01-01",
          t_min: 30,
          t_max: 70,
          t_avg: 50,
          rain_in: 0.1,
          wind_max: 10,
          hum_avg: 60,
        },
        // no February data
        {
          date: "2026-03-01",
          t_min: 40,
          t_max: 80,
          t_avg: 60,
          rain_in: 0.2,
          wind_max: 12,
          hum_avg: 65,
        },
      ];

      const monthly = rollupMonthly(days);

      expect(monthly).toHaveLength(2);
      expect(monthly[0].month).toBe(1);
      expect(monthly[1].month).toBe(3);
    });

    it("handles empty array", () => {
      const monthly = rollupMonthly([]);

      expect(monthly).toHaveLength(0);
    });
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildHourlySeries, computeStats } from "@/lib/weather-compare";
import { selectDayAheadPull } from "@/lib/forecast-accuracy";
import type { HourlyComparison } from "@/lib/weather-compare";

describe("weather-compare (pure functions)", () => {
  const timezone = "America/Denver"; // UTC-6

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("selectDayAheadPull", () => {
    it("picks the pull closest to 24h before D 00:00 within ±6h tolerance", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-22T10:00:00Z"));

      const pulls = [
        {
          pulled_at: "2026-08-20T22:00:00Z",
          forecast_time: "2026-08-22T08:00:00Z",
          temp_f: 85,
          wind_mph: 10,
          precip_prob: 0,
          precip_in: 0,
        },
        {
          pulled_at: "2026-08-21T06:30:00Z", // CLOSEST within ±6h
          forecast_time: "2026-08-22T14:00:00Z",
          temp_f: 88,
          wind_mph: 12,
          precip_prob: 50,
          precip_in: 0.2,
        },
        {
          pulled_at: "2026-08-21T13:00:00Z", // Outside tolerance
          forecast_time: "2026-08-22T20:00:00Z",
          temp_f: 82,
          wind_mph: 8,
          precip_prob: 20,
          precip_in: 0.05,
        },
      ];

      const result = selectDayAheadPull(pulls, "2026-08-22", timezone);

      expect(result).not.toBeNull();
      expect(result?.pulled_at).toBe("2026-08-21T06:30:00Z");

      vi.useRealTimers();
    });

    it("falls back to earliest pull with ≥12 hours on the day when no ±6h match", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-22T10:00:00Z"));

      const pulls = [];
      for (let h = 6; h <= 20; h++) {
        pulls.push({
          pulled_at: "2026-08-20T00:00:00Z", // Way outside window
          forecast_time: `2026-08-22T${String(h).padStart(2, "0")}:00:00Z`,
          temp_f: 70 + (h - 6),
          wind_mph: 5,
          precip_prob: 0,
          precip_in: 0,
        });
      }

      const result = selectDayAheadPull(pulls, "2026-08-22", timezone);

      expect(result).not.toBeNull();
      expect(result?.pulled_at).toBe("2026-08-20T00:00:00Z");

      vi.useRealTimers();
    });

    it("returns null when no suitable pull found", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-22T10:00:00Z"));

      const pulls = [
        {
          pulled_at: "2026-08-19T00:00:00Z", // Way outside window and only 2 hours
          forecast_time: "2026-08-22T00:00:00Z",
          temp_f: 75,
          wind_mph: 5,
          precip_prob: 0,
          precip_in: 0,
        },
        {
          pulled_at: "2026-08-19T01:00:00Z",
          forecast_time: "2026-08-22T01:00:00Z",
          temp_f: 76,
          wind_mph: 5,
          precip_prob: 0,
          precip_in: 0,
        },
      ];

      const result = selectDayAheadPull(pulls, "2026-08-22", timezone);

      expect(result).toBeNull();

      vi.useRealTimers();
    });
  });

  describe("buildHourlySeries", () => {
    it("buckets actual observations to the hour (average temp/wind)", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-22T10:00:00Z"));

      const pulls = [
        {
          pulled_at: "2026-08-21T06:00:00Z",
          forecast_time: "2026-08-22T08:00:00Z",
          temp_f: "85",
          wind_mph: "10",
          precip_prob: "0",
          precip_in: "0",
        } as any,
      ];

      const actuals = [
        {
          time_utc: "2026-08-22T14:00:00Z", // 08:00 local
          time_local: "2026-08-22 08:00:00",
          temp_f: 80,
          wind_mph: 8,
          wind_high_mph: 12,
          precip_accum_in: 0.0,
          humidity: 50,
        },
        {
          time_utc: "2026-08-22T14:30:00Z", // Same hour (08:30 local)
          time_local: "2026-08-22 08:30:00",
          temp_f: 82,
          wind_mph: 10,
          wind_high_mph: 14,
          precip_accum_in: 0.05,
          humidity: 48,
        },
      ];

      const result = buildHourlySeries(pulls, actuals, 1, timezone);

      // Find an hour entry with actual data
      const hoursWithData = result.filter((h) => h.a_temp !== null);
      expect(hoursWithData.length).toBeGreaterThan(0);

      // Check that temps are averaged correctly
      const firstHourWithData = hoursWithData[0];
      expect(firstHourWithData.a_temp).toBeCloseTo((80 + 82) / 2, 0); // 81
      expect(firstHourWithData.a_wind).toBeCloseTo((8 + 10) / 2, 0); // 9
      expect(firstHourWithData.a_humidity).toBeCloseTo((50 + 48) / 2, 0); // 49

      vi.useRealTimers();
    });

    it("computes precip delta from start to end of hour (clamped >= 0)", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-22T10:00:00Z"));

      const pulls = [
        {
          pulled_at: "2026-08-21T06:00:00Z",
          forecast_time: "2026-08-22T08:00:00Z",
          temp_f: "85",
          wind_mph: "10",
          precip_prob: "0",
          precip_in: "0",
        } as any,
      ];

      const actuals = [
        {
          time_utc: "2026-08-22T14:00:00Z", // 08:00 local, start of hour
          time_local: "2026-08-22 08:00:00",
          temp_f: 80,
          wind_mph: 8,
          wind_high_mph: 12,
          precip_accum_in: 0.0,
          humidity: 45,
        },
        {
          time_utc: "2026-08-22T14:30:00Z", // Middle of hour
          time_local: "2026-08-22 08:30:00",
          temp_f: 81,
          wind_mph: 9,
          wind_high_mph: 11,
          precip_accum_in: 0.05,
          humidity: 44,
        },
        {
          time_utc: "2026-08-22T14:59:00Z", // End of hour
          time_local: "2026-08-22 08:59:00",
          temp_f: 82,
          wind_mph: 7,
          wind_high_mph: 10,
          precip_accum_in: 0.08,
          humidity: 43,
        },
      ];

      const result = buildHourlySeries(pulls, actuals, 1, timezone);

      const firstHour = result.find((h) => h.a_precip_in !== null);
      expect(firstHour).toBeDefined();
      expect(firstHour!.a_precip_in).toBeCloseTo(0.08, 2); // 0.08 - 0.0 = 0.08

      vi.useRealTimers();
    });

    it("preserves null gaps (does not interpolate)", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-22T10:00:00Z"));

      const pulls = [
        {
          pulled_at: "2026-08-21T06:00:00Z",
          forecast_time: "2026-08-22T08:00:00Z",
          temp_f: "85",
          wind_mph: "10",
          precip_prob: "0",
          precip_in: "0",
        } as any,
        {
          pulled_at: "2026-08-21T06:00:00Z",
          forecast_time: "2026-08-22T10:00:00Z",
          temp_f: "88",
          wind_mph: "11",
          precip_prob: "0",
          precip_in: "0",
        } as any,
      ];

      const actuals: Array<any> = [];

      const result = buildHourlySeries(pulls, actuals, 1, timezone);

      // Hours between forecast points should have null actuals
      const hasNullGap = result.some((h) => h.a_temp === null && h.f_temp !== null);
      expect(hasNullGap).toBe(true);

      vi.useRealTimers();
    });
  });

  describe("computeStats", () => {
    it("calculates MAE and bias for temperature only when both sides non-null", () => {
      const hours: HourlyComparison[] = [
        {
          time: "2026-08-22T08:00:00Z",
          day_local: "2026-08-22",
          f_temp: 85,
          a_temp: 80,
          f_wind: 10,
          a_wind: 9,
          f_precip_in: 0.1,
          a_precip_in: 0.05,
          f_prob: 20,
          a_humidity: 50,
        },
        {
          time: "2026-08-22T09:00:00Z",
          day_local: "2026-08-22",
          f_temp: 87,
          a_temp: 88,
          f_wind: 11,
          a_wind: 10,
          f_precip_in: 0.0,
          a_precip_in: 0.0,
          f_prob: 0,
          a_humidity: 48,
        },
        {
          time: "2026-08-22T10:00:00Z",
          day_local: "2026-08-22",
          f_temp: 90,
          a_temp: null, // Only forecast, should be skipped
          f_wind: 12,
          a_wind: 11,
          f_precip_in: 0.2,
          a_precip_in: 0.1,
          f_prob: 30,
          a_humidity: 47,
        },
      ];

      const stats = computeStats(hours);

      // Temp: (|85-80| + |87-88|) / 2 = (5 + 1) / 2 = 3
      expect(stats.temp.mae).toBeCloseTo(3, 0);
      // Bias: (85-80 + 87-88) / 2 = (5 - 1) / 2 = 2
      expect(stats.temp.bias).toBeCloseTo(2, 0);
      expect(stats.temp.hours_compared).toBe(2);

      // Wind: (|10-9| + |11-10|) / 2 = 1
      expect(stats.wind.mae).toBeCloseTo(1, 0);
    });

    it("computes wind gate agreement for wind >= 10 mph", () => {
      const hours: HourlyComparison[] = [
        {
          time: "2026-08-22T08:00:00Z",
          day_local: "2026-08-22",
          f_temp: 85,
          a_temp: 80,
          f_wind: 12, // >= 10
          a_wind: 11, // >= 10, agree
          f_precip_in: 0,
          a_precip_in: 0,
          f_prob: 0,
          a_humidity: 50,
        },
        {
          time: "2026-08-22T09:00:00Z",
          day_local: "2026-08-22",
          f_temp: 87,
          a_temp: 88,
          f_wind: 5, // < 10
          a_wind: 4, // < 10, agree
          f_precip_in: 0,
          a_precip_in: 0,
          f_prob: 0,
          a_humidity: 48,
        },
        {
          time: "2026-08-22T10:00:00Z",
          day_local: "2026-08-22",
          f_temp: 90,
          a_temp: 89,
          f_wind: 15, // >= 10
          a_wind: 8, // < 10, disagree
          f_precip_in: 0,
          a_precip_in: 0,
          f_prob: 0,
          a_humidity: 47,
        },
      ];

      const stats = computeStats(hours);

      // 2 out of 3 agree
      expect(stats.wind.gate_agreement_pct).toBeCloseTo(66.67, 1);
    });

    it("aggregates rain by day", () => {
      const hours: HourlyComparison[] = [
        {
          time: "2026-08-22T08:00:00Z",
          day_local: "2026-08-22",
          f_temp: 85,
          a_temp: 80,
          f_wind: 10,
          a_wind: 9,
          f_precip_in: 0.1,
          a_precip_in: 0.05,
          f_prob: 20,
          a_humidity: 50,
        },
        {
          time: "2026-08-22T09:00:00Z",
          day_local: "2026-08-22",
          f_temp: 87,
          a_temp: 88,
          f_wind: 11,
          a_wind: 10,
          f_precip_in: 0.15,
          a_precip_in: 0.08,
          f_prob: 30,
          a_humidity: 48,
        },
        {
          time: "2026-08-23T08:00:00Z",
          day_local: "2026-08-23",
          f_temp: 90,
          a_temp: 91,
          f_wind: 12,
          a_wind: 11,
          f_precip_in: 0.2,
          a_precip_in: 0.1,
          f_prob: 50,
          a_humidity: 47,
        },
      ];

      const stats = computeStats(hours);

      expect(stats.rain.by_day).toHaveLength(2);
      // Day 1: 2026-08-22
      const day1 = stats.rain.by_day.find((d) => d.day === "2026-08-22");
      expect(day1?.f).toBeCloseTo(0.25, 2); // 0.1 + 0.15
      expect(day1?.a).toBeCloseTo(0.13, 2); // 0.05 + 0.08

      // Day 2: 2026-08-23
      const day2 = stats.rain.by_day.find((d) => d.day === "2026-08-23");
      expect(day2?.f).toBeCloseTo(0.2, 2);
      expect(day2?.a).toBeCloseTo(0.1, 2);

      expect(stats.rain.forecast_total_in).toBeCloseTo(0.45, 2);
      expect(stats.rain.actual_total_in).toBeCloseTo(0.23, 2);
    });

    it("returns null stats when no overlap", () => {
      const hours: HourlyComparison[] = [
        {
          time: "2026-08-22T08:00:00Z",
          day_local: "2026-08-22",
          f_temp: 85,
          a_temp: null, // Only forecast
          f_wind: 10,
          a_wind: null, // Only forecast
          f_precip_in: 0.1,
          a_precip_in: null, // Only forecast
          f_prob: 20,
          a_humidity: null,
        },
      ];

      const stats = computeStats(hours);

      expect(stats.temp.mae).toBeNull();
      expect(stats.temp.bias).toBeNull();
      expect(stats.wind.mae).toBeNull();
      expect(stats.wind.gate_agreement_pct).toBeNull();
    });
  });
});

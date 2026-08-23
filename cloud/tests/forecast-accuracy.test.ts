import { describe, it, expect, beforeEach, vi } from "vitest";
import { aggregateAccuracy } from "@/lib/forecast-accuracy";

describe("aggregateAccuracy (pure function)", () => {
  const timezone = "America/Denver"; // UTC-6

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("pull selection", () => {
    it("picks the pull closest to 24h before D 00:00 within ±6h tolerance", () => {
      // Target date: 2026-08-22
      // Target pull time: 2026-08-21 00:00 (1 day before, local midnight)
      // In UTC-6, 2026-08-21 00:00 local = 2026-08-21 06:00 UTC

      // Set now to some time on 2026-08-22
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-22T10:00:00Z"));

      const pulls = [
        {
          pulled_at: "2026-08-20T22:00:00Z", // 4h before target
          forecast_time: "2026-08-22T08:00:00Z",
          lead_hours: 30,
          temp_f: 85,
          wind_mph: 10,
          precip_prob: 0,
          precip_in: 0,
        },
        {
          pulled_at: "2026-08-21T06:30:00Z", // 30min after target (CLOSEST within ±6h)
          forecast_time: "2026-08-22T14:00:00Z",
          lead_hours: 32,
          temp_f: 88,
          wind_mph: 12,
          precip_prob: 50,
          precip_in: 0.2,
        },
        {
          pulled_at: "2026-08-21T13:00:00Z", // 6.5h after target (outside tolerance)
          forecast_time: "2026-08-22T20:00:00Z",
          lead_hours: 31,
          temp_f: 82,
          wind_mph: 8,
          precip_prob: 20,
          precip_in: 0.05,
        },
      ];

      const result = aggregateAccuracy(pulls, [], 1, timezone);
      const day = result.days[0];

      // Should use the 06:30 UTC pull (closest to 06:00 UTC within ±6h)
      expect(day.predicted_high_f).toBe(88);
      expect(day.predicted_rain_in).toBe(0.2);

      vi.useRealTimers();
    });

    it("falls back to earliest pull with ≥12 forecast hours on the day when no ±6h match", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-22T10:00:00Z"));

      // Build 15 forecast hours for 2026-08-22 IN DENVER LOCAL TIME:
      // UTC hours 06..20 all land on 2026-08-22 in America/Denver (UTC-6).
      const hoursOn22Aug = [];
      for (let h = 6; h <= 20; h++) {
        hoursOn22Aug.push({
          pulled_at: "2026-08-20T00:00:00Z", // Far outside ±6h window
          forecast_time: `2026-08-22T${String(h).padStart(2, "0")}:00:00Z`,
          lead_hours: 48 + h,
          temp_f: 70 + (h - 6),
          wind_mph: 5,
          precip_prob: 0,
          precip_in: 0,
        });
      }

      const result = aggregateAccuracy(hoursOn22Aug, [], 1, timezone);
      const day = result.days[0];

      // Should use the earliest pull with ≥12 hours on this day
      expect(day.predicted_high_f).toBe(84); // max of 70..84
      expect(day.predicted_rain_in).toBe(0);

      vi.useRealTimers();
    });

    it("leaves all predicted_* null when no suitable pull found", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-22T10:00:00Z"));

      const pulls = [
        {
          pulled_at: "2026-08-19T00:00:00Z", // Way outside window and only 2 hours on day
          forecast_time: "2026-08-22T00:00:00Z",
          lead_hours: 48,
          temp_f: 75,
          wind_mph: 5,
          precip_prob: 0,
          precip_in: 0,
        },
        {
          pulled_at: "2026-08-19T01:00:00Z",
          forecast_time: "2026-08-22T01:00:00Z",
          lead_hours: 48,
          temp_f: 76,
          wind_mph: 5,
          precip_prob: 0,
          precip_in: 0,
        },
      ];

      const result = aggregateAccuracy(pulls, [], 1, timezone);
      const day = result.days[0];

      expect(day.predicted_rain_in).toBeNull();
      expect(day.predicted_high_f).toBeNull();
      expect(day.predicted_wind_max).toBeNull();
      expect(day.predicted_prob_max).toBeNull();

      vi.useRealTimers();
    });
  });

  describe("per-day aggregation", () => {
    it("sums precip_in for all hours in a day", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-22T10:00:00Z"));

      const pulls = [
        {
          pulled_at: "2026-08-21T06:00:00Z",
          forecast_time: "2026-08-22T08:00:00Z",
          lead_hours: 26,
          temp_f: 75,
          wind_mph: 5,
          precip_prob: 10,
          precip_in: 0.05,
        },
        {
          pulled_at: "2026-08-21T06:00:00Z",
          forecast_time: "2026-08-22T12:00:00Z",
          lead_hours: 30,
          temp_f: 80,
          wind_mph: 6,
          precip_prob: 30,
          precip_in: 0.15,
        },
        {
          pulled_at: "2026-08-21T06:00:00Z",
          forecast_time: "2026-08-22T18:00:00Z",
          lead_hours: 36,
          temp_f: 78,
          wind_mph: 4,
          precip_prob: 20,
          precip_in: 0.10,
        },
        // Different date should not be included
        {
          pulled_at: "2026-08-21T06:00:00Z",
          forecast_time: "2026-08-23T08:00:00Z",
          lead_hours: 26,
          temp_f: 85,
          wind_mph: 8,
          precip_prob: 50,
          precip_in: 0.5,
        },
      ];

      const result = aggregateAccuracy(pulls, [], 1, timezone);
      const day = result.days[0];

      expect(day.predicted_rain_in).toBeCloseTo(0.3, 5); // 0.05 + 0.15 + 0.10
      expect(day.predicted_prob_max).toBe(30);
      expect(day.predicted_high_f).toBe(80);
      expect(day.predicted_wind_max).toBe(6);

      vi.useRealTimers();
    });

    it("coerces string Athena rows to numbers correctly", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-22T10:00:00Z"));

      const pulls = [
        {
          pulled_at: "2026-08-21T06:00:00Z",
          forecast_time: "2026-08-22T08:00:00Z",
          lead_hours: "26" as unknown, // String from Athena
          temp_f: "75" as unknown,
          wind_mph: "5" as unknown,
          precip_prob: "30" as unknown,
          precip_in: "0.15" as unknown,
        },
      ];

      const result = aggregateAccuracy(pulls, [], 1, timezone);
      const day = result.days[0];

      expect(day.predicted_rain_in).toBe(0.15);
      expect(day.predicted_high_f).toBe(75);
      expect(day.predicted_prob_max).toBe(30);

      vi.useRealTimers();
    });
  });

  describe("actuals joining", () => {
    it("joins WU actuals by date", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-22T10:00:00Z"));

      const pulls = [
        {
          pulled_at: "2026-08-21T06:00:00Z",
          forecast_time: "2026-08-22T12:00:00Z",
          lead_hours: 30,
          temp_f: 85,
          wind_mph: 10,
          precip_prob: 50,
          precip_in: 0.1,
        },
      ];

      const wuDays = [
        {
          date_local: "2026-08-22",
          precip_total_in: 0.25,
          temp_high_f: 88,
          wind_high_mph: 12,
        },
      ];

      const result = aggregateAccuracy(pulls, wuDays, 1, timezone);
      const day = result.days[0];

      expect(day.actual_rain_in).toBe(0.25);
      expect(day.actual_high_f).toBe(88);
      expect(day.actual_wind_max).toBe(12);

      vi.useRealTimers();
    });

    it("handles null temperature and wind fields from WU", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-22T10:00:00Z"));

      const pulls = [
        {
          pulled_at: "2026-08-21T06:00:00Z",
          forecast_time: "2026-08-22T12:00:00Z",
          lead_hours: 30,
          temp_f: 85,
          wind_mph: 10,
          precip_prob: 50,
          precip_in: 0.1,
        },
      ];

      const wuDays = [
        {
          date_local: "2026-08-22",
          precip_total_in: 0.5,
          temp_high_f: null,
          wind_high_mph: null,
        },
      ];

      const result = aggregateAccuracy(pulls, wuDays, 1, timezone);
      const day = result.days[0];

      expect(day.actual_rain_in).toBe(0.5);
      expect(day.actual_high_f).toBeNull();
      expect(day.actual_wind_max).toBeNull();

      vi.useRealTimers();
    });

    it("leaves actuals null when no WU data", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-22T10:00:00Z"));

      const pulls = [
        {
          pulled_at: "2026-08-21T06:00:00Z",
          forecast_time: "2026-08-22T12:00:00Z",
          lead_hours: 30,
          temp_f: 85,
          wind_mph: 10,
          precip_prob: 50,
          precip_in: 0.1,
        },
      ];

      const result = aggregateAccuracy(pulls, [], 1, timezone);
      const day = result.days[0];

      expect(day.actual_rain_in).toBeNull();
      expect(day.actual_high_f).toBeNull();
      expect(day.actual_wind_max).toBeNull();

      vi.useRealTimers();
    });
  });

  describe("rain accuracy scoring", () => {
    it("counts hits (both predicted and fell, or both didn't)", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-22T10:00:00Z"));

      const pulls = [
        // Day 1 (2026-08-21): pull at its exact -24h target (2026-08-20 06:00Z);
        // predicted rain (0.2"), actual rain (0.25") → hit
        {
          pulled_at: "2026-08-20T06:00:00Z",
          forecast_time: "2026-08-21T12:00:00Z",
          lead_hours: 30,
          temp_f: 75,
          wind_mph: 5,
          precip_prob: 80,
          precip_in: 0.2,
        },
        // Day 2 (2026-08-22): its own pull at the -24h target (2026-08-21 06:00Z);
        // predicted no rain (0.02"), actual no rain (0.05") → hit
        {
          pulled_at: "2026-08-21T06:00:00Z",
          forecast_time: "2026-08-22T12:00:00Z",
          lead_hours: 30,
          temp_f: 80,
          wind_mph: 5,
          precip_prob: 5,
          precip_in: 0.02,
        },
      ];

      const wuDays = [
        { date_local: "2026-08-21", precip_total_in: 0.25, temp_high_f: 85, wind_high_mph: 10 },
        {
          date_local: "2026-08-22",
          precip_total_in: 0.05,
          temp_high_f: 88,
          wind_high_mph: 12,
        },
      ];

      const result = aggregateAccuracy(pulls, wuDays, 2, timezone);

      expect(result.hits?.rain_called_right).toBe(2);
      expect(result.hits?.misses).toBe(0);
      expect(result.hits?.false_alarms).toBe(0);
      expect(result.hits?.comparable_days).toBe(2);

      vi.useRealTimers();
    });

    it("counts misses (fell but not predicted)", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-22T10:00:00Z"));

      const pulls = [
        {
          // days=1 covers only local 2026-08-22; pull sits at its -24h target
          pulled_at: "2026-08-21T06:00:00Z",
          forecast_time: "2026-08-22T12:00:00Z",
          lead_hours: 30,
          temp_f: 75,
          wind_mph: 5,
          precip_prob: 10,
          precip_in: 0.02, // Predicted no rain
        },
      ];

      const wuDays = [
        {
          date_local: "2026-08-22",
          precip_total_in: 0.3,
          temp_high_f: 85,
          wind_high_mph: 10,
        }, // Actually rained
      ];

      const result = aggregateAccuracy(pulls, wuDays, 1, timezone);

      expect(result.hits?.misses).toBe(1);
      expect(result.hits?.rain_called_right).toBe(0);

      vi.useRealTimers();
    });

    it("counts false alarms (predicted but didn't fall)", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-22T10:00:00Z"));

      const pulls = [
        {
          // days=1 covers only local 2026-08-22; pull sits at its -24h target
          pulled_at: "2026-08-21T06:00:00Z",
          forecast_time: "2026-08-22T12:00:00Z",
          lead_hours: 30,
          temp_f: 75,
          wind_mph: 5,
          precip_prob: 80,
          precip_in: 0.3, // Predicted rain
        },
      ];

      const wuDays = [
        {
          date_local: "2026-08-22",
          precip_total_in: 0.05,
          temp_high_f: 85,
          wind_high_mph: 10,
        }, // No real rain
      ];

      const result = aggregateAccuracy(pulls, wuDays, 1, timezone);

      expect(result.hits?.false_alarms).toBe(1);
      expect(result.hits?.rain_called_right).toBe(0);

      vi.useRealTimers();
    });

    it("uses 0.1\" threshold for rain", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-22T10:00:00Z"));

      const pulls = [
        {
          // days=1 covers only local 2026-08-22; pull sits at its -24h target
          pulled_at: "2026-08-21T06:00:00Z",
          forecast_time: "2026-08-22T12:00:00Z",
          lead_hours: 30,
          temp_f: 75,
          wind_mph: 5,
          precip_prob: 50,
          precip_in: 0.095, // Just under threshold
        },
      ];

      const wuDays = [
        {
          date_local: "2026-08-22",
          precip_total_in: 0.15,
          temp_high_f: 85,
          wind_high_mph: 10,
        },
      ];

      const result = aggregateAccuracy(pulls, wuDays, 1, timezone);

      // Predicted 0.095 (no rain by 0.1" threshold), actual 0.15 (rain) → miss
      expect(result.hits?.misses).toBe(1);

      vi.useRealTimers();
    });

    it("omits stats when no comparable days", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-22T10:00:00Z"));

      const pulls = [
        {
          pulled_at: "2026-08-20T06:00:00Z",
          forecast_time: "2026-08-21T12:00:00Z",
          lead_hours: 30,
          temp_f: 75,
          wind_mph: 5,
          precip_prob: 50,
          precip_in: 0.1,
        },
      ];

      // No WU data
      const result = aggregateAccuracy(pulls, [], 1, timezone);

      expect(result.hits).toBeUndefined();

      vi.useRealTimers();
    });
  });

  describe("all-null case", () => {
    it("returns all nulls when snapshots just started", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-22T10:00:00Z"));

      const result = aggregateAccuracy([], [], 3, timezone);

      for (const day of result.days) {
        expect(day.predicted_rain_in).toBeNull();
        expect(day.predicted_high_f).toBeNull();
        expect(day.predicted_wind_max).toBeNull();
        expect(day.predicted_prob_max).toBeNull();
        expect(day.actual_rain_in).toBeNull();
      }

      vi.useRealTimers();
    });
  });
});

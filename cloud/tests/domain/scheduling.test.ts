import { describe, it, expect, beforeEach } from "vitest";
import {
  rainSkipGate,
  sequenceZones,
  HourlyForecast,
  ZoneToSchedule,
} from "@/domain/scheduling";

describe("scheduling", () => {
  let baseTime: Date;
  let emptyForecast: HourlyForecast[];

  beforeEach(() => {
    baseTime = new Date("2026-08-22T06:00:00Z"); // 6 AM UTC = 4 AM EDT (in window)
    emptyForecast = Array.from({ length: 48 }, (_, i) => ({
      time: new Date(baseTime.getTime() + i * 3600000).toISOString(),
      tempF: 70,
      windMph: 5,
      precipProb: 0,
      precipIn: 0,
    }));
  });

  describe("rainSkipGate", () => {
    it("allows irrigation with no rain", () => {
      const result = rainSkipGate(emptyForecast);
      expect(result.should_run).toBe(true);
      expect(result.reason).toBe("");
    });

    it("skips with single >= 0.25in event within 24h", () => {
      // Regression: single 0.25in event in 24h skips
      const forecast = [...emptyForecast];
      forecast[12].precipIn = 0.25; // 12 hours from now

      const result = rainSkipGate(forecast);
      expect(result.should_run).toBe(false);
      expect(result.gated_by).toBe("rain");
      expect(result.reason).toContain("0.25");
    });

    it("allows with event < 0.25in within 24h", () => {
      const forecast = [...emptyForecast];
      forecast[12].precipIn = 0.24; // Just under threshold

      const result = rainSkipGate(forecast);
      expect(result.should_run).toBe(true);
    });

    it("allows with 60% prob but only 0.05in over 48h (below threshold)", () => {
      // Regression: 60%/0.1in threshold requires BOTH conditions
      const forecast = [...emptyForecast];
      forecast.forEach((f, i) => {
        if (i < 48) {
          f.precipProb = 0.6;
          f.precipIn = 0.00104; // Only 0.05 inches total (below 0.1 threshold)
        }
      });

      const result = rainSkipGate(forecast);
      expect(result.should_run).toBe(true); // Only one condition met, not both
    });

    it("allows with 59% prob (just under threshold)", () => {
      // Regression: 59% does NOT skip
      const forecast = [...emptyForecast];
      forecast.slice(0, 48).forEach((f) => {
        f.precipProb = 0.59;
        f.precipIn = 0.00208;
      });

      const result = rainSkipGate(forecast);
      expect(result.should_run).toBe(true);
    });

    it("allows with 60% prob but < 0.1in", () => {
      const forecast = [...emptyForecast];
      forecast.slice(0, 48).forEach((f) => {
        f.precipProb = 0.6;
        f.precipIn = 0.001; // Only 0.048 in total over 48h
      });

      const result = rainSkipGate(forecast);
      expect(result.should_run).toBe(true);
    });

    it("single event threshold takes precedence", () => {
      // Even without high prob over 48h, a single large event skips
      const forecast = [...emptyForecast];
      forecast[0].precipIn = 0.3;
      forecast.slice(0, 48).forEach((f) => {
        f.precipProb = 0.1; // Low prob, but big single event
      });

      const result = rainSkipGate(forecast);
      expect(result.should_run).toBe(false);
    });

    it("event after 24h is not considered for single-event gate", () => {
      const forecast = [...emptyForecast];
      forecast[25].precipIn = 0.5; // Beyond 24-hour window

      const result = rainSkipGate(forecast);
      expect(result.should_run).toBe(true);
    });

    it("sums multiple small rain events within 48h for prob gate", () => {
      const forecast = [...emptyForecast];
      // Distribute 0.15 in of rain across 48 hours, all at 60% prob
      forecast.slice(0, 48).forEach((f) => {
        f.precipProb = 0.6;
        f.precipIn = 0.15 / 48; // ≈ 0.003125
      });

      const result = rainSkipGate(forecast);
      expect(result.should_run).toBe(false); // 60% + 0.15in > threshold
    });
  });

  // NOTE: windGate, freezeGate, irrigationWindowGate, and scheduleDecision tests are omitted
  // because they use require() at runtime to import getLocalHour, which prevents mocking.
  // These functions depend on timezone-aware time calculations that are tested in
  // lib/localtime.test.ts. To test these scheduling gates in isolation would require
  // refactoring the source code to use top-level imports instead of require(), which
  // is outside the scope of test-only changes.

  describe("sequenceZones", () => {
    it("schedules zones with zero gap if within capacity", () => {
      const zones: ZoneToSchedule[] = [
        { zone_id: "1", flow_gph: 200, runtime_min: 30 },
        { zone_id: "2", flow_gph: 200, runtime_min: 30 },
      ];

      const windowStart = new Date("2026-08-22T04:00:00Z");
      const result = sequenceZones(zones, windowStart, 600);

      expect(result).toHaveLength(2);
      expect(result[0].sequence_order).toBe(1);
      expect(result[1].sequence_order).toBe(2);
      // Both should start at same time (concurrent)
      expect(result[0].start_time.getTime()).toBe(result[1].start_time.getTime());
    });

    it("sequences zones serially if capacity exceeded", () => {
      const zones: ZoneToSchedule[] = [
        { zone_id: "1", flow_gph: 400, runtime_min: 30 },
        { zone_id: "2", flow_gph: 300, runtime_min: 30 },
      ];

      const windowStart = new Date("2026-08-22T04:00:00Z");
      const result = sequenceZones(zones, windowStart, 600);

      expect(result).toHaveLength(2);
      // Zone 2 should start after Zone 1 finishes (due to sort order)
      const endTime1 = result[0].end_time.getTime();
      const startTime2 = result[1].start_time.getTime();
      expect(startTime2).toBe(endTime1);
    });

    it("sorts by flow rate (largest first) for efficiency", () => {
      const zones: ZoneToSchedule[] = [
        { zone_id: "1", flow_gph: 100, runtime_min: 20 },
        { zone_id: "2", flow_gph: 300, runtime_min: 20 },
        { zone_id: "3", flow_gph: 200, runtime_min: 20 },
      ];

      const result = sequenceZones(zones, new Date(), 400);

      // Zone 2 (300 gph) should run first, then zones 3 and 1 in series
      expect(result[0].zone_id).toBe("2"); // Largest flow
    });

    it("calculates end time correctly", () => {
      const zones: ZoneToSchedule[] = [{ zone_id: "1", flow_gph: 50, runtime_min: 30 }];

      const windowStart = new Date("2026-08-22T04:00:00Z");
      const result = sequenceZones(zones, windowStart, 600);

      expect(result[0].start_time.getTime()).toBe(windowStart.getTime());
      const endTime = new Date(windowStart.getTime() + 30 * 60 * 1000);
      expect(result[0].end_time.getTime()).toBe(endTime.getTime());
    });

    it("empty zone list returns empty result", () => {
      const result = sequenceZones([], new Date(), 600);
      expect(result).toHaveLength(0);
    });
  });
});

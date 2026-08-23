import { describe, it, expect } from "vitest";
import { buildForecastSnapshotLines } from "@/lib/s3-logs";

describe("buildForecastSnapshotLines", () => {
  const pulledAt = new Date("2026-08-22T08:00:00Z");
  const forecast = [
    { time: "2026-08-22T09:00:00Z", tempF: 88, windMph: 4, precipProb: 0.1, precipIn: 0 },
    { time: "2026-08-24T08:00:00Z", tempF: 91, windMph: 12, precipProb: 0.7, precipIn: 0.35 },
  ];

  it("emits one line per forecast hour with lead_hours from pull time", () => {
    const lines = buildForecastSnapshotLines(forecast, pulledAt);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      pulled_at: "2026-08-22T08:00:00.000Z",
      forecast_time: "2026-08-22T09:00:00Z",
      lead_hours: 1,
      temp_f: 88,
      precip_prob: 0.1,
      source: "tomorrow.io",
    });
    expect(lines[1].lead_hours).toBe(48);
    expect(lines[1].precip_in).toBe(0.35);
  });

  it("returns empty for an empty forecast", () => {
    expect(buildForecastSnapshotLines([], pulledAt)).toEqual([]);
  });
});

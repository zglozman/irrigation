import { describe, it, expect } from "vitest";
import { buildStationDayLines } from "@/lib/s3-logs";

describe("buildStationDayLines", () => {
  const base = { temp_f: 80, wind_mph: 3, wind_high_mph: 6, humidity: 60 };

  it("derives hourly precip from the running daily accumulation", () => {
    const lines = buildStationDayLines("KTEST1", [
      { time_utc: "t1", time_local: "l1", ...base, precip_accum_in: 0 },
      { time_utc: "t2", time_local: "l2", ...base, precip_accum_in: 0.2 },
      { time_utc: "t3", time_local: "l3", ...base, precip_accum_in: 0.5 },
      { time_utc: "t4", time_local: "l4", ...base, precip_accum_in: 0.5 },
    ]);
    expect(lines.map((l) => l.precip_hourly_in)).toEqual([0, 0.2, 0.3, 0]);
    expect(lines[0].station_id).toBe("KTEST1");
  });

  it("clamps at 0 if the accumulator resets mid-day", () => {
    const lines = buildStationDayLines("KTEST1", [
      { time_utc: "t1", time_local: "l1", ...base, precip_accum_in: 0.4 },
      { time_utc: "t2", time_local: "l2", ...base, precip_accum_in: 0.1 },
    ]);
    expect(lines[1].precip_hourly_in).toBe(0);
  });

  it("passes nulls through and returns empty for no rows", () => {
    const lines = buildStationDayLines("KTEST1", [
      { time_utc: "t1", time_local: "l1", temp_f: null, wind_mph: null, wind_high_mph: null, humidity: null, precip_accum_in: 0 },
    ]);
    expect(lines[0].temp_f).toBeNull();
    expect(buildStationDayLines("KTEST1", [])).toEqual([]);
  });
});

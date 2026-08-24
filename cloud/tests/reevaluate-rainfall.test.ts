import { describe, it, expect, beforeEach, vi } from "vitest";
import { reevaluateAllZones } from "@/jobs/reevaluate-schedule";
import * as dynamo from "@/lib/dynamo";
import * as weather from "@/weather";
import * as s3logs from "@/lib/s3-logs";

vi.mock("@/lib/dynamo");
vi.mock("@/weather");
vi.mock("@/lib/s3-logs");
vi.mock("@/lib/iot-mqtt");

const userSub = "test-user";
const zone = {
  zone_id: "z1",
  relay_channel: 3,
  name: "tomato bed",
  area_sqft: 100,
  location: "",
};
const plantConfig = {
  zone_id: "z1",
  zone_type: "vegetable",
  irrigation_method: "drip",
  emitter_count: 10,
  emitter_gph: 2,
};
const freshBudget = () => ({
  zone_id: "z1",
  weekly_target_gal: 60,
  delivered_gal_this_week: 5,
  rainfall_gal_this_week: 0,
  week_start_date: new Date().toISOString().split("T")[0], // this week — no rollover
  last_updated: new Date().toISOString(),
});

const calmForecast = Array.from({ length: 48 }, (_, i) => ({
  time: new Date(Date.now() + i * 3600_000).toISOString(),
  tempF: 85,
  windMph: 3,
  precipProb: 0,
  precipIn: 0,
}));

function arm(rainfall: number | Error) {
  vi.mocked(dynamo.getZones).mockResolvedValue([zone] as any);
  vi.mocked(dynamo.getPlantConfig).mockResolvedValue(plantConfig as any);
  vi.mocked(dynamo.getBudget).mockResolvedValue(freshBudget() as any);
  vi.mocked(dynamo.getSchedule).mockResolvedValue(null);
  vi.mocked(dynamo.putBudget).mockResolvedValue(undefined);
  vi.mocked(dynamo.putScheduleIfNotActive).mockResolvedValue(true);
  vi.mocked(s3logs.writeForecastSnapshot).mockResolvedValue(undefined);
  vi.mocked(s3logs.writeIrrigationLog).mockResolvedValue(undefined);
  vi.mocked(weather.getForecastProvider).mockReturnValue({
    getForecast: async () => calmForecast,
  } as any);
  vi.mocked(weather.getRainfallProvider).mockResolvedValue({
    getRainfallSince: async () => {
      if (rainfall instanceof Error) throw rainfall;
      return rainfall;
    },
  } as any);
}

describe("scheduler persists measured rainfall (regression)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes measured rain into the budget record the UI reads", async () => {
    arm(0.5); // 0.5 in on 100 sqft = 31.15 gal
    await reevaluateAllZones(userSub);

    expect(dynamo.putBudget).toHaveBeenCalledWith(
      userSub,
      expect.objectContaining({
        zone_id: "z1",
        rainfall_gal_this_week: expect.closeTo(31.15, 1),
        delivered_gal_this_week: 5,
        weekly_target_gal: 60,
      })
    );
  });

  it("never clobbers stored rainfall with 0 when the fetch fails", async () => {
    arm(new Error("WU down"));
    await reevaluateAllZones(userSub);
    expect(dynamo.putBudget).not.toHaveBeenCalled();
  });

  it("skips the write when rainfall is unchanged", async () => {
    arm(0); // measured 0, stored 0 → no-op
    await reevaluateAllZones(userSub);
    expect(dynamo.putBudget).not.toHaveBeenCalled();
  });
});

// Chat tool definitions and executors
import {
  getZones,
  getZone,
  getPlantConfig,
  getBudget,
  getSchedule,
} from "@/lib/dynamo";
import { getForecastProvider, getRainfallProvider } from "@/weather";
import { config } from "@/lib/config";
import { runQuery } from "@/lib/athena";
import { commandRelay } from "@/lib/iot-mqtt";
import { writeIrrigationLog } from "@/lib/s3-logs";
import { IrrigationLogBuilder } from "@/domain/irrigation-log";
import { reevaluateAllZones } from "@/jobs/reevaluate-schedule";
import { rolloverBudgetIfNeeded } from "@/domain/budget-rollover";
import { calculateFlowGph } from "@/domain/runtime-converter";
import { putScheduleIfNotActive, putBudget, transitionScheduleStatus } from "@/lib/dynamo";
import { getWeekStart } from "@/lib/localtime";

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const TOOLS: ToolDefinition[] = [
  {
    name: "list_zones",
    description:
      "List all irrigation zones with their plant config, weekly budget target, delivered/rained amount, and current schedule status",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_zone_details",
    description: "Get detailed information about a specific zone including plant config and current schedule",
    input_schema: {
      type: "object",
      properties: {
        zone_id: {
          type: "string",
          description: "The zone ID",
        },
      },
      required: ["zone_id"],
    },
  },
  {
    name: "get_forecast",
    description: "Get the next 72 hours of weather forecast including temperature, wind, and precipitation probability",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_rainfall_this_week",
    description: "Get the total rainfall measured this week in inches",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_history",
    description: "Get irrigation history from Athena logs. Zone is optional (1-16), days defaults to 7, max 90",
    input_schema: {
      type: "object",
      properties: {
        zone: {
          type: "number",
          description: "Optional zone ID (1-16 for relay channel)",
        },
        days: {
          type: "number",
          description: "Number of days to look back (default 7, max 90)",
        },
      },
    },
  },
  {
    name: "run_zone",
    description: "Manually start a zone watering run for a specified number of minutes (1-55)",
    input_schema: {
      type: "object",
      properties: {
        zone_id: {
          type: "string",
          description: "The zone ID",
        },
        minutes: {
          type: "number",
          description: "Duration in minutes (1-55)",
        },
      },
      required: ["zone_id", "minutes"],
    },
  },
  {
    name: "stop_zone",
    description: "Immediately stop a watering run for a zone",
    input_schema: {
      type: "object",
      properties: {
        zone_id: {
          type: "string",
          description: "The zone ID",
        },
      },
      required: ["zone_id"],
    },
  },
  {
    name: "reevaluate_now",
    description: "Trigger an immediate re-evaluation of all zones against the current forecast",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
];

/**
 * Execute a tool for a user and return a JSON string result
 */
export async function executeTool(
  userSub: string,
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<string> {
  try {
    switch (toolName) {
      case "list_zones":
        return await toolListZones(userSub);
      case "get_zone_details":
        return await toolGetZoneDetails(userSub, toolInput.zone_id as string);
      case "get_forecast":
        return await toolGetForecast();
      case "get_rainfall_this_week":
        return await toolGetRainfallThisWeek();
      case "get_history":
        return await toolGetHistory(toolInput.zone as number | undefined, toolInput.days as number | undefined);
      case "run_zone":
        return await toolRunZone(userSub, toolInput.zone_id as string, toolInput.minutes as number);
      case "stop_zone":
        return await toolStopZone(userSub, toolInput.zone_id as string);
      case "reevaluate_now":
        return await toolReevaluateNow(userSub);
      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (error) {
    console.error(`[Chat Tool] Error in ${toolName}:`, error);
    return JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

async function toolListZones(userSub: string): Promise<string> {
  const zones = await getZones(userSub);
  const result = [];

  for (const zone of zones) {
    const plantConfig = await getPlantConfig(userSub, zone.zone_id);
    const budget = await getBudget(userSub, zone.zone_id);
    const schedule = await getSchedule(userSub, zone.zone_id);

    result.push({
      zone_id: zone.zone_id,
      name: zone.name,
      relay_channel: zone.relay_channel,
      area_sqft: zone.area_sqft,
      location: zone.location,
      plant_type: plantConfig?.zone_type || "unknown",
      weekly_target_gal: budget?.weekly_target_gal ?? 0,
      delivered_gal_this_week: budget?.delivered_gal_this_week ?? 0,
      rainfall_gal_this_week: budget?.rainfall_gal_this_week ?? 0,
      remaining_gal: Math.max(
        0,
        (budget?.weekly_target_gal ?? 0) - (budget?.delivered_gal_this_week ?? 0) - (budget?.rainfall_gal_this_week ?? 0)
      ),
      schedule_status: schedule?.status || "no-schedule",
      next_run: schedule?.scheduled_start ? new Date(schedule.scheduled_start).toLocaleString() : "not scheduled",
    });
  }

  return JSON.stringify(result);
}

async function toolGetZoneDetails(userSub: string, zoneId: string): Promise<string> {
  const zone = await getZone(userSub, zoneId);
  if (!zone) {
    return JSON.stringify({ error: "Zone not found" });
  }

  const plantConfig = await getPlantConfig(userSub, zoneId);
  const budget = await getBudget(userSub, zoneId);
  const schedule = await getSchedule(userSub, zoneId);

  return JSON.stringify({
    zone,
    plant_config: plantConfig,
    budget,
    schedule,
  });
}

async function toolGetForecast(): Promise<string> {
  try {
    const forecastProvider = getForecastProvider();
    const forecast = await forecastProvider.getForecast(config.location.latitude, config.location.longitude);

    // Summarize next 72h
    const next72h = forecast.slice(0, 72).map((h) => ({
      time: new Date(h.time).toLocaleString(),
      tempF: h.tempF,
      windMph: h.windMph,
      precipProb: Math.round(h.precipProb * 100),
      precipIn: h.precipIn,
    }));

    return JSON.stringify({
      next_72_hours: next72h,
      summary: {
        max_temp: Math.max(...forecast.slice(0, 24).map((h) => h.tempF)),
        min_temp: Math.min(...forecast.slice(0, 24).map((h) => h.tempF)),
        max_wind_mph: Math.max(...forecast.slice(0, 24).map((h) => h.windMph)),
        rain_probability_percent: Math.round(Math.max(...forecast.slice(0, 24).map((h) => h.precipProb)) * 100),
        total_rain_expected_in: forecast.slice(0, 24).reduce((sum, h) => sum + h.precipIn, 0),
      },
    });
  } catch (error) {
    return JSON.stringify({ error: "Failed to fetch forecast" });
  }
}

async function toolGetRainfallThisWeek(): Promise<string> {
  try {
    const rainfallProvider = getRainfallProvider();
    const weekStart = getWeekStart(new Date());
    const rainfall = await rainfallProvider.getRainfallSince(
      weekStart.toISOString(),
      config.location.latitude,
      config.location.longitude
    );

    return JSON.stringify({
      rainfall_in: rainfall,
      note: "gallons equivalent is per-zone: zone area (sq ft) × inches × 0.623",
      week_start: weekStart.toISOString(),
    });
  } catch (error) {
    return JSON.stringify({ error: "Failed to fetch rainfall data" });
  }
}

async function toolGetHistory(zone?: number, days?: number): Promise<string> {
  const daysParam = Math.min(Math.max(Math.floor(Number(days) || 7), 1), 90);
  const now = new Date();

  const dayTuples: string[] = [];
  for (let i = 0; i <= daysParam; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    dayTuples.push(`(year='${y}' AND month='${m}' AND day='${dd}')`);
  }
  const partitionPredicate = `(${dayTuples.join(" OR ")})`;

  let sql = `SELECT * FROM ${config.aws.athenaTable} WHERE ${partitionPredicate}`;

  if (zone !== undefined && zone >= 1 && zone <= 16) {
    const zoneStr = String(zone).padStart(2, "0");
    sql += ` AND zone='${zoneStr}'`;
  }

  sql += ` ORDER BY timestamp DESC LIMIT 50`;

  const results = await runQuery(sql);
  return JSON.stringify(results);
}

async function toolRunZone(userSub: string, zoneId: string, minutes: unknown): Promise<string> {
  // Validate BEFORE any side effect — the model could emit a non-numeric value,
  // and a valve must never open without a complete, valid schedule record.
  if (typeof zoneId !== "string" || !zoneId) {
    return JSON.stringify({ error: "zone_id must be a non-empty string" });
  }
  if (typeof minutes !== "number" || !Number.isFinite(minutes)) {
    return JSON.stringify({ error: "minutes must be a finite number between 1 and 55" });
  }
  const capped_minutes = Math.min(Math.max(minutes, 1), 55);

  const zone = await getZone(userSub, zoneId);
  if (!zone) {
    return JSON.stringify({ error: "Zone not found" });
  }

  const now = new Date();
  const endTime = new Date(now.getTime() + capped_minutes * 60 * 1000);

  // Write the schedule record FIRST (conditionally — never clobber a live run),
  // then command the relay: a zone that's already ACTIVE must not be re-opened.
  const written = await putScheduleIfNotActive(userSub, {
    zone_id: zoneId,
    relay_channel: zone.relay_channel,
    scheduled_start: now.toISOString(),
    scheduled_runtime_min: capped_minutes,
    scheduled_end: endTime.toISOString(),
    trigger_reason: "manual",
    status: "ACTIVE",
    actual_start: now.toISOString(),
  });
  if (!written) {
    return JSON.stringify({ error: "Zone is already running — stop it first or wait for it to finish" });
  }

  await commandRelay(zone.relay_channel, true);

  // Write log entry
  await writeIrrigationLog(
    new IrrigationLogBuilder()
      .zoneId(zoneId)
      .relayChannel(zone.relay_channel)
      .timestamp(now)
      .triggerType("MANUAL")
      .scheduledRuntimeMin(capped_minutes)
      .gallonsDelivered(0)
      .weeklyTargetGal(0)
      .remainingBefore(0)
      .remainingAfter(0)
      .rainfallMeasuredIn(0)
      .rainfallGalEquiv(0)
      .weatherSnapshot({})
      .outcome("RAN")
      .reason(`Manual run: ${capped_minutes} minutes`)
      .build()
  );

  return JSON.stringify({
    success: true,
    message: `Zone ${zone.name} started for ${capped_minutes} minutes`,
  });
}

async function toolStopZone(userSub: string, zoneId: string): Promise<string> {
  const schedule = await getSchedule(userSub, zoneId);
  const zone = await getZone(userSub, zoneId);
  if (!zone) {
    return JSON.stringify({ error: "Zone not found" });
  }

  const relayChannel = schedule?.relay_channel ?? zone.relay_channel;
  await commandRelay(relayChannel, false);

  if (schedule && (schedule.status === "PENDING" || schedule.status === "ACTIVE")) {
    const now = new Date();
    const wasActive = schedule.status === "ACTIVE";

    const claimed = await transitionScheduleStatus(
      userSub,
      zoneId,
      schedule.status,
      "COMPLETED",
      { actual_end: now.toISOString(), outcome: "RAN", failure_reason: "" }
    );

    if (claimed && wasActive) {
      const elapsedMin = schedule.actual_start
        ? Math.max(0, Math.min((now.getTime() - new Date(schedule.actual_start).getTime()) / 60000, schedule.scheduled_runtime_min))
        : 0;

      let flowGph = 1;
      const plantConfig = await getPlantConfig(userSub, zoneId);
      if (plantConfig) {
        const flowSpecs: Record<string, number> = {};
        for (const key of ["emitter_count", "emitter_gph", "head_count", "head_gpm", "soaker_length_ft", "soaker_gph_per_ft"] as const) {
          const v = (plantConfig as unknown as Record<string, unknown>)[key];
          if (typeof v === "number") flowSpecs[key] = v;
        }
        try {
          flowGph = calculateFlowGph(plantConfig.irrigation_method as Parameters<typeof calculateFlowGph>[0], flowSpecs).gph;
        } catch {
          // fall back to 1 gph
        }
      }
      const gallonsDelivered = (elapsedMin * flowGph) / 60;

      const budget = await getBudget(userSub, zoneId);
      if (budget) {
        const rolled = rolloverBudgetIfNeeded(budget, now);
        await putBudget(userSub, {
          zone_id: zoneId,
          weekly_target_gal: budget.weekly_target_gal,
          delivered_gal_this_week: rolled.deliveredGal + gallonsDelivered,
          rainfall_gal_this_week: rolled.rainfallGal,
          week_start_date: rolled.weekStart,
          last_updated: now.toISOString(),
        });
      }

      await writeIrrigationLog(
        new IrrigationLogBuilder()
          .zoneId(zoneId)
          .relayChannel(relayChannel)
          .timestamp(now)
          .triggerType("MANUAL")
          .scheduledRuntimeMin(schedule.scheduled_runtime_min)
          .actualRuntimeMin(elapsedMin)
          .gallonsDelivered(gallonsDelivered)
          .weeklyTargetGal(budget?.weekly_target_gal ?? 0)
          .remainingBefore(0)
          .remainingAfter(0)
          .rainfallMeasuredIn(0)
          .rainfallGalEquiv(0)
          .weatherSnapshot({})
          .outcome("RAN")
          .reason(`Manually stopped after ${elapsedMin.toFixed(1)} min; ${gallonsDelivered.toFixed(2)} gal delivered`)
          .build()
      );
    }
  }

  return JSON.stringify({
    success: true,
    message: `Zone ${zone.name} stopped`,
  });
}

async function toolReevaluateNow(userSub: string): Promise<string> {
  try {
    await reevaluateAllZones(userSub);
    const zones = await getZones(userSub);
    const summaries = [];

    for (const zone of zones) {
      const schedule = await getSchedule(userSub, zone.zone_id);
      summaries.push({
        zone_id: zone.zone_id,
        name: zone.name,
        status: schedule?.status || "no-schedule",
        next_run: schedule?.scheduled_start ? new Date(schedule.scheduled_start).toLocaleString() : "not scheduled",
      });
    }

    return JSON.stringify({
      success: true,
      message: "Zones re-evaluated against current forecast",
      zone_summaries: summaries,
    });
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : "Failed to reevaluate zones",
    });
  }
}

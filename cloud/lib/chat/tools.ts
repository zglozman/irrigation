// Chat tool definitions and executors
import {
  getZones,
  getZone,
  getPlantConfig,
  getBudget,
  getSchedule,
  putZone,
  putPlantConfig,
  deleteZone,
  getSchedules,
} from "@/lib/dynamo";
import { getForecastProvider, getRainfallProvider } from "@/weather";
import { config } from "@/lib/config";
import { runQuery } from "@/lib/athena";
import { commandRelay, getBoardStatus, getRetainedJson, getAllRelayStates, publishRaw } from "@/lib/iot-mqtt";
import { writeIrrigationLog } from "@/lib/s3-logs";
import { IrrigationLogBuilder } from "@/domain/irrigation-log";
import { reevaluateAllZones } from "@/jobs/reevaluate-schedule";
import { rolloverBudgetIfNeeded } from "@/domain/budget-rollover";
import { calculateFlowGph } from "@/domain/runtime-converter";
import { putScheduleIfNotActive, putBudget, transitionScheduleStatus } from "@/lib/dynamo";
import { getWeekStart } from "@/lib/localtime";
import { galPerWeekAreaBased, galPerWeekPerPlant } from "@/domain/water-need-calculator";
import { v4 as uuidv4 } from "uuid";
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";

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
  {
    name: "create_zone",
    description:
      "Create a new irrigation zone with plant config and weekly water budget. Validates relay channel uniqueness. Computes weekly target from plant type and area, or from custom values.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Zone name (required)" },
        relay_channel: {
          type: "integer",
          description: "Relay channel 1-16 (required, must be unique)",
        },
        area_sqft: {
          type: "number",
          description: "Area in square feet (required, must be > 0)",
        },
        zone_type: {
          type: "string",
          enum: [
            "cool-season-turf",
            "warm-season-turf",
            "vegetable",
            "shrub",
            "xeric",
            "trees",
          ],
          description: "Plant type (required)",
        },
        irrigation_method: {
          type: "string",
          enum: ["drip", "spray", "soaker"],
          description: "Irrigation method (required)",
        },
        location: { type: "string", description: "Location name (optional)" },
        emitter_count: { type: "number", description: "For drip systems (optional)" },
        emitter_gph: { type: "number", description: "Gallons per hour per emitter (optional)" },
        head_count: { type: "number", description: "For spray systems (optional)" },
        head_gpm: { type: "number", description: "Gallons per minute per head (optional)" },
        soaker_length_ft: { type: "number", description: "For soaker systems (optional)" },
        soaker_gph_per_ft: {
          type: "number",
          description: "Gallons per hour per foot of soaker (optional)",
        },
        plant_quantity: { type: "number", description: "Number of plants (optional)" },
        gal_per_week_per_plant: {
          type: "number",
          description: "Water per plant per week (optional)",
        },
        weekly_target_gal: {
          type: "number",
          description: "Override computed weekly target (optional)",
        },
      },
      required: ["name", "relay_channel", "area_sqft", "zone_type", "irrigation_method"],
    },
  },
  {
    name: "update_zone",
    description: "Update an existing zone. All fields are optional; only provided fields are updated.",
    input_schema: {
      type: "object",
      properties: {
        zone_id: { type: "string", description: "Zone ID (required)" },
        name: { type: "string" },
        relay_channel: { type: "integer" },
        area_sqft: { type: "number" },
        zone_type: { type: "string" },
        irrigation_method: { type: "string" },
        location: { type: "string" },
        emitter_count: { type: "number" },
        emitter_gph: { type: "number" },
        head_count: { type: "number" },
        head_gpm: { type: "number" },
        soaker_length_ft: { type: "number" },
        soaker_gph_per_ft: { type: "number" },
        plant_quantity: { type: "number" },
        gal_per_week_per_plant: { type: "number" },
        weekly_target_gal: { type: "number" },
      },
      required: ["zone_id"],
    },
  },
  {
    name: "delete_zone",
    description:
      "Delete a zone and all its data. Refuses to delete if zone has an ACTIVE watering run.",
    input_schema: {
      type: "object",
      properties: {
        zone_id: { type: "string", description: "Zone ID (required)" },
      },
      required: ["zone_id"],
    },
  },
  {
    name: "get_device_status",
    description: "Get the controller board status (online/offline), IP, and WiFi info",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_relay_states",
    description: "Get the current on/off state of all 16 relay channels",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "set_relay",
    description:
      "Direct relay control for testing valves and pumps — for watering, prefer run_zone which records history and budgets.",
    input_schema: {
      type: "object",
      properties: {
        channel: {
          type: "integer",
          description: "Relay channel 1-16 (required)",
        },
        on: { type: "boolean", description: "true to turn on, false to turn off (required)" },
      },
      required: ["channel", "on"],
    },
  },
  {
    name: "wifi_scan",
    description:
      "Scan for available WiFi networks near the controller. Returns a list of SSIDs, signal strength, and security.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "configure_wifi",
    description:
      "Set the backup WiFi credentials on the controller. The board tests the credentials and reports failures on the device page.",
    input_schema: {
      type: "object",
      properties: {
        ssid: { type: "string", description: "WiFi network name (required)" },
        password: { type: "string", description: "WiFi password (required)" },
      },
      required: ["ssid", "password"],
    },
  },
  {
    name: "get_activity",
    description:
      "Get current and recent watering activity: what's running now and what ran recently",
    input_schema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum recent entries to return (default 20)",
        },
      },
    },
  },
  {
    name: "set_weekly_target",
    description: "Set a custom weekly water target (in gallons) for a zone",
    input_schema: {
      type: "object",
      properties: {
        zone_id: { type: "string", description: "Zone ID (required)" },
        gallons: {
          type: "number",
          description: "Weekly target in gallons (required, >= 0)",
        },
      },
      required: ["zone_id", "gallons"],
    },
  },
  {
    name: "all_off",
    description:
      "Stop all running zones immediately and sweep all relay channels off as a safety measure",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "invite_user",
    description:
      "Invite a new user by email — always confirm with the user before calling. They will receive an invite email with temporary credentials.",
    input_schema: {
      type: "object",
      properties: {
        email: { type: "string", description: "Email address (required)" },
      },
      required: ["email"],
    },
  },
  {
    name: "get_rain_source",
    description: "Get the current rainfall measurement source (Weather Underground, Tempest, or Tomorrow.io estimates)",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "set_rain_station",
    description:
      "Configure a Weather Underground personal weather station as the real rainfall source — always confirm with the user before calling. Pass empty strings to remove configuration and fall back to estimates.",
    input_schema: {
      type: "object",
      properties: {
        station_id: {
          type: "string",
          description: "Weather Underground station ID (e.g., KABCD1234), or empty string to remove",
        },
        api_key: {
          type: "string",
          description:
            "Weather Underground API key (optional — leave empty to use the public web key scraped from the station's dashboard page)",
        },
      },
      required: ["station_id"],
    },
  },
  {
    name: "get_forecast_accuracy",
    description: "Get forecast vs. actual comparison (what the forecast predicted vs. what actually happened)",
    input_schema: {
      type: "object",
      properties: {
        days: {
          type: "number",
          description: "Number of days to look back (default 7, max 14)",
        },
      },
    },
  },
  {
    name: "get_weather_comparison",
    description: "Get hourly forecast vs. actual weather comparison (temperature, wind, rain) at 1-hour resolution",
    input_schema: {
      type: "object",
      properties: {
        days: {
          type: "number",
          description: "Number of days to look back (default 3, max 7)",
        },
      },
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
      case "create_zone":
        return await toolCreateZone(userSub, toolInput as Record<string, unknown>);
      case "update_zone":
        return await toolUpdateZone(userSub, toolInput as Record<string, unknown>);
      case "delete_zone":
        return await toolDeleteZone(userSub, toolInput.zone_id as string);
      case "get_device_status":
        return await toolGetDeviceStatus();
      case "get_relay_states":
        return await toolGetRelayStates();
      case "set_relay":
        return await toolSetRelay(toolInput.channel as number, toolInput.on as boolean);
      case "wifi_scan":
        return await toolWifiScan();
      case "configure_wifi":
        return await toolConfigureWifi(toolInput.ssid as string, toolInput.password as string);
      case "get_activity":
        return await toolGetActivity(userSub, toolInput.limit as number | undefined);
      case "set_weekly_target":
        return await toolSetWeeklyTarget(userSub, toolInput.zone_id as string, toolInput.gallons as number);
      case "all_off":
        return await toolAllOff(userSub);
      case "invite_user":
        return await toolInviteUser(toolInput.email as string);
      case "get_rain_source":
        return await toolGetRainSource();
      case "set_rain_station":
        return await toolSetRainStation(
          toolInput.station_id as string,
          toolInput.api_key as string
        );
      case "get_forecast_accuracy":
        return await toolGetForecastAccuracy(toolInput.days as number | undefined);
      case "get_weather_comparison":
        return await toolGetWeatherComparison(toolInput.days as number | undefined);
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
    const rainfallProvider = await getRainfallProvider();
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

async function toolCreateZone(userSub: string, input: Record<string, unknown>): Promise<string> {
  const { name, relay_channel, area_sqft, zone_type, irrigation_method, location, emitter_count, emitter_gph, head_count, head_gpm, soaker_length_ft, soaker_gph_per_ft, plant_quantity, gal_per_week_per_plant, weekly_target_gal } = input;

  // Validate required fields
  if (!name || typeof name !== "string") {
    return JSON.stringify({ error: "name is required and must be a string" });
  }
  if (typeof relay_channel !== "number" || !Number.isInteger(relay_channel) || relay_channel < 1 || relay_channel > 16) {
    return JSON.stringify({ error: "relay_channel is required and must be an integer between 1 and 16" });
  }
  if (typeof area_sqft !== "number" || area_sqft <= 0) {
    return JSON.stringify({ error: "area_sqft is required and must be greater than 0" });
  }
  if (!zone_type || typeof zone_type !== "string") {
    return JSON.stringify({ error: "zone_type is required" });
  }
  const validZoneTypes = ["cool-season-turf", "warm-season-turf", "vegetable", "shrub", "xeric", "trees"];
  if (!validZoneTypes.includes(zone_type)) {
    return JSON.stringify({ error: `zone_type must be one of: ${validZoneTypes.join(", ")}` });
  }
  if (!irrigation_method || typeof irrigation_method !== "string") {
    return JSON.stringify({ error: "irrigation_method is required" });
  }
  const validMethods = ["drip", "spray", "soaker"];
  if (!validMethods.includes(irrigation_method)) {
    return JSON.stringify({ error: `irrigation_method must be one of: ${validMethods.join(", ")}` });
  }

  // Check for relay channel conflict BEFORE any write
  const existingZones = await getZones(userSub);
  const conflictZone = existingZones.find((z) => z.relay_channel === relay_channel);
  if (conflictZone) {
    return JSON.stringify({
      error: `Relay channel ${relay_channel} is already in use by zone "${conflictZone.name}"`,
    });
  }

  // Compute weekly target
  let computedTarget: { gal_per_week: number; source: string };
  let targetSource = "computed";

  if (typeof weekly_target_gal === "number" && weekly_target_gal >= 0) {
    computedTarget = { gal_per_week: weekly_target_gal, source: "custom" };
    targetSource = "custom";
  } else if (typeof plant_quantity === "number" || zone_type === "trees") {
    const qty = typeof plant_quantity === "number" ? plant_quantity : 1;
    const perPlant = typeof gal_per_week_per_plant === "number" ? gal_per_week_per_plant : undefined;
    computedTarget = galPerWeekPerPlant(zone_type as any, qty, perPlant);
    targetSource = "per-plant";
  } else {
    computedTarget = galPerWeekAreaBased(zone_type as any, area_sqft);
    targetSource = "area-based";
  }

  const zoneId = uuidv4().slice(0, 8);
  const now = new Date();
  const weekStart = getWeekStart(now);

  const zone = {
    zone_id: zoneId,
    relay_channel,
    name,
    area_sqft,
    location: location ? String(location) : "",
  };

  const plantConfig = {
    zone_id: zoneId,
    zone_type: String(zone_type),
    irrigation_method: String(irrigation_method),
    emitter_count: typeof emitter_count === "number" ? emitter_count : undefined,
    emitter_gph: typeof emitter_gph === "number" ? emitter_gph : undefined,
    head_count: typeof head_count === "number" ? head_count : undefined,
    head_gpm: typeof head_gpm === "number" ? head_gpm : undefined,
    soaker_length_ft: typeof soaker_length_ft === "number" ? soaker_length_ft : undefined,
    soaker_gph_per_ft: typeof soaker_gph_per_ft === "number" ? soaker_gph_per_ft : undefined,
    plant_quantity: typeof plant_quantity === "number" ? plant_quantity : undefined,
    gal_per_week_per_plant: typeof gal_per_week_per_plant === "number" ? gal_per_week_per_plant : undefined,
    total_gal_per_week: computedTarget.gal_per_week,
    gal_week_source: computedTarget.source,
  };

  const budget = {
    zone_id: zoneId,
    weekly_target_gal: computedTarget.gal_per_week,
    delivered_gal_this_week: 0,
    rainfall_gal_this_week: 0,
    week_start_date: weekStart.toISOString().split("T")[0],
    last_updated: now.toISOString(),
  };

  await Promise.all([
    putZone(userSub, zone),
    putPlantConfig(userSub, plantConfig),
    putBudget(userSub, budget),
  ]);

  return JSON.stringify({
    success: true,
    zone_id: zoneId,
    name,
    relay_channel,
    area_sqft,
    zone_type,
    irrigation_method,
    weekly_target_gal: computedTarget.gal_per_week,
    weekly_target_source: targetSource,
    message: `Zone "${name}" created with ${computedTarget.gal_per_week} gal/week target (${targetSource})`,
  });
}

async function toolUpdateZone(userSub: string, input: Record<string, unknown>): Promise<string> {
  const { zone_id, name, relay_channel, area_sqft, zone_type, irrigation_method, location, emitter_count, emitter_gph, head_count, head_gpm, soaker_length_ft, soaker_gph_per_ft, plant_quantity, gal_per_week_per_plant, weekly_target_gal } = input;

  if (!zone_id || typeof zone_id !== "string") {
    return JSON.stringify({ error: "zone_id is required" });
  }

  // Get existing zone
  const existingZone = await getZone(userSub, zone_id);
  if (!existingZone) {
    return JSON.stringify({ error: "Zone not found" });
  }

  // Check for relay channel conflict if changing relay_channel
  if (typeof relay_channel === "number" && relay_channel !== existingZone.relay_channel) {
    const existingZones = await getZones(userSub);
    const conflictZone = existingZones.find((z) => z.relay_channel === relay_channel && z.zone_id !== zone_id);
    if (conflictZone) {
      return JSON.stringify({
        error: `Relay channel ${relay_channel} is already in use by zone "${conflictZone.name}"`,
      });
    }
  }

  // Build updated zone
  const updatedZone = {
    zone_id,
    relay_channel: typeof relay_channel === "number" ? relay_channel : existingZone.relay_channel,
    name: typeof name === "string" ? name : existingZone.name,
    area_sqft: typeof area_sqft === "number" ? area_sqft : existingZone.area_sqft,
    location: typeof location === "string" ? location : (existingZone.location || ""),
  };

  // Update zone
  await putZone(userSub, updatedZone);

  // Update plant config if any relevant fields are provided
  const existingPlantConfig = await getPlantConfig(userSub, zone_id);
  if (existingPlantConfig || zone_type || irrigation_method || emitter_count !== undefined || emitter_gph !== undefined || head_count !== undefined || head_gpm !== undefined || soaker_length_ft !== undefined || soaker_gph_per_ft !== undefined || plant_quantity !== undefined || gal_per_week_per_plant !== undefined) {
    const updatedPlantConfig = {
      zone_id,
      zone_type: typeof zone_type === "string" ? zone_type : (existingPlantConfig?.zone_type || ""),
      irrigation_method: typeof irrigation_method === "string" ? irrigation_method : (existingPlantConfig?.irrigation_method || ""),
      emitter_count: typeof emitter_count === "number" ? emitter_count : existingPlantConfig?.emitter_count,
      emitter_gph: typeof emitter_gph === "number" ? emitter_gph : existingPlantConfig?.emitter_gph,
      head_count: typeof head_count === "number" ? head_count : existingPlantConfig?.head_count,
      head_gpm: typeof head_gpm === "number" ? head_gpm : existingPlantConfig?.head_gpm,
      soaker_length_ft: typeof soaker_length_ft === "number" ? soaker_length_ft : existingPlantConfig?.soaker_length_ft,
      soaker_gph_per_ft: typeof soaker_gph_per_ft === "number" ? soaker_gph_per_ft : existingPlantConfig?.soaker_gph_per_ft,
      plant_quantity: typeof plant_quantity === "number" ? plant_quantity : existingPlantConfig?.plant_quantity,
      gal_per_week_per_plant: typeof gal_per_week_per_plant === "number" ? gal_per_week_per_plant : existingPlantConfig?.gal_per_week_per_plant,
      total_gal_per_week: existingPlantConfig?.total_gal_per_week ?? 0,
      gal_week_source: existingPlantConfig?.gal_week_source ?? "custom",
    };

    await putPlantConfig(userSub, updatedPlantConfig);
  }

  // Update budget if weekly_target_gal is provided
  if (typeof weekly_target_gal === "number") {
    const existingBudget = await getBudget(userSub, zone_id);
    const now = new Date();
    const rolled = existingBudget ? rolloverBudgetIfNeeded(existingBudget, now) : { deliveredGal: 0, rainfallGal: 0, weekStart: getWeekStart(now).toISOString().split("T")[0] };

    await putBudget(userSub, {
      zone_id,
      weekly_target_gal,
      delivered_gal_this_week: rolled.deliveredGal,
      rainfall_gal_this_week: rolled.rainfallGal,
      week_start_date: rolled.weekStart,
      last_updated: now.toISOString(),
    });
  }

  const updatedPlantConfig = await getPlantConfig(userSub, zone_id);
  const updatedBudget = await getBudget(userSub, zone_id);

  return JSON.stringify({
    success: true,
    message: `Zone "${updatedZone.name}" updated`,
    zone: updatedZone,
    plantConfig: updatedPlantConfig,
    budget: updatedBudget,
  });
}

async function toolDeleteZone(userSub: string, zoneId: string): Promise<string> {
  if (!zoneId || typeof zoneId !== "string") {
    return JSON.stringify({ error: "zone_id is required" });
  }

  // Check if zone exists
  const zone = await getZone(userSub, zoneId);
  if (!zone) {
    return JSON.stringify({ error: "Zone not found" });
  }

  // Check if zone has ACTIVE schedule
  const schedule = await getSchedule(userSub, zoneId);
  if (schedule && schedule.status === "ACTIVE") {
    return JSON.stringify({
      error: "Cannot delete zone with ACTIVE watering run — stop the zone first",
    });
  }

  // Delete zone and all related items
  await deleteZone(userSub, zoneId);

  return JSON.stringify({
    success: true,
    message: `Zone "${zone.name}" deleted`,
  });
}

async function toolGetDeviceStatus(): Promise<string> {
  try {
    const board = await getBoardStatus();
    const wifi = await getRetainedJson("irrigation-controller/wifi/status");
    const firmware = await getRetainedJson("irrigation-controller/update/firmware_update/state");

    return JSON.stringify({
      board,
      wifi,
      firmware,
    });
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : "Failed to get device status",
    });
  }
}

async function toolGetRelayStates(): Promise<string> {
  try {
    const states = await getAllRelayStates();
    return JSON.stringify({
      states,
      note: "Channels map to zone relay assignments. Use set_relay for direct control.",
    });
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : "Failed to get relay states",
    });
  }
}

async function toolSetRelay(channel: unknown, on: unknown): Promise<string> {
  if (typeof channel !== "number" || !Number.isInteger(channel) || channel < 1 || channel > 16) {
    return JSON.stringify({
      error: "Channel must be an integer between 1 and 16",
    });
  }

  if (typeof on !== "boolean") {
    return JSON.stringify({
      error: "on must be a boolean (true or false)",
    });
  }

  try {
    await commandRelay(channel, on);
    return JSON.stringify({
      success: true,
      message: `Relay ${channel} turned ${on ? "ON" : "OFF"}`,
    });
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : "Failed to control relay",
    });
  }
}

async function toolWifiScan(): Promise<string> {
  try {
    // Trigger scan
    await publishRaw("irrigation-controller/wifi/scan", "scan");

    // Poll for results (max 12 seconds, 2-second intervals)
    const maxAttempts = 6;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const networks = await getRetainedJson("irrigation-controller/wifi/networks");
      if (networks && Array.isArray(networks) && networks.length > 0) {
        return JSON.stringify({
          success: true,
          networks,
        });
      }
    }

    return JSON.stringify({
      error: "WiFi scan timed out — is the board online?",
    });
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : "WiFi scan failed",
    });
  }
}

async function toolConfigureWifi(ssid: unknown, password: unknown): Promise<string> {
  // Validate ssid
  if (typeof ssid !== "string" || ssid.length < 1 || ssid.length > 32) {
    return JSON.stringify({
      error: "SSID must be 1-32 characters",
    });
  }

  // Validate password
  if (typeof password !== "string" || password.length < 0 || password.length > 63) {
    return JSON.stringify({
      error: "Password must be 0-63 characters",
    });
  }

  try {
    const payload = JSON.stringify({ ssid, password });
    await publishRaw("irrigation-controller/wifi/set", payload);

    return JSON.stringify({
      success: true,
      message: `WiFi configured for SSID "${ssid}"`,
    });
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : "Failed to configure WiFi",
    });
  }
}

async function toolGetActivity(userSub: string, limit?: number): Promise<string> {
  try {
    const limitVal = limit ? Math.min(Math.max(Math.floor(limit), 1), 100) : 20;

    // Get all active schedules for this user
    const running: any[] = [];
    const schedules = await getSchedules(userSub);

    for (const sched of schedules) {
      if (sched.status === "ACTIVE" && sched.actual_start && sched.scheduled_end) {
        const now = new Date();
        const scheduledEnd = new Date(sched.scheduled_end);
        const remainingMin = Math.max(0, Math.round((scheduledEnd.getTime() - now.getTime()) / 60000));

        const zone = await getZone(userSub, sched.zone_id);
        running.push({
          zone_id: sched.zone_id,
          zone_name: zone?.name || null,
          relay_channel: sched.relay_channel,
          actual_start: sched.actual_start,
          scheduled_end: sched.scheduled_end,
          remaining_min: remainingMin,
        });
      }
    }

    // Get recent activity from logs (Athena)
    const now = new Date();
    const dayTuples: string[] = [];
    for (let i = 0; i <= 2; i++) {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - i);
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(d.getUTCDate()).padStart(2, "0");
      dayTuples.push(`(year='${y}' AND month='${m}' AND day='${dd}')`);
    }
    const partitionPredicate = `(${dayTuples.join(" OR ")})`;

    const sql = `SELECT timestamp, zone_id, zone, trigger_type, outcome, actual_runtime_min, gallons_estimated_delivered, reason FROM ${config.aws.athenaTable} WHERE ${partitionPredicate} ORDER BY timestamp DESC LIMIT ${limitVal}`;

    let recent: any[] = [];
    try {
      recent = await runQuery(sql);
    } catch {
      // Degrade gracefully if Athena is unavailable
    }

    return JSON.stringify({
      running,
      recent: recent.map((row: any) => ({
        timestamp: row.timestamp ?? "",
        zone_id: row.zone_id ?? "",
        relay_channel: row.zone != null ? parseInt(String(row.zone), 10) : 0,
        trigger_type: row.trigger_type ?? "",
        outcome: row.outcome ?? "",
        actual_runtime_min: row.actual_runtime_min != null ? Number(row.actual_runtime_min) : null,
        gallons_estimated_delivered: row.gallons_estimated_delivered != null ? Number(row.gallons_estimated_delivered) : 0,
        reason: row.reason ?? "",
      })),
    });
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : "Failed to get activity",
    });
  }
}

async function toolSetWeeklyTarget(userSub: string, zoneId: string, gallons: unknown): Promise<string> {
  if (!zoneId || typeof zoneId !== "string") {
    return JSON.stringify({ error: "zone_id is required" });
  }

  if (typeof gallons !== "number" || gallons < 0) {
    return JSON.stringify({ error: "gallons must be a non-negative number" });
  }

  const zone = await getZone(userSub, zoneId);
  if (!zone) {
    return JSON.stringify({ error: "Zone not found" });
  }

  const oldBudget = await getBudget(userSub, zoneId);
  const oldTarget = oldBudget?.weekly_target_gal ?? 0;

  const now = new Date();
  const rolled = oldBudget ? rolloverBudgetIfNeeded(oldBudget, now) : { deliveredGal: 0, rainfallGal: 0, weekStart: getWeekStart(now).toISOString().split("T")[0] };

  await putBudget(userSub, {
    zone_id: zoneId,
    weekly_target_gal: gallons,
    delivered_gal_this_week: rolled.deliveredGal,
    rainfall_gal_this_week: rolled.rainfallGal,
    week_start_date: rolled.weekStart,
    last_updated: now.toISOString(),
  });

  // Also update plant config
  const plantConfig = await getPlantConfig(userSub, zoneId);
  if (plantConfig) {
    await putPlantConfig(userSub, {
      ...plantConfig,
      total_gal_per_week: gallons,
      gal_week_source: "custom",
    });
  }

  return JSON.stringify({
    success: true,
    old_target_gal: oldTarget,
    new_target_gal: gallons,
    message: `Weekly target updated from ${oldTarget} gal to ${gallons} gal`,
  });
}

async function toolAllOff(userSub: string): Promise<string> {
  try {
    const stoppedZones: string[] = [];

    // Get all schedules for this user
    const schedules = await getSchedules(userSub);

    // Stop all PENDING and ACTIVE schedules through the full stop path —
    // it credits delivered gallons to the budget and writes the journal
    // entry; a bare status transition would lose both.
    for (const schedule of schedules) {
      if ((schedule.status === "PENDING" || schedule.status === "ACTIVE") && schedule.zone_id) {
        const zone = await getZone(userSub, schedule.zone_id);
        if (!zone) continue;
        const result = JSON.parse(await toolStopZone(userSub, schedule.zone_id));
        if (result.success) {
          stoppedZones.push(zone.name);
        }
      }
    }

    // Sweep all relays off as a belt-and-braces safety measure
    for (let ch = 1; ch <= 16; ch++) {
      await commandRelay(ch, false);
    }

    return JSON.stringify({
      success: true,
      stopped_zones: stoppedZones,
      relays_swept: 16,
      message: `All off: stopped ${stoppedZones.length} zone(s), swept 16 relays`,
    });
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : "Failed to stop all zones",
    });
  }
}

async function toolInviteUser(email: unknown): Promise<string> {
  if (!email || typeof email !== "string") {
    return JSON.stringify({ error: "email is required" });
  }

  try {
    const cognitoClient = new CognitoIdentityProviderClient({
      region: config.aws.region,
    });

    const result = await cognitoClient.send(
      new AdminCreateUserCommand({
        UserPoolId: config.cognito.userPoolId,
        Username: email,
        DesiredDeliveryMediums: ["EMAIL"],
      })
    );

    return JSON.stringify({
      success: true,
      message: `User invited: ${email}. They will receive an invite email shortly.`,
      userId: result.User?.Username,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("already exists")) {
      return JSON.stringify({
        error: "User with this email already exists",
      });
    }
    return JSON.stringify({
      error: error instanceof Error ? error.message : "Failed to invite user",
    });
  }
}

async function toolGetRainSource(): Promise<string> {
  try {
    const { getRainfallSource, resolveWUCredentials } = await import("@/weather");
    const { validateWUStation } = await import("@/weather/wunderground");
    const { getWeatherSettings } = await import("@/lib/dynamo");

    const source = await getRainfallSource();
    const settings = await getWeatherSettings();

    let validation = undefined;
    if (settings?.wu_station_id) {
      const creds = await resolveWUCredentials();
      if (creds) {
        validation = await validateWUStation(creds.stationId, creds.apiKey);
      }
    }

    return JSON.stringify({
      source,
      wu_station_id: settings?.wu_station_id || undefined,
      validation,
    });
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : "Failed to get rain source",
    });
  }
}

async function toolSetRainStation(
  stationId: unknown,
  apiKey: unknown
): Promise<string> {
  if (typeof stationId !== "string" || typeof apiKey !== "string") {
    return JSON.stringify({
      error: "station_id and api_key must be strings",
    });
  }

  try {
    const { setRainStation } = await import("@/lib/weather-settings");

    const result = await setRainStation(stationId, apiKey);

    return JSON.stringify(result);
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : "Failed to set rain station",
    });
  }
}

async function toolGetForecastAccuracy(days?: number): Promise<string> {
  try {
    const { getForecastAccuracy } = await import("@/lib/forecast-accuracy");

    const daysParam = Math.min(Math.max(Math.floor(Number(days) || 7), 1), 14);
    const result = await getForecastAccuracy(daysParam);

    return JSON.stringify(result);
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : "Failed to get forecast accuracy",
    });
  }
}

async function toolGetWeatherComparison(days?: number): Promise<string> {
  try {
    const { getWeatherComparison } = await import("@/lib/weather-compare");

    const daysParam = Math.min(Math.max(Math.floor(Number(days) || 3), 1), 7);
    const result = await getWeatherComparison(daysParam);

    // Remove today_fine as it's too large for chat
    const { today_fine, ...chatResult } = result;

    return JSON.stringify(chatResult);
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : "Failed to get weather comparison",
    });
  }
}

// Hourly scheduler job: reevaluates all zones and updates schedules
// Implements scheduling with proper timezone handling, sequencing, and constraints

import {
  getZones,
  getPlantConfig,
  getBudget,
  putBudget,
  putScheduleIfNotActive,
  getSchedule,
} from "@/lib/dynamo";
import { writeIrrigationLog } from "@/lib/s3-logs";
import { IrrigationLogBuilder } from "@/domain/irrigation-log";
import { scheduleDecision } from "@/domain/scheduling";
import { getForecastProvider, getRainfallProvider } from "@/weather";
import { calculateRainfallOffset } from "@/domain/rainfall-offset";
import { calculateFlowGph } from "@/domain/runtime-converter";
import { getLocalHour, getLocalTime, getNextWindowStart } from "@/lib/localtime";
import { config } from "@/lib/config";

import { rolloverBudgetIfNeeded } from "@/domain/budget-rollover";

/**
 * Main reevaluation job: runs hourly at XX:00 to evaluate all zones
 */
export async function reevaluateAllZones(userSub: string): Promise<void> {
  console.log(`[Scheduler] Reevaluating zones for user ${userSub}`);

  try {
    // Get all zones for this user
    const zones = await getZones(userSub);
    if (zones.length === 0) {
      console.log(`[Scheduler] No zones found for user ${userSub}`);
      return;
    }

    const forecastProvider = getForecastProvider();
    const rainfallProvider = getRainfallProvider();

    // Get forecast (shared for all zones)
    let forecast: any[] = [];
    try {
      forecast = await forecastProvider.getForecast(
        config.location.latitude,
        config.location.longitude
      );
    } catch (error) {
      console.error("[Scheduler] Forecast fetch failed, will skip all zones:", error);
      return; // Cannot proceed without forecast
    }

    if (!forecast || forecast.length === 0) {
      console.error("[Scheduler] No forecast data available, skipping evaluation");
      return;
    }

    // Evaluate each zone
    const zonesNeedingWater: ZoneToRun[] = [];

    for (const zone of zones) {
      const needsWater = await evaluateZone({
        userSub,
        zone,
        forecast,
        rainfallProvider,
      });

      if (needsWater) {
        zonesNeedingWater.push(needsWater);
      }
    }

    // Sequence zones and schedule them (accounts for kept ACTIVE/protected-PENDING)
    if (zonesNeedingWater.length > 0) {
      await sequenceAndScheduleZones(userSub, zonesNeedingWater);
    }

    console.log(`[Scheduler] Completed evaluation for user ${userSub}`);
  } catch (error) {
    console.error(`[Scheduler] Error evaluating zones for user ${userSub}:`, error);
  }
}

interface ZoneToRun {
  zone_id: string;
  relay_channel: number;
  area_sqft: number;
  name: string;
  flowGph: number;
  runtimeMin: number;
  weatherSnapshot: Record<string, any>;
  rainfallIn: number;
  rainfallGal: number;
  budget: any;
}

async function evaluateZone(params: {
  userSub: string;
  zone: any;
  forecast: any[];
  rainfallProvider: any;
}): Promise<ZoneToRun | null> {
  const { userSub, zone, forecast, rainfallProvider } = params;

  try {
    const plantConfig = await getPlantConfig(userSub, zone.zone_id);
    const budget = await getBudget(userSub, zone.zone_id);

    if (!plantConfig || !budget) {
      console.log(`[Scheduler] Skipping zone ${zone.zone_id}: missing config/budget`);
      return null;
    }

    const now = new Date();

    // Rollover budget if > 7 days old (fix 16)
    const { deliveredGal, rainfallGal, weekStart } = rolloverBudgetIfNeeded(budget, now);
    const weekStartIso = new Date(weekStart).toISOString();

    // Get rainfall data (per-zone error handling per fix 10)
    let rainfallIn = 0;
    let rainfallNote = "";
    try {
      rainfallIn = await rainfallProvider.getRainfallSince(
        weekStartIso,
        config.location.latitude,
        config.location.longitude
      );
    } catch (error) {
      console.error(`[Scheduler] Rainfall fetch failed for zone ${zone.zone_id}:`, error);
      rainfallIn = 0;
      rainfallNote = "; rainfall data unavailable, assumed 0";
    }

    const rainfallOffset = calculateRainfallOffset(
      zone.area_sqft,
      rainfallIn,
      budget.weekly_target_gal,
      deliveredGal
    );

    const remainingGal = rainfallOffset.remaining_target_gal;

    // Get current weather snapshot
    let weatherSnapshot = forecast[0] || {};
    const nowLocalHour = getLocalHour(now, config.location.timezone);
    for (const f of forecast) {
      const fHour = getLocalHour(new Date(f.time), config.location.timezone);
      if (fHour === nowLocalHour) {
        weatherSnapshot = f;
        break;
      }
    }

    // Calculate flow rate
    const flowSpecs: Record<string, number> = {};
    if (plantConfig.emitter_count) flowSpecs.emitter_count = plantConfig.emitter_count;
    if (plantConfig.emitter_gph) flowSpecs.emitter_gph = plantConfig.emitter_gph;
    if (plantConfig.head_count) flowSpecs.head_count = plantConfig.head_count;
    if (plantConfig.head_gpm) flowSpecs.head_gpm = plantConfig.head_gpm;
    if (plantConfig.soaker_length_ft) flowSpecs.soaker_length_ft = plantConfig.soaker_length_ft;
    if (plantConfig.soaker_gph_per_ft) flowSpecs.soaker_gph_per_ft = plantConfig.soaker_gph_per_ft;

    let flowGph = 0;
    try {
      const flowResult = calculateFlowGph(plantConfig.irrigation_method as any, flowSpecs);
      flowGph = flowResult.gph;
    } catch (error) {
      console.warn(`[Scheduler] Could not calculate flow for zone ${zone.zone_id}:`, error);
      flowGph = 1;
    }

    // Calculate runtime
    let baseRuntimeMin = 0;
    if (flowGph > 0) {
      baseRuntimeMin = (remainingGal / flowGph) * 60;
    }

    // Apply scheduling gates
    const decision = scheduleDecision({
      remainingGal,
      forecast,
      timezone: config.location.timezone,
      nowLocal: now,
      supplyCapacityGph: config.system.supplyCapacityGph,
      requiredFlowGph: flowGph,
    });

    // Determine outcome and runtime (handle 55-min cap per fix 14)
    let finalRuntimeMin = Math.min(Math.ceil(baseRuntimeMin), 55);
    let logOutcome: "SCHEDULED" | "REDUCED" | "SKIPPED" | "DELAYED" = "SCHEDULED";
    let logReason = decision.reason;

    if (!decision.should_run) {
      logOutcome = "SKIPPED";
    } else if (Math.ceil(baseRuntimeMin) > 55) {
      logOutcome = "REDUCED";
      logReason = `zone runtime capped at 55 min (firmware limit), ${Math.ceil(baseRuntimeMin)} min requested`;
    }

    // Log decision
    const logEntry = new IrrigationLogBuilder()
      .zoneId(zone.zone_id)
      .relayChannel(zone.relay_channel)
      .timestamp(now)
      .triggerType("SCHEDULED")
      .scheduledRuntimeMin(Math.ceil(baseRuntimeMin))
      .gallonsDelivered(0)
      .weeklyTargetGal(budget.weekly_target_gal)
      .remainingBefore(remainingGal)
      .remainingAfter(
        decision.should_run ? Math.max(0, remainingGal - finalRuntimeMin * flowGph / 60) : remainingGal
      )
      .rainfallMeasuredIn(rainfallIn)
      .rainfallGalEquiv(rainfallOffset.rain_gal)
      .weatherSnapshot(weatherSnapshot)
      .outcome(logOutcome)
      .reason(logReason + rainfallNote)
      .build();

    await writeIrrigationLog(logEntry);

    if (!decision.should_run) {
      console.log(`[Scheduler] Zone ${zone.zone_id}: ${decision.reason}`);
      return null;
    }

    console.log(`[Scheduler] Zone ${zone.zone_id}: scheduled for ${finalRuntimeMin} min, outcome: ${logOutcome}`);

    return {
      zone_id: zone.zone_id,
      relay_channel: zone.relay_channel,
      area_sqft: zone.area_sqft,
      name: zone.name,
      flowGph,
      runtimeMin: finalRuntimeMin,
      weatherSnapshot,
      rainfallIn,
      rainfallGal: rainfallOffset.rain_gal,
      budget,
    };
  } catch (error) {
    console.error(`[Scheduler] Error evaluating zone ${zone.zone_id}:`, error);
    return null;
  }
}

async function sequenceAndScheduleZones(userSub: string, zones: ZoneToRun[]): Promise<void> {
  const now = new Date();

  // Get next irrigation window start (04:00 local, or now if in window)
  const nowLocal = getLocalTime(now, config.location.timezone);
  let windowStartTime: Date;

  if (nowLocal.hour >= 4 && nowLocal.hour < 8) {
    windowStartTime = now;
  } else {
    windowStartTime = getNextWindowStart(4);
  }

  // Collect kept schedules (ACTIVE or protected PENDING) to account for their windows (fix 13)
  let latestKeptEnd = windowStartTime;
  for (const zone of zones) {
    const existing = await getSchedule(userSub, zone.zone_id);
    if (!existing) continue;

    if (existing.status === "ACTIVE") {
      const existingEnd = new Date(existing.scheduled_end);
      latestKeptEnd = new Date(Math.max(latestKeptEnd.getTime(), existingEnd.getTime()));
    } else if (
      existing.status === "PENDING" &&
      new Date(existing.scheduled_start).getTime() > now.getTime() &&
      new Date(existing.scheduled_start).getTime() - now.getTime() < 60 * 60 * 1000
    ) {
      // PENDING with FUTURE start within 1h is protected (fix 5b)
      const existingEnd = new Date(existing.scheduled_end);
      latestKeptEnd = new Date(Math.max(latestKeptEnd.getTime(), existingEnd.getTime()));
    }
  }

  // Sequence new zones starting after kept schedules
  let currentStartTime = new Date(latestKeptEnd);

  for (const zone of zones) {
    // Check if existing schedule prevents overwrite
    const existing = await getSchedule(userSub, zone.zone_id);
    if (
      existing &&
      (existing.status === "ACTIVE" ||
        (existing.status === "PENDING" &&
          new Date(existing.scheduled_start).getTime() > now.getTime() &&
          new Date(existing.scheduled_start).getTime() - now.getTime() < 60 * 60 * 1000))
    ) {
      console.log(`[Scheduler] Skipping schedule update for zone ${zone.zone_id} (already scheduled/running)`);
      continue;
    }

    const endTime = new Date(currentStartTime.getTime() + zone.runtimeMin * 60 * 1000);

    // Conditional write: refuses to clobber a run the executor promoted to
    // ACTIVE between our read above and this write.
    const written = await putScheduleIfNotActive(userSub, {
      zone_id: zone.zone_id,
      relay_channel: zone.relay_channel,
      scheduled_start: currentStartTime.toISOString(),
      scheduled_runtime_min: zone.runtimeMin,
      scheduled_end: endTime.toISOString(),
      trigger_reason: "scheduled",
      status: "PENDING",
    });
    if (!written) {
      console.log(`[Scheduler] Zone ${zone.zone_id} became ACTIVE mid-evaluation; leaving it alone`);
      continue;
    }

    console.log(
      `[Scheduler] Scheduled zone ${zone.zone_id}: ${currentStartTime.toISOString()} for ${zone.runtimeMin} min`
    );

    currentStartTime = new Date(endTime);
  }
}

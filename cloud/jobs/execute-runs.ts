// Minute-level executor job: runs scheduled irrigation
// Publishes ON/OFF commands via IoT and updates delivery tracking with persistent status

import {
  getZones,
  getSchedule,
  putBudget,
  getBudget,
  getPlantConfig,
  listUserSubs,
  transitionScheduleStatus,
} from "@/lib/dynamo";
import { commandRelay } from "@/lib/iot-mqtt";
import { writeIrrigationLog } from "@/lib/s3-logs";
import { IrrigationLogBuilder } from "@/domain/irrigation-log";
import { rolloverBudgetIfNeeded } from "@/domain/budget-rollover";

/**
 * Startup safety check: unconditionally publish OFF to all 16 relays, then mark all
 * ACTIVE schedule items as COMPLETED/FAILED for all users.
 */
export async function startupSafetyCheck(): Promise<void> {
  console.log("[Executor] Running startup safety check - publishing OFF to all relays");

  const now = new Date();

  try {
    // Publish OFF to all 16 relays (channels 1-16)
    for (let channel = 1; channel <= 16; channel++) {
      try {
        await commandRelay(channel, false);
      } catch (error) {
        console.error(`[Executor] Failed to publish OFF to relay ${channel}:`, error);
      }
    }

    // Iterate all users and mark ACTIVE schedules as FAILED
    const subs = await listUserSubs();
    for (const userSub of subs) {
      const zones = await getZones(userSub);
      for (const zone of zones) {
        const schedule = await getSchedule(userSub, zone.zone_id);
        if (!schedule || schedule.status !== "ACTIVE") continue;

        console.log(
          `[Executor] Safety check: Marking zone ${zone.zone_id} as FAILED (container restarted mid-run)`
        );

        // Atomic ACTIVE→COMPLETED: skip log if something else already closed it
        const claimed = await transitionScheduleStatus(userSub, zone.zone_id, "ACTIVE", "COMPLETED", {
          actual_end: now.toISOString(),
          outcome: "FAILED",
          failure_reason: "container restarted mid-run; relay force-closed",
        });
        if (!claimed) continue;

        // Write log entry
        const logEntry = new IrrigationLogBuilder()
          .zoneId(zone.zone_id)
          .relayChannel(schedule.relay_channel)
          .timestamp(now)
          .triggerType("SCHEDULED")
          .scheduledRuntimeMin(schedule.scheduled_runtime_min)
          .gallonsDelivered(0)
          .weeklyTargetGal(0)
          .remainingBefore(0)
          .remainingAfter(0)
          .rainfallMeasuredIn(0)
          .rainfallGalEquiv(0)
          .weatherSnapshot({})
          .outcome("FAILED")
          .reason("container restarted mid-run; relay force-closed")
          .build();

        await writeIrrigationLog(logEntry);
      }
    }
  } catch (error) {
    console.error("[Executor] Error in startup safety check:", error);
  }
}

/**
 * Main executor job: runs every minute to execute due irrigation runs
 * - Starts runs where status=PENDING AND scheduled_start <= now
 * - Stops and credits runs where status=ACTIVE AND now >= scheduled_end
 */
export async function executeDueRuns(userSub: string): Promise<void> {
  const now = new Date();

  try {
    const zones = await getZones(userSub);

    for (const zone of zones) {
      const schedule = await getSchedule(userSub, zone.zone_id);
      if (!schedule) continue;

      const scheduledStart = new Date(schedule.scheduled_start);
      const scheduledEnd = new Date(schedule.scheduled_end);

      // Handle stale PENDING items: mark PENDING with past scheduled_end as COMPLETED/FAILED
      if (schedule.status === "PENDING" && now >= scheduledEnd) {
        console.log(`[Executor] Marking stale PENDING zone ${zone.zone_id} as FAILED (missed run window)`);

        const claimed = await transitionScheduleStatus(userSub, zone.zone_id, "PENDING", "COMPLETED", {
          outcome: "FAILED",
          failure_reason: "missed run window",
        });
        if (!claimed) continue;

        const logEntry = new IrrigationLogBuilder()
          .zoneId(zone.zone_id)
          .relayChannel(zone.relay_channel)
          .timestamp(now)
          .triggerType("SCHEDULED")
          .scheduledRuntimeMin(schedule.scheduled_runtime_min)
          .gallonsDelivered(0)
          .weeklyTargetGal(0)
          .remainingBefore(0)
          .remainingAfter(0)
          .rainfallMeasuredIn(0)
          .rainfallGalEquiv(0)
          .weatherSnapshot({})
          .outcome("FAILED")
          .reason("missed run window")
          .build();

        await writeIrrigationLog(logEntry);
        continue;
      }

      // Start runs: status=PENDING AND scheduled_start <= now < scheduled_end
      if (schedule.status === "PENDING" && now >= scheduledStart && now < scheduledEnd) {
        await startRun(userSub, zone, schedule);
      }

      // Stop runs: status=ACTIVE AND now >= scheduled_end
      if (schedule.status === "ACTIVE" && now >= scheduledEnd) {
        await stopRun(userSub, zone, schedule);
      }
    }
  } catch (error) {
    console.error(`[Executor] Error executing runs for user ${userSub}:`, error);
  }
}

async function startRun(
  userSub: string,
  zone: { zone_id: string; relay_channel: number; area_sqft: number },
  schedule: any
): Promise<void> {
  const now = new Date();

  console.log(
    `[Executor] Starting zone ${zone.zone_id} (relay ${zone.relay_channel}) for ${schedule.scheduled_runtime_min} min`
  );

  // Atomically claim the run first — if another tick already claimed it,
  // skip so the relay isn't commanded twice and nothing double-credits later.
  const claimed = await transitionScheduleStatus(userSub, zone.zone_id, "PENDING", "ACTIVE", {
    actual_start: now.toISOString(),
  });
  if (!claimed) return;

  try {
    await commandRelay(schedule.relay_channel, true);
  } catch (error) {
    console.error(`[Executor] Failed to publish ON for zone ${zone.zone_id}:`, error);
    // Relay never opened — release the claim so the next tick retries.
    await transitionScheduleStatus(userSub, zone.zone_id, "ACTIVE", "PENDING", {});
  }
}

async function stopRun(
  userSub: string,
  zone: { zone_id: string; relay_channel: number; area_sqft: number },
  schedule: any
): Promise<void> {
  const now = new Date();

  console.log(`[Executor] Stopping zone ${zone.zone_id} (relay ${zone.relay_channel})`);

  // Publish OFF first (idempotent, and safety-critical), using the channel
  // stored on the schedule item — the zone's channel may have been edited mid-run.
  try {
    await commandRelay(schedule.relay_channel, false);
  } catch (error) {
    console.error(`[Executor] Failed to publish OFF for zone ${zone.zone_id}:`, error);
  }

  // Atomically claim completion — if another tick already completed this run,
  // skip crediting and logging so nothing is double-counted.
  const claimed = await transitionScheduleStatus(userSub, zone.zone_id, "ACTIVE", "COMPLETED", {
    actual_end: now.toISOString(),
    outcome: "RAN",
  });
  if (!claimed) return;

  // Get plant config to calculate actual gallons delivered
  const plantConfig = await getPlantConfig(userSub, zone.zone_id);
  const budget = await getBudget(userSub, zone.zone_id);

  let flowGph = 1; // Default fallback
  if (plantConfig) {
    // Calculate flow rate from plant config
    const flowSpecs: Record<string, number> = {};
    if (plantConfig.emitter_count) flowSpecs.emitter_count = plantConfig.emitter_count;
    if (plantConfig.emitter_gph) flowSpecs.emitter_gph = plantConfig.emitter_gph;
    if (plantConfig.head_count) flowSpecs.head_count = plantConfig.head_count;
    if (plantConfig.head_gpm) flowSpecs.head_gpm = plantConfig.head_gpm;
    if (plantConfig.soaker_length_ft) flowSpecs.soaker_length_ft = plantConfig.soaker_length_ft;
    if (plantConfig.soaker_gph_per_ft) flowSpecs.soaker_gph_per_ft = plantConfig.soaker_gph_per_ft;

    try {
      const { calculateFlowGph } = await import("@/domain/runtime-converter");
      const flowResult = calculateFlowGph(plantConfig.irrigation_method as any, flowSpecs);
      flowGph = flowResult.gph;
    } catch (error) {
      console.warn(`[Executor] Could not calculate flow for zone ${zone.zone_id}:`, error);
    }
  }

  // Credit actual elapsed valve-open minutes, capped at the scheduled runtime
  const scheduledMin = schedule.scheduled_runtime_min;
  const elapsedMin = schedule.actual_start
    ? Math.min((now.getTime() - new Date(schedule.actual_start).getTime()) / 60000, scheduledMin)
    : scheduledMin;
  const actualMin = Math.max(0, elapsedMin);
  const gallonsDelivered = (actualMin * flowGph) / 60;

  // Update budget on completion (shared weekly rollover)
  if (budget) {
    const rolled = rolloverBudgetIfNeeded(budget, now);
    await putBudget(userSub, {
      zone_id: zone.zone_id,
      weekly_target_gal: budget.weekly_target_gal,
      delivered_gal_this_week: rolled.deliveredGal + gallonsDelivered,
      rainfall_gal_this_week: rolled.rainfallGal,
      week_start_date: rolled.weekStart,
      last_updated: now.toISOString(),
    });
  }

  // Write log entry
  const logEntry = new IrrigationLogBuilder()
    .zoneId(zone.zone_id)
    .relayChannel(schedule.relay_channel)
    .timestamp(now)
    .triggerType("SCHEDULED")
    .scheduledRuntimeMin(scheduledMin)
    .actualRuntimeMin(actualMin)
    .gallonsDelivered(gallonsDelivered)
    .weeklyTargetGal(budget?.weekly_target_gal || 0)
    .remainingBefore(0)
    .remainingAfter(0)
    .rainfallMeasuredIn(0)
    .rainfallGalEquiv(0)
    .weatherSnapshot({})
    .outcome("RAN")
    .reason(`Irrigation completed: ${actualMin.toFixed(1)} min delivered, ${gallonsDelivered.toFixed(2)} gal`)
    .build();

  await writeIrrigationLog(logEntry);
}

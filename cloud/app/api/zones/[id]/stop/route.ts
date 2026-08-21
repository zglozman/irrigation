// POST /api/zones/[id]/stop
// Immediately stop an irrigation run: publish OFF, atomically complete the
// schedule, credit actually-delivered gallons, and log the event.

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  getZone,
  getSchedule,
  getBudget,
  putBudget,
  getPlantConfig,
  transitionScheduleStatus,
} from "@/lib/dynamo";
import { commandRelay } from "@/lib/iot-mqtt";
import { writeIrrigationLog } from "@/lib/s3-logs";
import { IrrigationLogBuilder } from "@/domain/irrigation-log";
import { rolloverBudgetIfNeeded } from "@/domain/budget-rollover";
import { calculateFlowGph } from "@/domain/runtime-converter";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id: zoneId } = await params;

    const schedule = await getSchedule(user.sub, zoneId);
    const zone = await getZone(user.sub, zoneId);
    if (!zone) {
      return NextResponse.json({ error: "Zone not found" }, { status: 404 });
    }

    // OFF goes to the channel stored on the schedule — the zone's channel may
    // have been edited mid-run.
    const relayChannel = schedule?.relay_channel ?? zone.relay_channel;
    await commandRelay(relayChannel, false);

    if (schedule && (schedule.status === "PENDING" || schedule.status === "ACTIVE")) {
      const now = new Date();
      const wasActive = schedule.status === "ACTIVE";

      const claimed = await transitionScheduleStatus(
        user.sub,
        zoneId,
        schedule.status,
        "COMPLETED",
        { actual_end: now.toISOString(), outcome: "RAN", failure_reason: "" }
      );

      if (claimed && wasActive) {
        // Credit only the water actually delivered before the stop.
        const elapsedMin = schedule.actual_start
          ? Math.max(
              0,
              Math.min(
                (now.getTime() - new Date(schedule.actual_start).getTime()) / 60000,
                schedule.scheduled_runtime_min
              )
            )
          : 0;

        let flowGph = 1;
        const plantConfig = await getPlantConfig(user.sub, zoneId);
        if (plantConfig) {
          const flowSpecs: Record<string, number> = {};
          for (const key of [
            "emitter_count",
            "emitter_gph",
            "head_count",
            "head_gpm",
            "soaker_length_ft",
            "soaker_gph_per_ft",
          ] as const) {
            const v = (plantConfig as unknown as Record<string, unknown>)[key];
            if (typeof v === "number") flowSpecs[key] = v;
          }
          try {
            flowGph = calculateFlowGph(
              plantConfig.irrigation_method as Parameters<typeof calculateFlowGph>[0],
              flowSpecs
            ).gph;
          } catch {
            // fall back to 1 gph
          }
        }
        const gallonsDelivered = (elapsedMin * flowGph) / 60;

        const budget = await getBudget(user.sub, zoneId);
        if (budget) {
          const rolled = rolloverBudgetIfNeeded(budget, now);
          await putBudget(user.sub, {
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
            .reason(
              `Manually stopped after ${elapsedMin.toFixed(1)} min; ${gallonsDelivered.toFixed(2)} gal delivered`
            )
            .build()
        );
      }
    }

    return NextResponse.json(
      { success: true, message: `Zone ${zoneId} stopped` },
      { status: 200 }
    );
  } catch (error) {
    console.error("[Zone Stop] Error:", error);
    const message = error instanceof Error ? error.message : "Failed to stop run";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

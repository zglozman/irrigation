// POST /api/zones/[id]/run
// Manually trigger an irrigation run for a zone

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getZone, putScheduleIfNotActive } from "@/lib/dynamo";
import { commandRelay } from "@/lib/iot-mqtt";
import { writeIrrigationLog } from "@/lib/s3-logs";
import { IrrigationLogBuilder } from "@/domain/irrigation-log";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id: zoneId } = await params;
    const body = await request.json();
    const rawMinutes = body?.minutes;

    // Strict validation BEFORE any side effect — a valve must never open
    // without a complete, valid schedule record behind it.
    if (typeof rawMinutes !== "number" || !Number.isFinite(rawMinutes) || rawMinutes < 1) {
      return NextResponse.json(
        { error: "minutes must be a number of at least 1" },
        { status: 400 }
      );
    }
    // Cap at 55 minutes (below the firmware's 60-min hard failsafe)
    const minutes = Math.min(rawMinutes, 55);

    // Get zone
    const zone = await getZone(user.sub, zoneId);
    if (!zone) {
      return NextResponse.json({ error: "Zone not found" }, { status: 404 });
    }

    const now = new Date();
    const endTime = new Date(now.getTime() + minutes * 60 * 1000);

    // Write the run record first — refuse if the zone is already running —
    // then command the relay.
    const written = await putScheduleIfNotActive(user.sub, {
      zone_id: zoneId,
      relay_channel: zone.relay_channel,
      scheduled_start: now.toISOString(),
      scheduled_runtime_min: minutes,
      scheduled_end: endTime.toISOString(),
      trigger_reason: "manual",
      status: "ACTIVE",
      actual_start: now.toISOString(),
    });
    if (!written) {
      return NextResponse.json(
        { error: "Zone is already running — stop it first" },
        { status: 409 }
      );
    }

    await commandRelay(zone.relay_channel, true);

    // Write log entry
    const logEntry = new IrrigationLogBuilder()
      .zoneId(zoneId)
      .relayChannel(zone.relay_channel)
      .timestamp(now)
      .triggerType("MANUAL")
      .scheduledRuntimeMin(minutes)
      .gallonsDelivered(0)
      .weeklyTargetGal(0)
      .remainingBefore(0)
      .remainingAfter(0)
      .rainfallMeasuredIn(0)
      .rainfallGalEquiv(0)
      .weatherSnapshot({})
      .outcome("RAN")
      .reason(`Manual run: ${minutes} minutes requested via UI`)
      .build();

    await writeIrrigationLog(logEntry);

    return NextResponse.json(
      {
        success: true,
        message: `Zone ${zoneId} started for ${minutes} minutes`,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[Zone Run] Error:", error);
    const message = error instanceof Error ? error.message : "Failed to start run";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

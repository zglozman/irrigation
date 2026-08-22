// POST /api/switches/[channel] — control individual relay

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { commandRelay } from "@/lib/iot-mqtt";
import { writeIrrigationLog } from "@/lib/s3-logs";
import { IrrigationLogBuilder } from "@/domain/irrigation-log";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ channel: string }> }
) {
  try {
    const user = await requireUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { channel: channelStr } = await params;

    // Validate channel with regex: 1-16
    if (!/^(1[0-6]|[1-9])$/.test(channelStr)) {
      return NextResponse.json(
        { error: "Channel must be an integer between 1 and 16" },
        { status: 400 }
      );
    }

    const channel = parseInt(channelStr, 10);

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const { on } = body;

    // Validate on is boolean
    if (typeof on !== "boolean") {
      return NextResponse.json(
        { error: "on must be a boolean" },
        { status: 400 }
      );
    }

    // Send command via MQTT
    await commandRelay(channel, on);

    // Log the switchboard command (non-blocking, don't fail the relay)
    (async () => {
      try {
        const logEntry = new IrrigationLogBuilder()
          .zoneId("switchboard")
          .relayChannel(channel)
          .timestamp(new Date())
          .triggerType("MANUAL")
          .scheduledRuntimeMin(0)
          .actualRuntimeMin(0)
          .gallonsDelivered(0)
          .weeklyTargetGal(0)
          .remainingBefore(0)
          .remainingAfter(0)
          .rainfallMeasuredIn(0)
          .rainfallGalEquiv(0)
          .weatherSnapshot({})
          .outcome("RAN")
          .reason(`Switchboard: relay ${channel} commanded ${on ? "ON" : "OFF"}`)
          .build();

        await writeIrrigationLog(logEntry);
      } catch (err) {
        console.error(`[Switches] Failed to log relay ${channel} command:`, err);
      }
    })();

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("[Switches] POST error:", error);
    if (error instanceof Error && error.message.includes("No ID token")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "Failed to control relay";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

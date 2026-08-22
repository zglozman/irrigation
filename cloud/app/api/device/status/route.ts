// GET /api/device/status — get board online/offline status and WiFi info

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getBoardStatus, getRetainedJson } from "@/lib/iot-mqtt";

export async function GET(_request: NextRequest) {
  try {
    const user = await requireUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const board = await getBoardStatus();
    const wifi = await getRetainedJson("irrigation-controller/wifi/status");
    const firmware = await getRetainedJson("irrigation-controller/update/firmware_update/state");

    return NextResponse.json(
      { board, wifi, firmware },
      { status: 200 }
    );
  } catch (error) {
    console.error("[Device Status] GET error:", error);
    if (error instanceof Error && error.message.includes("No ID token")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "Failed to get device status";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

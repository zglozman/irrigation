// GET /api/device/wifi/networks — get scanned WiFi networks

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getRetainedJson } from "@/lib/iot-mqtt";

export async function GET(_request: NextRequest) {
  try {
    const user = await requireUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const networks = await getRetainedJson("irrigation-controller/wifi/networks");

    return NextResponse.json(
      { networks: networks || [] },
      { status: 200 }
    );
  } catch (error) {
    console.error("[Device WiFi Networks] GET error:", error);
    if (error instanceof Error && error.message.includes("No ID token")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "Failed to get networks";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

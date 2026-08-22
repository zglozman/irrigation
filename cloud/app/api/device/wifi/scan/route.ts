// POST /api/device/wifi/scan — trigger WiFi network scan

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { publishRaw } from "@/lib/iot-mqtt";

export async function POST(_request: NextRequest) {
  try {
    const user = await requireUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Publish scan request to board
    await publishRaw("irrigation-controller/wifi/scan", "scan");

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("[Device WiFi Scan] POST error:", error);
    if (error instanceof Error && error.message.includes("No ID token")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "Failed to trigger WiFi scan";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

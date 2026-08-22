// POST /api/device/wifi/configure — configure WiFi credentials

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { publishRaw } from "@/lib/iot-mqtt";

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const { ssid, password } = body;

    // Validate ssid
    if (typeof ssid !== "string" || ssid.length < 1 || ssid.length > 32) {
      return NextResponse.json(
        { error: "SSID must be 1-32 characters" },
        { status: 400 }
      );
    }

    // Validate password
    if (typeof password !== "string" || password.length < 0 || password.length > 63) {
      return NextResponse.json(
        { error: "Password must be 0-63 characters" },
        { status: 400 }
      );
    }

    // Publish WiFi configuration (never log password)
    const payload = JSON.stringify({ ssid, password });
    await publishRaw("irrigation-controller/wifi/set", payload);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("[Device WiFi Configure] POST error:", error);
    if (error instanceof Error && error.message.includes("No ID token")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "Failed to configure WiFi";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

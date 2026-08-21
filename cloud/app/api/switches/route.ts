// GET /api/switches — get all relay states

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getAllRelayStates } from "@/lib/iot-mqtt";

export async function GET(_request: NextRequest) {
  try {
    const user = await requireUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const states = await getAllRelayStates();

    return NextResponse.json({ states }, { status: 200 });
  } catch (error) {
    console.error("[Switches] GET error:", error);
    if (error instanceof Error && error.message.includes("No ID token")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "Failed to get relay states";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

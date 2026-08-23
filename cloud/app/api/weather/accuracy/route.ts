// GET /api/weather/accuracy - Forecast vs. actual comparison
// Optional ?days= query param (1-14, default 7)

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getForecastAccuracy } from "@/lib/forecast-accuracy";

export async function GET(request: NextRequest) {
  try {
    await requireUser();

    const { searchParams } = new URL(request.url);
    let days = 7;

    if (searchParams.has("days")) {
      const parsed = parseInt(searchParams.get("days") as string, 10);
      if (Number.isFinite(parsed)) {
        days = Math.min(Math.max(parsed, 1), 14);
      }
    }

    const accuracy = await getForecastAccuracy(days);
    return NextResponse.json(accuracy);
  } catch (error) {
    console.error("[Weather/Accuracy] GET error:", error);
    if (error instanceof Error && error.message.includes("No ID token")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET /api/weather/compare - Hourly forecast vs. actual comparison
// Optional ?days= query param (1-7, default 3)

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getWeatherComparison } from "@/lib/weather-compare";

export async function GET(request: NextRequest) {
  try {
    await requireUser();

    const { searchParams } = new URL(request.url);
    let days = 3;

    if (searchParams.has("days")) {
      const parsed = parseInt(searchParams.get("days") as string, 10);
      if (Number.isFinite(parsed)) {
        days = Math.min(Math.max(parsed, 1), 7);
      }
    }

    const comparison = await getWeatherComparison(days);
    return NextResponse.json(comparison);
  } catch (error) {
    console.error("[Weather/Compare] GET error:", error);
    if (error instanceof Error && error.message.includes("No ID token")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

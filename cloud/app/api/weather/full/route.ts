// GET /api/weather/full
// Full weather forecast with 48h hourly + 6 days daily
// Uses 10-min cache to avoid quota burn across dashboard + weather page + Sprout

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { cached } from "@/lib/weather-cache";
import { config } from "@/lib/config";

const TOMORROW_API_URL = "https://api.tomorrow.io/v4/weather/forecast";
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface TomorrowIOResponse {
  timelines?: {
    hourly?: Array<{
      time: string;
      values: Record<string, number | null>;
    }>;
    daily?: Array<{
      time: string;
      values: Record<string, number | null>;
    }>;
  };
}

async function fetchFullForecast(
  lat: number,
  lon: number,
  apiKey: string
): Promise<TomorrowIOResponse> {
  const params = new URLSearchParams({
    location: `${lat},${lon}`,
    apikey: apiKey,
    units: "metric",
  });
  // Add timesteps separately to allow multiple values
  params.append("timesteps", "1h");
  params.append("timesteps", "1d");

  const response = await fetch(`${TOMORROW_API_URL}?${params}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Tomorrow.io API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const lat = config.location.latitude;
    const lon = config.location.longitude;
    const apiKey = config.weather.tomorrowApiKey;

    if (!apiKey) {
      return NextResponse.json({ error: "Weather API key not configured" }, { status: 500 });
    }

    // Wrap in 10-min TTL cache
    const data = await cached(
      "forecast-full",
      CACHE_TTL_MS,
      () => fetchFullForecast(lat, lon, apiKey)
    );

    // Extract hourly and daily from the correct shape: {timelines: {hourly: [...], daily: [...]}}
    const hourly = data.timelines?.hourly ?? [];
    const daily = data.timelines?.daily ?? [];

    // First hourly entry is the "current" condition
    const currentEntry = hourly[0];
    const current = currentEntry
      ? {
          time: currentEntry.time,
          ...currentEntry.values,
        }
      : null;

    // Return structure with location + all raw fields passed through
    return NextResponse.json(
      {
        location: {
          lat,
          lon,
          timezone: config.location.timezone,
        },
        current,
        hourly: hourly.slice(0, 48).map((h) => ({
          time: h.time,
          ...h.values,
        })),
        daily: daily.slice(0, 6).map((d) => ({
          time: d.time,
          ...d.values,
        })),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[Weather/Full] Error:", error);
    if (error instanceof Error && error.message.includes("No ID token")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "Failed to fetch forecast";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

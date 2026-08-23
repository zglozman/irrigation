// GET /api/settings/weather - get current weather settings and validation status
// PUT /api/settings/weather - update weather settings (validate then save)

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getWeatherSettings } from "@/lib/dynamo";
import { getRainfallSource, resolveWUCredentials } from "@/weather";
import { validateWUStation } from "@/weather/wunderground";
import { setRainStation } from "@/lib/weather-settings";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const settings = await getWeatherSettings();
    const source = await getRainfallSource();

    let wu_api_key_masked = null;
    if (settings?.wu_api_key) {
      const lastFour = settings.wu_api_key.slice(-4);
      wu_api_key_masked = `••••${lastFour}`;
    } else if (settings?.wu_station_id) {
      wu_api_key_masked = "public web key (scraped)";
    }

    // If WU is configured, fetch live validation (resolves the scraped key
    // when no key is stored)
    let validation = undefined;
    if (settings?.wu_station_id) {
      const creds = await resolveWUCredentials();
      if (creds) {
        validation = await validateWUStation(creds.stationId, creds.apiKey);
      }
    }

    return NextResponse.json({
      wu_station_id: settings?.wu_station_id || null,
      wu_api_key_masked,
      source,
      validation,
    });
  } catch (error) {
    console.error("[Settings/Weather] GET error:", error);
    if (error instanceof Error && error.message.includes("No ID token")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      wu_station_id?: string;
      wu_api_key?: string;
    };

    const result = await setRainStation(body.wu_station_id || "", body.wu_api_key || "");

    if (!result.success) {
      return NextResponse.json(
        {
          error: result.error,
          ok: false,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("[Settings/Weather] PUT error:", error);
    if (error instanceof Error && error.message.includes("No ID token")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

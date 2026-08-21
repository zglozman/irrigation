// GET /api/forecast
// Lightweight forecast endpoint for UI (24h summary)

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getForecastProvider } from "@/weather";
import { config } from "@/lib/config";

export async function GET(request: NextRequest) {
  try {
    await requireUser();

    const forecastProvider = getForecastProvider();
    const forecast = await forecastProvider.getForecast(
      config.location.latitude,
      config.location.longitude
    );

    if (!forecast || forecast.length === 0) {
      return NextResponse.json({ error: "No forecast data available" }, { status: 500 });
    }

    // Summarize next 24h
    const next24h = forecast.slice(0, 24);
    const maxTemp = Math.max(...next24h.map((h) => h.tempF));
    const minTemp = Math.min(...next24h.map((h) => h.tempF));
    const maxWindMph = Math.max(...next24h.map((h) => h.windMph));
    const rainProbPercent = Math.round(Math.max(...next24h.map((h) => h.precipProb)) * 100);
    const totalRainIn = next24h.reduce((sum, h) => sum + h.precipIn, 0);

    // Determine emoji
    let emoji = "☀️";
    if (rainProbPercent >= 60) {
      emoji = totalRainIn >= 0.25 ? "⛈️" : "🌧️";
    } else if (rainProbPercent >= 30) {
      emoji = "⛅";
    } else if (minTemp <= 32) {
      emoji = "❄️";
    }

    return NextResponse.json(
      {
        emoji,
        maxTemp,
        minTemp,
        maxWindMph,
        rainProbPercent,
        totalRainIn,
        rainSkipLikely: rainProbPercent >= 60 && totalRainIn >= 0.1,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[Forecast] Error:", error);
    const message = error instanceof Error ? error.message : "Failed to get forecast";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

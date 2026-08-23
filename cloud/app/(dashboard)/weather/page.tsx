// Weather page - full forecast with hourly, daily, and detailed metrics

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Location {
  lat: number;
  lon: number;
  timezone: string;
}

interface WeatherValues {
  temperature?: number;
  temperatureApparent?: number;
  humidity?: number;
  dewPoint?: number;
  windSpeed?: number;
  windGust?: number;
  windDirection?: number;
  precipitationProbability?: number;
  rainIntensity?: number;
  rainAccumulation?: number;
  evapotranspiration?: number;
  cloudCover?: number;
  uvIndex?: number;
  visibility?: number;
  pressureSurfaceLevel?: number;
  weatherCode?: number;
  [key: string]: number | undefined;
}

interface HourlyEntry {
  time: string;
  temperature?: number;
  temperatureApparent?: number;
  humidity?: number;
  dewPoint?: number;
  windSpeed?: number;
  windGust?: number;
  windDirection?: number;
  precipitationProbability?: number;
  rainIntensity?: number;
  rainAccumulation?: number;
  evapotranspiration?: number;
  cloudCover?: number;
  uvIndex?: number;
  visibility?: number;
  pressureSurfaceLevel?: number;
  weatherCode?: number;
  [key: string]: string | number | undefined;
}

interface DailyEntry {
  time: string;
  temperature?: number;
  temperatureApparent?: number;
  temperatureMin?: number;
  temperatureMax?: number;
  humidity?: number;
  dewPoint?: number;
  windSpeed?: number;
  windGust?: number;
  windDirection?: number;
  precipitationProbability?: number;
  rainIntensity?: number;
  rainAccumulation?: number;
  evapotranspiration?: number;
  cloudCover?: number;
  uvIndex?: number;
  visibility?: number;
  pressureSurfaceLevel?: number;
  weatherCode?: number;
  [key: string]: string | number | undefined;
}

interface FullForecast {
  location: Location;
  current: WeatherValues & { time: string } | null;
  hourly: HourlyEntry[];
  daily: DailyEntry[];
}

function getWeatherEmoji(weatherCode?: number, precip?: number, cloud?: number): string {
  // Tomorrow.io weather codes (4-digit)
  if (!weatherCode) {
    if (cloud && cloud > 70) return "☁️";
    if (precip && precip > 0.5) return "🌧️";
    return "☀️";
  }

  // 1000/1100: Clear/Mostly Clear
  if (weatherCode === 1000 || weatherCode === 1100) return "☀️";
  // 1101/1102: Partly Cloudy/Mostly Cloudy
  if (weatherCode === 1101 || weatherCode === 1102) return "⛅";
  // 1001: Cloudy
  if (weatherCode === 1001) return "☁️";
  // 2000/2100: Fog/Light Fog
  if (weatherCode === 2000 || weatherCode === 2100) return "🌫️";
  // 4000/4001/4200/4201: Rain
  if ([4000, 4001, 4200, 4201].includes(weatherCode)) return "🌧️";
  // 5000-5101: Snow
  if (weatherCode >= 5000 && weatherCode <= 5101) return "❄️";
  // 6000s: Freezing Rain
  if (weatherCode >= 6000 && weatherCode <= 6001) return "🌨️";
  // 7000s: Ice Pellets
  if (weatherCode >= 7000 && weatherCode <= 7102) return "🧊";
  // 8000: Thunderstorm
  if (weatherCode === 8000) return "⛈️";

  return "🌡️"; // Default
}

function celsiusToFahrenheit(celsius: number): number {
  return Math.round((celsius * 9) / 5 + 32);
}

function formatTime(isoTime: string, timezone: string): string {
  try {
    const date = new Date(isoTime);
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone,
      hour12: true,
    });
  } catch {
    return "N/A";
  }
}

function formatDate(isoTime: string, timezone: string): string {
  try {
    const date = new Date(isoTime);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: timezone,
      weekday: "short",
    });
  } catch {
    return "N/A";
  }
}

function formatWindDirection(degrees?: number): string {
  if (!degrees) return "N/A";
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const index = Math.round(degrees / 22.5) % 16;
  return dirs[index];
}

function MetricTile({
  label,
  value,
  unit,
  emoji,
  highlight,
}: {
  label: string;
  value: string | number | undefined;
  unit?: string;
  emoji?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-[14px] p-3 text-center ${
        highlight ? "border border-[#cfe0cf] bg-tint" : "bg-track"
      }`}
    >
      {emoji && <div className="mb-1 text-2xl">{emoji}</div>}
      <div className="mb-1 text-[11px] font-bold text-fern">{label}</div>
      <div
        className={`font-mono text-[16px] font-medium ${highlight ? "text-leafdark" : "text-ink"}`}
      >
        {value}
        {unit && <span className="ml-1 text-[12px] text-fern">{unit}</span>}
      </div>
    </div>
  );
}

export default function WeatherPage() {
  const [forecast, setForecast] = useState<FullForecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadForecast();
  }, []);

  const loadForecast = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/weather/full");
      if (!response.ok) throw new Error("Failed to load forecast");
      const data = await response.json();
      setForecast(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load forecast";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-fern">reading the sky…</p>
      </div>
    );
  }

  if (error || !forecast || !forecast.current) {
    return (
      <div className="p-5 md:p-8">
        <div className="rounded-[16px] bg-claytint p-4 text-sm text-clay">
          {error || "No forecast data available"}
        </div>
      </div>
    );
  }

  const current = forecast.current;
  const tempC = current.temperature || 0;
  const tempF = celsiusToFahrenheit(tempC);
  const feelsC = current.temperatureApparent || tempC;
  const feelsF = celsiusToFahrenheit(feelsC);
  const emoji = getWeatherEmoji(
    current.weatherCode,
    current.rainIntensity,
    current.cloudCover
  );

  // Check for rain-skip conditions in next 48h
  const next48h = forecast.hourly.slice(0, 48);
  const maxPrecipProb = Math.max(...next48h.map((h) => h.precipitationProbability || 0));
  const totalAccumulation = next48h.reduce((sum, h) => sum + (h.rainAccumulation || 0), 0);
  const rainSkipLikely = maxPrecipProb >= 60 && totalAccumulation >= 2.54; // 0.1 inches = 2.54mm

  // All fields from current, excluding time and standard ones
  const extraFields = Object.entries(current)
    .filter(
      ([k]) =>
        ![
          "time",
          "temperature",
          "temperatureApparent",
          "humidity",
          "dewPoint",
          "windSpeed",
          "windGust",
          "windDirection",
          "precipitationProbability",
          "rainIntensity",
          "rainAccumulation",
          "evapotranspiration",
          "cloudCover",
          "uvIndex",
          "visibility",
          "pressureSurfaceLevel",
          "weatherCode",
        ].includes(k)
    )
    .filter(([, v]) => v !== null && v !== undefined);

  return (
    <div className="mx-auto max-w-[980px] px-5 pb-8 md:px-12">
      {/* Header */}
      <div className="flex items-baseline justify-between pb-3.5 pt-6 md:pt-8">
        <h1 className="font-display text-[27px] font-bold leading-tight tracking-[-0.02em] text-ink">
          weather
        </h1>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-fern">
            {forecast.location.lat.toFixed(4)}, {forecast.location.lon.toFixed(4)} ·{" "}
            {forecast.location.timezone}
          </span>
          <Link
            href="/weather/accuracy"
            className="pill pill-soft text-[12px] h-8 px-3"
          >
            forecast vs. actual →
          </Link>
        </div>
      </div>

      {/* Now section */}
      <div className="card mb-6 p-5">
        <h2 className="mb-5 font-display text-[16px] font-semibold tracking-[-0.01em] text-sec">
          Now
        </h2>

        {/* Hero card with big temp */}
        <div className="mb-6 text-center">
          <div className="mb-2 text-6xl">{emoji}</div>
          <div className="font-display text-5xl font-bold tracking-[-0.02em] text-ink">
            {tempF}°F{" "}
            <span className="font-mono text-2xl font-medium text-fern">
              / {tempC.toFixed(0)}°C
            </span>
          </div>
          <div className="mt-2 text-sec">
            Feels like {feelsF}°F / {feelsC.toFixed(0)}°C
          </div>
        </div>

        {/* Grid of all current metrics */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          <MetricTile
            label="Humidity"
            value={current.humidity?.toFixed(0)}
            unit="%"
          />
          <MetricTile
            label="Dew Point"
            value={celsiusToFahrenheit(current.dewPoint || 0)}
            unit="°F"
          />
          <MetricTile
            label="Wind Speed"
            value={((current.windSpeed || 0) * 2.23694).toFixed(1)}
            unit="mph"
          />
          <MetricTile
            label="Wind Gust"
            value={((current.windGust || 0) * 2.23694).toFixed(1)}
            unit="mph"
          />
          <MetricTile
            label="Wind Direction"
            value={formatWindDirection(current.windDirection)}
          />
          <MetricTile
            label="Precip Probability"
            value={(current.precipitationProbability || 0).toFixed(0)}
            unit="%"
          />
          <MetricTile
            label="Rain Intensity"
            value={((current.rainIntensity || 0) / 25.4).toFixed(2)}
            unit="in/h"
          />
          <MetricTile
            label="Evapotranspiration"
            value={((current.evapotranspiration || 0) / 25.4).toFixed(3)}
            unit="in/day"
            emoji="💧"
            highlight
          />
          <MetricTile
            label="Cloud Cover"
            value={(current.cloudCover || 0).toFixed(0)}
            unit="%"
          />
          <MetricTile
            label="UV Index"
            value={(current.uvIndex || 0).toFixed(1)}
          />
          <MetricTile
            label="Visibility"
            value={(current.visibility || 0).toFixed(1)}
            unit="km"
          />
          <MetricTile
            label="Pressure"
            value={(current.pressureSurfaceLevel || 0).toFixed(0)}
            unit="hPa"
          />
        </div>

        {/* All extra fields */}
        {extraFields.length > 0 && (
          <details className="mt-6 border-t border-hairline pt-5">
            <summary className="cursor-pointer text-sm font-bold text-fern hover:text-sec">
              All fields ({extraFields.length})
            </summary>
            <div className="mt-4 space-y-2">
              {extraFields.map(([key, value]) => (
                <div key={key} className="flex justify-between text-sm">
                  <span className="text-fern">{key}:</span>
                  <span className="font-mono font-medium text-ink">{String(value)}</span>
                </div>
              ))}
            </div>
          </details>
        )}

        {/* Rain skip note */}
        {rainSkipLikely && (
          <div className="mt-6 rounded-[12px] border border-[#cfe3f5] bg-[#eaf3fc] p-3 text-sm text-[#4f7ba6]">
            🌧️ Rain-skip conditions likely — Sprout will probably hold watering.
          </div>
        )}
      </div>

      {/* Next 48 hours */}
      <div className="mb-6">
        <h2 className="mb-3.5 font-display text-[16px] font-semibold tracking-[-0.01em] text-sec">
          Next 48 hours
        </h2>
        <div className="overflow-x-auto pb-4">
          <div className="flex min-w-max gap-2">
            {forecast.hourly.slice(0, 48).map((hour) => {
              const hourTempC = hour.temperature || 0;
              const hourTempF = celsiusToFahrenheit(hourTempC);
              const hourEmoji = getWeatherEmoji(
                hour.weatherCode,
                hour.rainIntensity,
                hour.cloudCover
              );
              const hourTime = formatTime(hour.time, forecast.location.timezone);

              return (
                <div
                  key={hour.time}
                  className="card w-24 flex-shrink-0 rounded-[16px] p-3 text-center text-sm"
                >
                  <div className="mb-1 font-mono text-[11px] text-fern">{hourTime}</div>
                  <div className="mb-1 text-2xl">{hourEmoji}</div>
                  <div className="mb-1 font-mono font-medium text-ink">{hourTempF}°F</div>
                  <div className="font-mono text-[11px] text-[#5e86ad]">
                    {(hour.precipitationProbability || 0).toFixed(0)}%
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-fern">
                    {((hour.windSpeed || 0) * 2.23694).toFixed(0)}mph
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Precipitation bar */}
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-bold text-fern">Precipitation Probability</h3>
          <div className="flex h-12 items-end gap-1 overflow-x-auto rounded-[12px] bg-track p-1">
            {forecast.hourly.slice(0, 48).map((hour) => {
              const prob = (hour.precipitationProbability || 0) / 100;
              return (
                <div
                  key={hour.time}
                  className="group relative flex-1 flex-shrink-0 rounded-md bg-rain transition-all hover:bg-[#7fb4e4]"
                  style={{
                    height: `${Math.max(4, prob * 100)}%`,
                    opacity: prob > 0 ? 1 : 0.25,
                  }}
                  title={`${(hour.precipitationProbability || 0).toFixed(0)}%`}
                >
                  <div className="invisible absolute -top-6 left-1/2 -translate-x-1/2 transform whitespace-nowrap rounded bg-ink px-2 py-1 font-mono text-xs text-white group-hover:visible">
                    {formatTime(hour.time, forecast.location.timezone)}:{" "}
                    {(hour.precipitationProbability || 0).toFixed(0)}%
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Next 6 days */}
      <div>
        <h2 className="mb-3.5 font-display text-[16px] font-semibold tracking-[-0.01em] text-sec">
          Next 6 days
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {forecast.daily.slice(0, 6).map((day) => {
            const minC = day.temperatureMin as number | undefined || 0;
            const maxC = day.temperatureMax as number | undefined || 0;
            const minF = celsiusToFahrenheit(minC);
            const maxF = celsiusToFahrenheit(maxC);
            const emoji = getWeatherEmoji(day.weatherCode, day.rainAccumulation, day.cloudCover);
            const date = formatDate(day.time, forecast.location.timezone);

            return (
              <div key={day.time} className="card p-4">
                <div className="mb-3 flex items-start justify-between">
                  <div className="font-display text-[15px] font-semibold tracking-[-0.01em] text-ink">
                    {date}
                  </div>
                  <div className="text-3xl">{emoji}</div>
                </div>

                <div className="mb-1 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-fern">Temp</span>
                    <span className="font-mono font-medium text-ink">
                      {maxF}°F / {minF}°F
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-fern">Precip Prob</span>
                    <span className="font-mono font-medium text-ink">
                      {(day.precipitationProbability || 0).toFixed(0)}%
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-fern">Accumulation</span>
                    <span className="font-mono font-medium text-ink">
                      {((day.rainAccumulation || 0) / 25.4).toFixed(2)}in
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-fern">Evapotranspiration</span>
                    <span className="font-mono font-medium text-leaf">
                      {((day.evapotranspiration || 0) / 25.4).toFixed(3)}in
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

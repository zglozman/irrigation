// Weather page - full forecast with hourly, daily, and detailed metrics

"use client";

import { useEffect, useState } from "react";

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
      className={`p-3 rounded-lg border ${
        highlight
          ? "bg-teal-900/30 border-teal-600/50"
          : "bg-slate-900/50 border-slate-700/50"
      } text-center`}
    >
      {emoji && <div className="text-2xl mb-1">{emoji}</div>}
      <div className="text-xs font-medium text-slate-400 mb-1">{label}</div>
      <div className={`text-lg font-semibold ${highlight ? "text-teal-300" : "text-white"}`}>
        {value}
        {unit && <span className="text-sm ml-1">{unit}</span>}
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
      <div className="p-8 flex items-center justify-center h-full">
        <p className="text-slate-400">Loading weather...</p>
      </div>
    );
  }

  if (error || !forecast || !forecast.current) {
    return (
      <div className="p-8">
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded text-red-400">
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
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-1">Weather</h1>
        <p className="text-slate-400 text-sm">
          {forecast.location.lat.toFixed(4)}, {forecast.location.lon.toFixed(4)} •{" "}
          {forecast.location.timezone}
        </p>
      </div>

      {/* Now section */}
      <div className="mb-8 p-6 bg-slate-900/50 border border-slate-700/50 rounded-lg">
        <h2 className="text-lg font-bold text-white mb-6">Now</h2>

        {/* Hero card with big temp */}
        <div className="mb-6 text-center">
          <div className="text-6xl mb-2">{emoji}</div>
          <div className="text-5xl font-bold text-white">
            {tempF}°F <span className="text-2xl text-slate-400">/ {tempC.toFixed(0)}°C</span>
          </div>
          <div className="text-slate-400 mt-2">
            Feels like {feelsF}°F / {feelsC.toFixed(0)}°C
          </div>
        </div>

        {/* Grid of all current metrics */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
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
          <details className="mt-6 pt-6 border-t border-slate-700/50">
            <summary className="text-sm font-medium text-slate-400 cursor-pointer hover:text-slate-300">
              All fields ({extraFields.length})
            </summary>
            <div className="mt-4 space-y-2">
              {extraFields.map(([key, value]) => (
                <div key={key} className="flex justify-between text-sm">
                  <span className="text-slate-400">{key}:</span>
                  <span className="text-white font-medium">{String(value)}</span>
                </div>
              ))}
            </div>
          </details>
        )}

        {/* Rain skip note */}
        {rainSkipLikely && (
          <div className="mt-6 p-3 bg-blue-900/30 border border-blue-600/50 rounded text-sm text-blue-300">
            🌧️ Rain-skip conditions likely — Sprout will probably hold watering.
          </div>
        )}
      </div>

      {/* Next 48 hours */}
      <div className="mb-8">
        <h2 className="text-lg font-bold text-white mb-4">Next 48 hours</h2>
        <div className="overflow-x-auto pb-4">
          <div className="flex gap-2 min-w-max">
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
                  className="flex-shrink-0 w-24 p-3 bg-slate-900/50 border border-slate-700/50 rounded text-center text-sm"
                >
                  <div className="text-xs text-slate-400 mb-1">{hourTime}</div>
                  <div className="text-2xl mb-1">{hourEmoji}</div>
                  <div className="font-semibold text-white mb-1">{hourTempF}°F</div>
                  <div className="text-xs text-slate-400">
                    {(hour.precipitationProbability || 0).toFixed(0)}%
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {((hour.windSpeed || 0) * 2.23694).toFixed(0)}mph
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Precipitation bar */}
        <div className="mt-4">
          <h3 className="text-sm font-medium text-slate-400 mb-2">Precipitation Probability</h3>
          <div className="flex gap-1 h-12 bg-slate-900/50 rounded-lg p-1 overflow-x-auto">
            {forecast.hourly.slice(0, 48).map((hour) => {
              const prob = (hour.precipitationProbability || 0) / 100;
              return (
                <div
                  key={hour.time}
                  className="flex-1 flex-shrink-0 bg-slate-800 rounded-md transition-all hover:bg-slate-700 relative group"
                  style={{
                    height: `${prob * 100}%`,
                    background: `linear-gradient(180deg, #38bdf8 0%, #0ea5e9 100%)`,
                  }}
                  title={`${(hour.precipitationProbability || 0).toFixed(0)}%`}
                >
                  <div className="invisible group-hover:visible absolute -top-6 left-1/2 transform -translate-x-1/2 bg-slate-700 text-white text-xs px-2 py-1 rounded whitespace-nowrap">
                    {formatTime(hour.time, forecast.location.timezone)}: {(hour.precipitationProbability || 0).toFixed(0)}%
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Next 6 days */}
      <div>
        <h2 className="text-lg font-bold text-white mb-4">Next 6 days</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {forecast.daily.slice(0, 6).map((day) => {
            const minC = day.temperatureMin as number | undefined || 0;
            const maxC = day.temperatureMax as number | undefined || 0;
            const minF = celsiusToFahrenheit(minC);
            const maxF = celsiusToFahrenheit(maxC);
            const emoji = getWeatherEmoji(day.weatherCode, day.rainAccumulation, day.cloudCover);
            const date = formatDate(day.time, forecast.location.timezone);

            return (
              <div
                key={day.time}
                className="p-4 bg-slate-900/50 border border-slate-700/50 rounded-lg"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="font-semibold text-white">{date}</div>
                  </div>
                  <div className="text-3xl">{emoji}</div>
                </div>

                <div className="space-y-2 mb-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Temp</span>
                    <span className="text-white font-medium">
                      {maxF}°F / {minF}°F
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Precip Prob</span>
                    <span className="text-white font-medium">
                      {(day.precipitationProbability || 0).toFixed(0)}%
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Accumulation</span>
                    <span className="text-white font-medium">
                      {((day.rainAccumulation || 0) / 25.4).toFixed(2)}in
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Evapotranspiration</span>
                    <span className="text-teal-300 font-medium">
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

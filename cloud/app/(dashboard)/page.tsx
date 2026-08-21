// Dashboard page - shows all zones with weekly budget progress

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Zone {
  zone_id: string;
  name: string;
  relay_channel: number;
  area_sqft: number;
  plantConfig?: {
    zone_type: string;
    total_gal_per_week?: number;
  };
  budget?: {
    weekly_target_gal: number;
    delivered_gal_this_week: number;
    rainfall_gal_this_week: number;
  };
  schedule?: {
    status: "PENDING" | "ACTIVE" | "COMPLETED";
  };
}

interface Forecast {
  emoji: string;
  maxTemp: number;
  minTemp: number;
  rainProbPercent: number;
  rainSkipLikely: boolean;
}

export default function DashboardPage() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadZones();
    loadForecast();
  }, []);

  const loadZones = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/zones");
      if (!response.ok) throw new Error("Failed to load zones");
      const data = await response.json();
      setZones(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load zones";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const loadForecast = async () => {
    try {
      const response = await fetch("/api/forecast");
      if (response.ok) {
        const data = await response.json();
        setForecast(data);
      }
    } catch (err) {
      console.error("Failed to load forecast:", err);
    }
  };

  const getProgressPercent = (zone: Zone): number => {
    const budget = zone.budget;
    if (!budget || budget.weekly_target_gal === 0) return 0;

    const used = budget.rainfall_gal_this_week + budget.delivered_gal_this_week;
    return Math.min(100, (used / budget.weekly_target_gal) * 100);
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <p className="text-slate-400">Loading zones...</p>
      </div>
    );
  }

  const getPlantEmoji = (zoneType?: string): string => {
    if (!zoneType) return "🌱";
    if (zoneType.includes("turf")) return "🌿";
    if (zoneType.includes("vegetable")) return "🍅";
    if (zoneType.includes("shrub")) return "🪴";
    if (zoneType.includes("xeric")) return "🌵";
    if (zoneType.includes("tree")) return "🌳";
    return "🌱";
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Dashboard</h1>
        <p className="text-slate-400">Monitor your irrigation zones</p>
      </div>

      {/* Weather Strip */}
      {forecast && (
        <div className="mb-6 p-4 bg-slate-800 border border-slate-700 rounded-lg">
          <div className="flex items-center gap-4">
            <span className="text-3xl">{forecast.emoji}</span>
            <div className="flex-1">
              <p className="text-sm font-medium text-white">
                {forecast.maxTemp}°F high, {forecast.minTemp}°F low
              </p>
              <p className="text-xs text-slate-400">
                {forecast.rainProbPercent}% chance of rain
                {forecast.rainSkipLikely && (
                  <span className="ml-2 text-teal-400">— Sprout may skip watering</span>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded text-red-400">
          {error}
        </div>
      )}

      {zones.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-slate-400 mb-4">No zones configured yet</p>
          <Link
            href="/zones"
            className="inline-block px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded font-medium transition-colors"
          >
            Create Zone
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {zones.map((zone) => {
            const budget = zone.budget;
            const percent = getProgressPercent(zone);
            const delivered = budget?.delivered_gal_this_week || 0;
            const rainfall = budget?.rainfall_gal_this_week || 0;
            const target = budget?.weekly_target_gal || 0;
            const isActive = zone.schedule?.status === "ACTIVE";
            const plantEmoji = getPlantEmoji(zone.plantConfig?.zone_type);

            const rainfallPercent = target > 0 ? (rainfall / target) * 100 : 0;
            const deliveredPercent = target > 0 ? (delivered / target) * 100 : 0;

            return (
              <Link
                key={zone.zone_id}
                href={`/zones/${zone.zone_id}`}
                className="group block"
              >
                <div className="relative bg-slate-900 border border-slate-800 rounded-lg p-6 hover:border-slate-700 transition-all hover:shadow-lg">
                  {/* Active Droplet Badge */}
                  {isActive && (
                    <div className="absolute -top-3 -right-3 w-8 h-8 bg-teal-500 rounded-full flex items-center justify-center text-lg animate-pulse shadow-lg">
                      💧
                    </div>
                  )}

                  {/* Zone Header with Plant Emoji */}
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h2 className="text-lg font-bold text-white mb-1 group-hover:text-teal-400 transition-colors">
                        {zone.name}
                      </h2>
                      <p className="text-sm text-slate-400">
                        {zone.plantConfig?.zone_type || "Unknown type"}
                      </p>
                    </div>
                    <span className="text-3xl">{plantEmoji}</span>
                  </div>

                  {/* Animated Progress Bar */}
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-slate-300">
                        Weekly Budget
                      </span>
                      <span className="text-xs text-slate-400">
                        {percent.toFixed(0)}%
                      </span>
                    </div>

                    <div className="h-3 bg-slate-800 rounded-full overflow-hidden relative">
                      <div className="absolute inset-0 bg-gradient-to-r from-blue-500/30 to-teal-500/30 opacity-50" />
                      <div
                        className="h-full bg-gradient-to-r from-blue-400 to-blue-500 transition-all duration-500 ease-out"
                        style={{
                          width: `${Math.min(100, rainfallPercent)}%`,
                        }}
                        title="Rainfall"
                      />
                      <div
                        className="absolute top-0 left-0 h-full bg-gradient-to-r from-teal-400 to-teal-500 transition-all duration-500 ease-out"
                        style={{
                          width: `${Math.min(100, rainfallPercent + deliveredPercent)}%`,
                          marginLeft: `${Math.min(100, rainfallPercent)}%`,
                        }}
                        title="Irrigation"
                      />
                    </div>

                    <div className="flex justify-between mt-2 text-xs text-slate-500">
                      <span>
                        {(rainfall + delivered).toFixed(1)} / {target.toFixed(1)} gal
                      </span>
                    </div>
                  </div>

                  {/* Quick Actions */}
                  <div className="flex space-x-2 pt-4 border-t border-slate-800">
                    <QuickRunButton zoneId={zone.zone_id} />
                    <QuickStopButton zoneId={zone.zone_id} />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function QuickRunButton({ zoneId }: { zoneId: string }) {
  const [showInput, setShowInput] = useState(false);
  const [minutes, setMinutes] = useState("10");
  const [loading, setLoading] = useState(false);

  const handleRun = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await fetch(`/api/zones/${zoneId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minutes: parseInt(minutes) }),
      });

      if (response.ok) {
        setShowInput(false);
        setMinutes("10");
      }
    } catch (err) {
      console.error("Run error:", err);
    } finally {
      setLoading(false);
    }
  };

  if (showInput) {
    return (
      <form onSubmit={handleRun} className="flex space-x-1 flex-1">
        <input
          type="number"
          min="1"
          max="55"
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          className="flex-1 px-2 py-1 text-sm bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          autoFocus
          onClick={(e) => e.stopPropagation()}
        />
        <button
          type="submit"
          disabled={loading}
          className="px-2 py-1 text-sm bg-teal-600 hover:bg-teal-700 disabled:bg-slate-700 text-white rounded font-medium transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          {loading ? "..." : "Go"}
        </button>
      </form>
    );
  }

  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setShowInput(true);
      }}
      className="flex-1 px-3 py-1 text-sm bg-teal-600/20 hover:bg-teal-600/30 text-teal-300 rounded font-medium transition-colors border border-teal-500/30"
    >
      Run
    </button>
  );
}

function QuickStopButton({ zoneId }: { zoneId: string }) {
  const [loading, setLoading] = useState(false);

  const handleStop = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setLoading(true);

    try {
      await fetch(`/api/zones/${zoneId}/stop`, { method: "POST" });
    } catch (err) {
      console.error("Stop error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleStop}
      disabled={loading}
      className="flex-1 px-3 py-1 text-sm bg-red-600/20 hover:bg-red-600/30 text-red-300 rounded font-medium transition-colors border border-red-500/30 disabled:opacity-50"
    >
      {loading ? "..." : "Stop"}
    </button>
  );
}

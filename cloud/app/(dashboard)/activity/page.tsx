// Activity page — running now + recent activity

"use client";

import { useEffect, useState } from "react";

interface RunningItem {
  zone_id: string;
  zone_name: string | null;
  relay_channel: number;
  actual_start: string;
  scheduled_end: string;
  remaining_min: number;
  raw?: boolean;
}

interface RecentItem {
  timestamp: string;
  zone_id: string;
  relay_channel: number;
  trigger_type: string;
  outcome: string;
  actual_runtime_min: number | null;
  gallons_estimated_delivered: number;
  reason: string;
}

interface ActivityData {
  running: RunningItem[];
  recent: RecentItem[];
}

function getOutcomeBadgeColor(outcome: string) {
  switch (outcome) {
    case "RAN":
      return "bg-green-500/20 text-green-300 border-green-500/30";
    case "SKIPPED":
      return "bg-slate-500/20 text-slate-300 border-slate-500/30";
    case "SCHEDULED":
      return "bg-sky-500/20 text-sky-300 border-sky-500/30";
    case "DELAYED":
      return "bg-amber-500/20 text-amber-300 border-amber-500/30";
    case "REDUCED":
      return "bg-blue-500/20 text-blue-300 border-blue-500/30";
    case "FAILED":
      return "bg-red-500/20 text-red-300 border-red-500/30";
    default:
      return "bg-slate-500/20 text-slate-300 border-slate-500/30";
  }
}

function WaterFillBar({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="w-full bg-slate-700 rounded h-2 overflow-hidden">
      <div
        className="h-full bg-teal-500 transition-all duration-500"
        style={{ width: `${clamped}%` }}
      ></div>
    </div>
  );
}

function formatLocalTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function ActivityPage() {
  const [activity, setActivity] = useState<ActivityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchActivity = async () => {
      try {
        setError("");
        const res = await fetch("/api/activity");
        if (!res.ok) throw new Error("Failed to fetch activity");
        const data = await res.json();
        setActivity(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load activity";
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    fetchActivity();
    const interval = setInterval(fetchActivity, 10000); // Poll every 10s

    return () => clearInterval(interval);
  }, []);

  const handleStop = async (item: RunningItem) => {
    try {
      if (item.zone_id && item.zone_id !== "switchboard") {
        // Stop zone schedule
        const res = await fetch(`/api/zones/${item.zone_id}/stop`, { method: "POST" });
        if (!res.ok) throw new Error("Failed to stop zone");
      } else {
        // Stop relay directly
        const res = await fetch(`/api/switches/${item.relay_channel}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ on: false }),
        });
        if (!res.ok) throw new Error("Failed to stop relay");
      }
      // Refresh activity immediately
      const res = await fetch("/api/activity");
      if (res.ok) {
        const data = await res.json();
        setActivity(data);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to stop";
      alert(message);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <p className="text-slate-400">Loading activity...</p>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Activity</h1>
        <p className="text-slate-400">Real-time irrigation activity and history</p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded text-red-400">
          {error}
        </div>
      )}

      {/* Running Now Section */}
      <div className="mb-12">
        <h2 className="text-xl font-bold text-white mb-4">Running Now</h2>

        {!activity?.running || activity.running.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-8 text-center">
            <p className="text-slate-400">No irrigation running — system is idle</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {activity.running.map((item, idx) => {
              const totalMin = item.remaining_min;
              const startDate = new Date(item.actual_start);
              const endDate = new Date(item.scheduled_end);
              const scheduledTotal = Math.round((endDate.getTime() - startDate.getTime()) / 60000);
              const elapsedMin = scheduledTotal - item.remaining_min;
              const fillPercent = scheduledTotal > 0 ? (elapsedMin / scheduledTotal) * 100 : 0;

              return (
                <div
                  key={idx}
                  className="bg-slate-900 border border-slate-800 rounded-lg p-6 space-y-4"
                >
                  <div>
                    <h3 className="text-lg font-bold text-white">
                      {item.zone_name || `Relay ${item.relay_channel}${item.raw ? " (manual)" : ""}`}
                    </h3>
                    <p className="text-sm text-slate-400 mt-1">
                      Started {formatLocalTime(item.actual_start)}
                    </p>
                  </div>

                  <div>
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-slate-300">Progress</span>
                      <span className="text-teal-400 font-medium">{item.remaining_min}m remaining</span>
                    </div>
                    <WaterFillBar percent={fillPercent} />
                  </div>

                  <button
                    onClick={() => handleStop(item)}
                    className="w-full px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/30 rounded transition-colors text-sm font-medium"
                  >
                    Stop
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent Activity Section */}
      <div>
        <h2 className="text-xl font-bold text-white mb-4">Recent Activity</h2>

        {!activity?.recent || activity.recent.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-8 text-center">
            <p className="text-slate-400">No runs yet — history appears after the first watering</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="px-4 py-3 text-left text-slate-300 font-medium">Time</th>
                  <th className="px-4 py-3 text-left text-slate-300 font-medium">Zone / Relay</th>
                  <th className="px-4 py-3 text-left text-slate-300 font-medium">Trigger</th>
                  <th className="px-4 py-3 text-left text-slate-300 font-medium">Outcome</th>
                  <th className="px-4 py-3 text-left text-slate-300 font-medium">Runtime (min)</th>
                  <th className="px-4 py-3 text-left text-slate-300 font-medium">Gallons</th>
                  <th className="px-4 py-3 text-left text-slate-300 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {activity.recent.map((item, idx) => (
                  <tr key={idx} className="border-b border-slate-800 hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">
                      {formatLocalTime(item.timestamp)}
                    </td>
                    <td className="px-4 py-3 text-white">
                      {item.zone_id || `Relay ${item.relay_channel}`}
                    </td>
                    <td className="px-4 py-3 text-slate-300 text-xs">{item.trigger_type}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium border ${getOutcomeBadgeColor(
                          item.outcome
                        )}`}
                      >
                        {item.outcome}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      {item.actual_runtime_min !== null ? item.actual_runtime_min.toFixed(1) : "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      {item.gallons_estimated_delivered != null ? Number(item.gallons_estimated_delivered).toFixed(1) : "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs max-w-xs truncate">
                      {item.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

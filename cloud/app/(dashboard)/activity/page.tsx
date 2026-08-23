// Journal page — what the garden drank. "Running now" card plus a
// day-grouped ledger of humanized entries.

"use client";

import { useEffect, useState } from "react";
import { BedGaugeCompact } from "@/components/garden/BedGauge";

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

// dot color by outcome: watered leaf / rested stone / trimmed rain / failed clay
function outcomeDot(item: RecentItem): string {
  if (/watchdog/i.test(item.trigger_type) || /watchdog/i.test(item.reason)) return "#d26743";
  switch (item.outcome) {
    case "RAN":
      return "#2f8f4e";
    case "REDUCED":
      return "#9ec9ef";
    case "FAILED":
      return "#d26743";
    default:
      // SKIPPED / DELAYED / SCHEDULED
      return "#b7c4b3";
  }
}

function entryTitle(item: RecentItem, zoneName: string): string {
  if (/watchdog/i.test(item.trigger_type) || /watchdog/i.test(item.reason)) {
    return `valve ${item.relay_channel} closed by the watchdog`;
  }
  switch (item.outcome) {
    case "RAN":
      return item.trigger_type === "MANUAL"
        ? `${zoneName} hand-watered`
        : `${zoneName} watered`;
    case "SKIPPED":
      return `${zoneName} rested`;
    case "REDUCED":
      return item.actual_runtime_min != null
        ? `${zoneName} trimmed to ${Math.round(item.actual_runtime_min)} min`
        : `${zoneName} trimmed`;
    case "DELAYED":
      return `${zoneName} held for later`;
    case "SCHEDULED":
      return `${zoneName} penciled in`;
    case "FAILED":
      return `${zoneName} didn't water`;
    default:
      return `${zoneName} — ${item.outcome.toLowerCase()}`;
  }
}

function ledgerTime(iso: string): string {
  try {
    const d = new Date(iso);
    let h = d.getHours();
    const suffix = h >= 12 ? "p" : "a";
    h = h % 12 || 12;
    return `${h}:${String(d.getMinutes()).padStart(2, "0")}${suffix}`;
  } catch {
    return iso;
  }
}

function clockTime(iso: string): string {
  try {
    const d = new Date(iso);
    let h = d.getHours();
    const suffix = h >= 12 ? "pm" : "am";
    h = h % 12 || 12;
    return `${h}:${String(d.getMinutes()).padStart(2, "0")} ${suffix}`;
  } catch {
    return iso;
  }
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((today.getTime() - that.getTime()) / 86400000);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  return d
    .toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    .toLowerCase()
    .replace(",", "");
}

export default function ActivityPage() {
  const [activity, setActivity] = useState<ActivityData | null>(null);
  const [zoneNames, setZoneNames] = useState<Record<string, string>>({});
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

  // Zone names for humanized entry titles
  useEffect(() => {
    const loadNames = async () => {
      try {
        const res = await fetch("/api/zones");
        if (res.ok) {
          const zones = await res.json();
          const map: Record<string, string> = {};
          for (const z of zones) {
            if (z.zone_id && z.name) map[z.zone_id] = String(z.name).toLowerCase();
          }
          setZoneNames(map);
        }
      } catch (err) {
        console.error("Failed to load zone names:", err);
      }
    };
    loadNames();
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
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-fern">opening the journal…</p>
      </div>
    );
  }

  const nameFor = (item: RecentItem): string =>
    zoneNames[item.zone_id] || (item.zone_id ? item.zone_id : `valve ${item.relay_channel}`);

  // Day-group the ledger while keeping the API's ordering
  const groups: Array<{ label: string; items: RecentItem[] }> = [];
  for (const item of activity?.recent || []) {
    const label = dayLabel(item.timestamp);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }

  return (
    <div className="mx-auto max-w-[980px] px-5 md:px-12">
      <div className="flex items-baseline justify-between pb-3.5 pt-6 md:pt-8">
        <h1 className="font-display text-[27px] font-bold leading-tight tracking-[-0.02em] text-ink">
          journal
        </h1>
        <span className="font-mono text-[11px] text-fern">what the garden drank</span>
      </div>

      {error && (
        <div className="mb-4 rounded-[16px] bg-claytint p-4 text-sm text-clay">{error}</div>
      )}

      {/* Running now */}
      {!activity?.running || activity.running.length === 0 ? (
        <div className="card border border-hairline p-4 text-center">
          <p className="text-sm text-fern">the garden is quiet — nothing drinking right now</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {activity.running.map((item, idx) => {
            const startDate = new Date(item.actual_start);
            const endDate = new Date(item.scheduled_end);
            const scheduledTotal = Math.round(
              (endDate.getTime() - startDate.getTime()) / 60000
            );
            const elapsedMin = scheduledTotal - item.remaining_min;
            const fillPercent = scheduledTotal > 0 ? elapsedMin / scheduledTotal : 0;
            const name = (item.zone_name || `valve ${item.relay_channel}`).toLowerCase();

            return (
              <div
                key={idx}
                className="card flex flex-col gap-2 border border-[#cfe0cf] px-4 py-3.5"
              >
                <div className="flex items-center gap-2.5">
                  <span className="h-[9px] w-[9px] shrink-0 animate-pulse rounded-full bg-leaf" />
                  <span className="min-w-0 flex-1 truncate font-display text-[17px] font-semibold tracking-[-0.01em] text-ink">
                    {item.raw ? `${name} is open` : `${name} ${item.zone_name ? "is drinking" : "is open"}`}
                  </span>
                  <button
                    onClick={() => handleStop(item)}
                    className="pill pill-stop h-11 px-[18px] text-[13px]"
                  >
                    stop
                  </button>
                </div>
                <BedGaugeCompact frac={fillPercent} />
                <span className="font-mono text-[11px] text-fern">
                  {item.raw
                    ? "opened by hand — no schedule behind it"
                    : `started ${clockTime(item.actual_start)} · ${item.remaining_min} of ${scheduledTotal} min left`}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* The ledger */}
      <div className="flex flex-col pb-8 pt-3">
        {groups.length === 0 ? (
          <div className="card mt-2 p-8 text-center">
            <p className="text-sm text-fern">
              no entries yet — the journal fills in after the first watering
            </p>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="flex flex-col">
              <span className="py-2 font-mono text-[11px] text-fern">— {group.label} —</span>
              {group.items.map((item, idx) => (
                <div key={idx} className="flex gap-3 border-t border-hairline py-3">
                  <span className="min-w-[52px] pt-0.5 font-mono text-[11px] text-fern">
                    {ledgerTime(item.timestamp)}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: outcomeDot(item) }}
                      />
                      <span className="text-[14px] font-bold text-ink">
                        {entryTitle(item, nameFor(item))}
                      </span>
                      {item.outcome === "RAN" && (
                        <span className="font-mono text-[11px] text-sec">
                          {item.actual_runtime_min != null
                            ? `${Math.round(item.actual_runtime_min)}m · `
                            : ""}
                          {Number(item.gallons_estimated_delivered || 0).toFixed(1)} gal
                        </span>
                      )}
                    </div>
                    {item.reason && (
                      <span className="text-[12px] leading-normal text-fern">{item.reason}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

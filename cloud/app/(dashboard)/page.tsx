// Garden page — spreadsheet dashboard of all beds with live watering data.
// One row per bed with status, targets, and quick actions.

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
    scheduled_start?: string;
    scheduled_end?: string;
    scheduled_runtime_min?: number;
  };
}

interface BoardStatus {
  state: "online" | "offline" | "unknown";
  since: string | null;
}

function formatClock(date: Date): string {
  let h = date.getHours();
  const m = date.getMinutes();
  const suffix = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${suffix}`;
}

function formatClockShort(date: Date): string {
  let h = date.getHours();
  const m = date.getMinutes();
  const suffix = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${suffix}`;
}

const plantEmoji = (zoneType?: string): string => {
  if (!zoneType) return "🌿";
  if (zoneType.includes("turf")) return "🌱";
  if (zoneType.includes("vegetable")) return "🍅";
  if (zoneType.includes("shrub")) return "🌸";
  if (zoneType.includes("xeric")) return "🌵";
  if (zoneType.includes("tree")) return "🌳";
  return "🌿";
};

export default function DashboardPage() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [board, setBoard] = useState<BoardStatus>({ state: "unknown", since: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadZones();
    loadBoard();
  }, []);

  // Poll zones and board status every 10s
  useEffect(() => {
    const zonesInterval = setInterval(loadZones, 10000);
    const boardInterval = setInterval(loadBoard, 10000);
    return () => {
      clearInterval(zonesInterval);
      clearInterval(boardInterval);
    };
  }, []);

  const loadZones = async () => {
    try {
      const response = await fetch("/api/zones");
      if (!response.ok) throw new Error("Failed to load zones");
      const data = await response.json();
      setZones(data);
      setLoading(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load zones";
      setError(message);
      setLoading(false);
    }
  };

  const loadBoard = async () => {
    try {
      const response = await fetch("/api/device/status");
      if (response.ok) {
        const data = await response.json();
        setBoard(data.board || { state: "unknown", since: null });
      }
    } catch (err) {
      console.error("Failed to load board status:", err);
    }
  };

  const now = new Date();
  const dateLine = now
    .toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    .toLowerCase()
    .replace(",", "");

  // Calculate totals
  const totals = zones.reduce(
    (acc, z) => ({
      area: acc.area + (z.area_sqft || 0),
      target: acc.target + (z.budget?.weekly_target_gal || 0),
      delivered: acc.delivered + (z.budget?.delivered_gal_this_week || 0),
      rainfall: acc.rainfall + (z.budget?.rainfall_gal_this_week || 0),
    }),
    { area: 0, target: 0, delivered: 0, rainfall: 0 }
  );
  totals.target = Math.round(totals.target * 10) / 10;
  totals.delivered = Math.round(totals.delivered * 10) / 10;
  totals.rainfall = Math.round(totals.rainfall * 10) / 10;

  const sortedZones = [...zones].sort((a, b) => a.relay_channel - b.relay_channel);

  const statusFor = (zone: Zone): { text: string; hasActive: boolean } => {
    const budget = zone.budget;
    const target = budget?.weekly_target_gal || 0;
    const total = (budget?.delivered_gal_this_week || 0) + (budget?.rainfall_gal_this_week || 0);

    if (zone.schedule?.status === "ACTIVE") {
      let mins: number | null = null;
      if (zone.schedule.scheduled_end) {
        mins = Math.max(0, Math.round((new Date(zone.schedule.scheduled_end).getTime() - Date.now()) / 60000));
      }
      return {
        text: `💧 drinking · ${mins != null ? `${mins} min` : "?"}`,
        hasActive: true,
      };
    }
    if (target > 0 && total >= target) {
      return { text: "😌 full", hasActive: false };
    }
    if (zone.schedule?.status === "PENDING" && zone.schedule.scheduled_start) {
      const start = new Date(zone.schedule.scheduled_start);
      return { text: `queued ${formatClockShort(start)}`, hasActive: false };
    }
    return { text: "waiting", hasActive: false };
  };

  const nextRunFor = (zone: Zone): string => {
    if (zone.schedule?.status === "ACTIVE" && zone.schedule.scheduled_end) {
      return formatClockShort(new Date(zone.schedule.scheduled_end));
    }
    if (zone.schedule?.status === "PENDING" && zone.schedule.scheduled_start) {
      return formatClockShort(new Date(zone.schedule.scheduled_start));
    }
    return "—";
  };

  const anyActive = zones.some((z) => z.schedule?.status === "ACTIVE");

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-fern">walking the garden…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-full px-5 pb-8 md:px-12">
      {/* Slim header bar */}
      <header className="flex flex-col gap-3 py-6 md:py-8 md:flex-row md:items-baseline md:justify-between md:gap-0">
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-[27px] font-bold leading-tight tracking-[-0.02em] text-ink">
            the garden
          </h1>
          <span className="font-mono text-[11px] text-sec">{dateLine}</span>
        </div>

        <div className="flex items-baseline gap-4">
          <div className="flex items-center gap-1.5">
            <div
              className="h-2 w-2 rounded-full"
              style={{
                background: board.state === "online" ? "var(--color-leaf)" : board.state === "offline" ? "var(--color-clay)" : "var(--color-inactive)",
              }}
            />
            <span className="font-mono text-[11px] text-sec">
              {board.state === "online" ? "awake" : board.state === "offline" ? "asleep" : "unknown"}
            </span>
          </div>

          <span className="font-mono text-[11px] text-sec whitespace-nowrap">
            target {totals.target.toFixed(1)} gal · watered {totals.delivered.toFixed(1)} · rained {totals.rainfall.toFixed(1)}
          </span>
        </div>
      </header>

      {error && (
        <div className="mb-4 rounded-[16px] bg-claytint p-4 text-sm text-clay">
          {error}
        </div>
      )}

      {/* Data table */}
      {zones.length === 0 && !error ? (
        <div className="card flex flex-col items-center gap-4 p-8 text-center">
          <p className="text-sm text-fern">no beds planted yet</p>
          <Link href="/zones/new" className="pill pill-primary h-11 px-5 text-sm">
            plant the first bed
          </Link>
        </div>
      ) : (
        <div className="card overflow-x-auto rounded-[20px]">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 bg-white border-r border-hairline px-4 py-3 text-left font-mono text-[11px] text-sec font-normal tracking-widest uppercase">
                  bed
                </th>
                <th className="px-4 py-3 text-left font-mono text-[11px] text-sec font-normal tracking-widest uppercase whitespace-nowrap">
                  valve
                </th>
                <th className="px-4 py-3 text-left font-mono text-[11px] text-sec font-normal tracking-widest uppercase">
                  type
                </th>
                <th className="px-4 py-3 text-right font-mono text-[11px] text-sec font-normal tracking-widest uppercase whitespace-nowrap">
                  area (sq ft)
                </th>
                <th className="px-4 py-3 text-right font-mono text-[11px] text-sec font-normal tracking-widest uppercase">
                  target
                </th>
                <th className="px-4 py-3 text-right font-mono text-[11px] text-sec font-normal tracking-widest uppercase">
                  rained
                </th>
                <th className="px-4 py-3 text-right font-mono text-[11px] text-sec font-normal tracking-widest uppercase">
                  watered
                </th>
                <th className="px-4 py-3 text-right font-mono text-[11px] text-sec font-normal tracking-widest uppercase">
                  left
                </th>
                <th className="px-4 py-3 text-left font-mono text-[11px] text-sec font-normal tracking-widest uppercase">
                  status
                </th>
                <th className="px-4 py-3 text-left font-mono text-[11px] text-sec font-normal tracking-widest uppercase whitespace-nowrap">
                  next run
                </th>
                <th className="px-4 py-3 text-center font-mono text-[11px] text-sec font-normal tracking-widest uppercase">
                  action
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedZones.map((zone) => {
                const budget = zone.budget;
                const target = budget?.weekly_target_gal || 0;
                const delivered = budget?.delivered_gal_this_week || 0;
                const rainfall = budget?.rainfall_gal_this_week || 0;
                const left = Math.max(0, target - rainfall - delivered);
                const isActive = zone.schedule?.status === "ACTIVE";
                const status = statusFor(zone);
                const nextRun = nextRunFor(zone);

                return (
                  <tr
                    key={zone.zone_id}
                    className={`border-t border-hairline transition-colors ${isActive ? "bg-tint" : "hover:bg-[#f7faf6]"}`}
                  >
                    <td className="sticky left-0 bg-inherit border-r border-hairline px-4 py-3 font-display text-[15px] font-semibold text-ink">
                      <Link
                        href={`/zones/${zone.zone_id}`}
                        className="press text-ink hover:text-leaf"
                        title={zone.name}
                      >
                        <span className="inline-block mr-2">{plantEmoji(zone.plantConfig?.zone_type)}</span>
                        {zone.name.toLowerCase()}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-[13px] text-ink">
                      {String(zone.relay_channel).padStart(2, "0")}
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-sec">
                      {zone.plantConfig?.zone_type?.toLowerCase() || "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-[13px] text-ink text-right">
                      {zone.area_sqft.toFixed(0)}
                    </td>
                    <td className="px-4 py-3 font-mono text-[13px] text-ink text-right">
                      {target.toFixed(1)}
                    </td>
                    <td className="px-4 py-3 font-mono text-[13px] text-ink text-right">
                      {rainfall.toFixed(1)}
                    </td>
                    <td className="px-4 py-3 font-mono text-[13px] text-ink text-right">
                      {delivered.toFixed(1)}
                    </td>
                    <td className="px-4 py-3 font-mono text-[13px] text-right">
                      {left > 0 ? <span className="text-ink">{left.toFixed(1)}</span> : <span className="text-sec">—</span>}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-ink">
                      {status.text}
                    </td>
                    <td className="px-4 py-3 font-mono text-[13px] text-sec whitespace-nowrap">
                      {nextRun}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {isActive ? (
                        <QuickStopButton zoneId={zone.zone_id} zoneName={zone.name} />
                      ) : (
                        <QuickRunButton zoneId={zone.zone_id} zoneName={zone.name} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-hairline">
                <td className="sticky left-0 bg-white border-r border-hairline px-4 py-3 font-display text-[14px] font-semibold text-ink">
                  all beds
                </td>
                <td colSpan={2}></td>
                <td className="px-4 py-3 font-mono text-[13px] font-semibold text-ink text-right">
                  {totals.area.toFixed(0)}
                </td>
                <td className="px-4 py-3 font-mono text-[13px] font-semibold text-ink text-right">
                  {totals.target.toFixed(1)}
                </td>
                <td className="px-4 py-3 font-mono text-[13px] font-semibold text-ink text-right">
                  {totals.rainfall.toFixed(1)}
                </td>
                <td className="px-4 py-3 font-mono text-[13px] font-semibold text-ink text-right">
                  {totals.delivered.toFixed(1)}
                </td>
                <td className="px-4 py-3 font-mono text-[13px] font-semibold text-ink text-right">
                  {Math.max(0, totals.target - totals.rainfall - totals.delivered).toFixed(1)}
                </td>
                <td colSpan={3} className="px-4 py-3">
                  {anyActive && <StopAllButton zones={sortedZones} />}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function QuickRunButton({ zoneId, zoneName }: { zoneId: string; zoneName: string }) {
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
      <form onSubmit={handleRun} className="flex shrink-0 items-center gap-1">
        <input
          type="number"
          min="1"
          max="55"
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          className="h-9 w-14 rounded-full border border-inputb bg-white text-center font-mono text-xs text-ink focus:outline-none focus:ring-2 focus:ring-leaflight"
          aria-label={`minutes to run ${zoneName.toLowerCase()}`}
          autoFocus
          onClick={(e) => e.stopPropagation()}
        />
        <button
          type="submit"
          disabled={loading}
          className="pill pill-primary h-9 px-3 text-[12px]"
          onClick={(e) => e.stopPropagation()}
        >
          {loading ? "…" : "go"}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowInput(false);
          }}
          className="px-2 text-[12px] text-sec hover:text-ink"
        >
          ✕
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
      className="pill pill-soft h-9 shrink-0 px-3 text-[12px]"
      aria-label={`Run ${zoneName.toLowerCase()}`}
    >
      run
    </button>
  );
}

function QuickStopButton({ zoneId, zoneName }: { zoneId: string; zoneName: string }) {
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
      className="pill pill-stop h-9 shrink-0 px-3 text-[12px]"
      aria-label={`Stop ${zoneName.toLowerCase()}`}
    >
      {loading ? "…" : "stop"}
    </button>
  );
}

function StopAllButton({ zones }: { zones: Zone[] }) {
  const [loading, setLoading] = useState(false);

  const handleStopAll = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setLoading(true);

    try {
      const activeBeds = zones.filter((z) => z.schedule?.status === "ACTIVE");
      for (const bed of activeBeds) {
        await fetch(`/api/zones/${bed.zone_id}/stop`, { method: "POST" });
      }
    } catch (err) {
      console.error("Stop all error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleStopAll}
      disabled={loading}
      className="pill pill-stop h-9 shrink-0 px-3 text-[12px]"
      aria-label="Stop all beds"
    >
      {loading ? "…" : "stop all"}
    </button>
  );
}

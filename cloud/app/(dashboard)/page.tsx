// Garden page — the terraced beds, the dawn watering window, and the
// day at a glance. Every bed is a soil cross-section that fills as it drinks.

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BedGauge } from "@/components/garden/BedGauge";
import { DawnArc, DawnArcMark } from "@/components/garden/DawnArc";

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

interface Forecast {
  emoji: string;
  maxTemp: number;
  minTemp: number;
  rainProbPercent: number;
  rainSkipLikely: boolean;
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

const plantEmojis = (zoneType?: string): [string, string] => {
  if (!zoneType) return ["🌱", "🌿"];
  if (zoneType.includes("turf")) return ["🌾", "🌾"];
  if (zoneType.includes("vegetable")) return ["🍅", "🍅"];
  if (zoneType.includes("shrub")) return ["🪴", "🌿"];
  if (zoneType.includes("xeric")) return ["🌵", "🌼"];
  if (zoneType.includes("tree")) return ["🌳", "🍃"];
  return ["🌱", "🌿"];
};

export default function DashboardPage() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [board, setBoard] = useState<BoardStatus>({ state: "unknown", since: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadZones();
    loadForecast();
    loadBoard();
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
  const nowHour = now.getHours() + now.getMinutes() / 60;
  const dateLine = now
    .toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    .toLowerCase()
    .replace(",", "");
  const dayName = now.toLocaleDateString("en-US", { weekday: "long" });

  // Drink marks from today's schedules
  const marks: DawnArcMark[] = zones
    .filter((z) => z.schedule?.scheduled_start)
    .map((z) => {
      const start = new Date(z.schedule!.scheduled_start!);
      const isToday = start.toDateString() === now.toDateString();
      return { zone: z, start, isToday };
    })
    .filter((m) => m.isToday)
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map(({ zone, start }) => ({
      label: `${zone.name.toLowerCase().split(" ")[0]} ${formatClock(start).replace(" am", "").replace(" pm", "")}`,
      hour: start.getHours() + start.getMinutes() / 60,
      color:
        zone.schedule?.status === "PENDING"
          ? "#9ec9ef"
          : "#2f8f4e",
    }));

  const statusFor = (zone: Zone): { text: string; className: string } => {
    const budget = zone.budget;
    const target = budget?.weekly_target_gal || 0;
    const total = (budget?.delivered_gal_this_week || 0) + (budget?.rainfall_gal_this_week || 0);

    if (zone.schedule?.status === "ACTIVE") {
      let mins: number | null = null;
      if (zone.schedule.scheduled_end) {
        mins = Math.max(0, Math.round((new Date(zone.schedule.scheduled_end).getTime() - Date.now()) / 60000));
      }
      return {
        text: `💧 drinking now${mins != null ? ` · ${mins} min` : ""}`,
        className: "text-leaf font-bold",
      };
    }
    if (target > 0 && total >= target) {
      const rained = (budget?.rainfall_gal_this_week || 0) > 0;
      return {
        text: rained ? "😌 resting — rain filled this bed" : "😌 resting — full for the week",
        className: "text-warn",
      };
    }
    if (zone.schedule?.status === "PENDING" && zone.schedule.scheduled_start) {
      const start = new Date(zone.schedule.scheduled_start);
      const today = start.toDateString() === now.toDateString();
      const tomorrow =
        start.toDateString() === new Date(now.getTime() + 86400000).toDateString();
      const day = today ? "today" : tomorrow ? "tomorrow" : start.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
      return { text: `drinks ${day} ${formatClock(start)}`, className: "text-fern" };
    }
    return { text: "no drink on the books", className: "text-fern" };
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-fern">walking the garden…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[980px]">
      {/* Masthead */}
      <header className="rounded-b-[28px] bg-gradient-to-br from-[#dff0d8] via-[#cfe8cf] to-[#c3e2cd] px-5 pb-5 pt-6 md:rounded-none md:bg-none md:px-12 md:pb-1 md:pt-8">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="font-display text-[27px] font-bold leading-tight tracking-[-0.02em] text-ink md:text-[30px]">
            <span className="md:hidden">sprout</span>
            <span className="hidden md:inline">{dayName} in the garden</span>
          </h1>
          <span className="font-mono text-[11px] text-sec md:text-[12px]">
            {dateLine} · board {board.state === "online" ? "online" : board.state === "offline" ? "offline" : "…"}
          </span>
        </div>
      </header>

      {/* Dawn watering window */}
      <section className="px-5 pt-3 md:px-12">
        <div className="md:flex md:items-end md:gap-8">
          <div className="md:max-w-[560px] md:flex-1">
            <DawnArc marks={marks} nowHour={nowHour} />
          </div>
          <div className="flex flex-col gap-2 md:pb-2">
            <span className="mt-0.5 text-[12px] text-sec md:text-[13px]">
              {forecast
                ? `This morning's watering window. ${forecast.maxTemp}° and ${
                    forecast.rainProbPercent >= 50
                      ? "rain coming — some beds may rest"
                      : "clear — the beds drink at dawn"
                  }.`
                : "This morning's watering window."}
            </span>
            <div className="flex items-center gap-3.5">
              <span className="flex items-center gap-1.5">
                <span className="h-[9px] w-3.5 rounded-[3px] bg-leaf" />
                <span className="text-[11px] text-sec">watered</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-[9px] w-3.5 rounded-[3px] bg-rain" />
                <span className="text-[11px] text-sec">rain</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-[11px] w-0.5 [background:repeating-linear-gradient(180deg,#79907e_0_2px,transparent_2px_5px)]" />
                <span className="text-[11px] text-sec">weekly goal</span>
              </span>
            </div>
          </div>
        </div>
      </section>

      {error && (
        <div className="mx-5 mt-4 rounded-[16px] bg-claytint p-4 text-sm text-clay md:mx-12">
          {error}
        </div>
      )}

      {/* Terraced beds */}
      <section className="flex flex-col gap-3 px-5 pt-4 md:px-12 md:pt-5">
        {zones.length === 0 && !error ? (
          <div className="card flex flex-col items-center gap-4 p-8 text-center">
            <p className="text-sm text-fern">no beds planted yet</p>
            <Link href="/zones/new" className="pill pill-primary h-11 px-5 text-sm">
              plant the first bed
            </Link>
          </div>
        ) : (
          zones.map((zone) => {
            const budget = zone.budget;
            const delivered = budget?.delivered_gal_this_week || 0;
            const rainfall = budget?.rainfall_gal_this_week || 0;
            const target = budget?.weekly_target_gal || 0;
            const isActive = zone.schedule?.status === "ACTIVE";
            const [emojiA, emojiB] = plantEmojis(zone.plantConfig?.zone_type);
            const status = statusFor(zone);

            return (
              <div key={zone.zone_id} className="card p-4">
                <div className="flex items-end justify-between gap-2 pb-2">
                  <Link
                    href={`/zones/${zone.zone_id}`}
                    className="press flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1"
                  >
                    <span className="font-display text-[19px] font-semibold leading-tight tracking-[-0.01em] text-ink">
                      {zone.name.toLowerCase()}
                    </span>
                    <span className={`text-[12px] ${status.className}`}>{status.text}</span>
                  </Link>
                  {isActive ? (
                    <QuickStopButton zoneId={zone.zone_id} />
                  ) : (
                    <QuickRunButton zoneId={zone.zone_id} />
                  )}
                </div>

                <div className="relative mt-2 h-[84px]">
                  <span className="absolute -top-3.5 left-[18px] z-[2] text-[24px]" aria-hidden="true">
                    {emojiA}
                  </span>
                  <span className="absolute -top-2.5 left-[52px] z-[2] text-[18px]" aria-hidden="true">
                    {emojiB}
                  </span>
                  <BedGauge
                    deliveredFrac={target > 0 ? delivered / target : 0}
                    rainFrac={target > 0 ? rainfall / target : 0}
                  />
                  <span className="absolute bottom-2 right-3 font-mono text-[11px] text-sec">
                    {(delivered + rainfall).toFixed(1)}/{target.toFixed(1)} gal
                  </span>
                </div>
              </div>
            );
          })
        )}
      </section>
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
      <form onSubmit={handleRun} className="flex shrink-0 items-center gap-1.5">
        <input
          type="number"
          min="1"
          max="55"
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          className="h-11 w-16 rounded-full border border-inputb bg-white text-center font-mono text-sm text-ink focus:outline-none focus:ring-2 focus:ring-leaflight"
          aria-label="minutes to run"
          autoFocus
          onClick={(e) => e.stopPropagation()}
        />
        <button
          type="submit"
          disabled={loading}
          className="pill pill-primary h-11 px-4 text-[13px]"
          onClick={(e) => e.stopPropagation()}
        >
          {loading ? "…" : "go"}
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
      className="pill pill-soft h-11 shrink-0 px-[18px] text-[13px]"
    >
      run
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
      className="pill pill-stop h-11 shrink-0 px-[18px] text-[13px]"
    >
      {loading ? "…" : "stop"}
    </button>
  );
}

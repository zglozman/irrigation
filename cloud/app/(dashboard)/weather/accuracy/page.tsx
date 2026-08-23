// Weather accuracy page — forecast vs. actual comparison (comprehensive)
// Shows paired hourly comparison with visual strip, today's live data, and scorecard

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import SkyStrip from "@/components/garden/SkyStrip";
import { HourlyComparison, ComparisonStats, TodayObservation } from "@/lib/weather-compare";

interface DayAccuracy {
  date: string; // YYYY-MM-DD
  pull_time: string | null;
  predicted_rain_in: number | null;
  predicted_prob_max: number | null;
  predicted_high_f: number | null;
  predicted_wind_max: number | null;
  actual_rain_in: number | null;
  actual_high_f: number | null;
  actual_wind_max: number | null;
}

interface AccuracyData {
  source: "wunderground" | "none";
  days: number;
  days_data: DayAccuracy[];
  hits?: {
    rain_called_right: number;
    misses: number;
    false_alarms: number;
    comparable_days: number;
  };
}

interface ComparisonData {
  source: "wunderground" | "none";
  days: number;
  hours: HourlyComparison[];
  stats: ComparisonStats;
  today_fine: TodayObservation[];
  station_id: string | null;
}

function dayName(dateStr: string): string {
  try {
    const [year, month, day] = dateStr.split("-").map(Number);
    const d = new Date(year, month - 1, day);
    const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    const dayOfWeek = days[d.getDay()];

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const that = new Date(year, month - 1, day);
    const diffDays = Math.floor((today.getTime() - that.getTime()) / 86400000);

    if (diffDays === 0) return "today";
    if (diffDays === 1) return "yesterday";

    return dayOfWeek;
  } catch {
    return dateStr;
  }
}

export default function ForecastAccuracyPage() {
  const [comparison, setComparison] = useState<ComparisonData | null>(null);
  const [accuracy, setAccuracy] = useState<AccuracyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError("");

        const [compRes, accRes] = await Promise.all([
          fetch("/api/weather/compare?days=3"),
          fetch("/api/weather/accuracy?days=7"),
        ]);

        if (!compRes.ok) throw new Error("Failed to load comparison");
        if (!accRes.ok) throw new Error("Failed to load accuracy");

        const compData = await compRes.json();
        const accData = await accRes.json();

        setComparison(compData);
        setAccuracy(accData);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load data";
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-fern">comparing forecasts and the sky…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-5 md:p-8">
        <div className="rounded-[16px] bg-claytint p-4 text-sm text-clay">
          {error}
        </div>
      </div>
    );
  }

  const source = comparison?.source || accuracy?.source || "none";
  const stationId = comparison?.station_id || null;
  const hours = comparison?.hours || [];
  const stats = comparison?.stats;
  const todayFine = comparison?.today_fine || [];
  const accuracyData = accuracy?.days_data || [];

  // Verdict chips
  const chips: Array<{ emoji: string; text: string }> = [];

  if (stats?.temp.bias !== null && stats?.temp.bias !== undefined) {
    const bias = stats.temp.bias;
    if (Math.abs(bias) > 1.5) {
      const direction = bias > 0 ? "hot" : "cold";
      chips.push({
        emoji: "🌡",
        text: `forecast ran ${Math.abs(bias).toFixed(1)}°F ${direction}`,
      });
    } else {
      chips.push({ emoji: "🌡", text: "temperature true" });
    }
  }

  if (stats?.wind.gate_agreement_pct !== null && stats?.wind.gate_agreement_pct !== undefined) {
    if (stats.wind.gate_agreement_pct >= 90) {
      chips.push({
        emoji: "🍃",
        text: `wind gate agreed ${stats.wind.gate_agreement_pct.toFixed(0)}%`,
      });
    }
  }

  if (stats?.rain) {
    chips.push({
      emoji: "🌧",
      text: `promised ${stats.rain.forecast_total_in.toFixed(2)}in · delivered ${stats.rain.actual_total_in.toFixed(2)}in`,
    });
  }

  // Latest temp/humidity for today card
  const latestObs = todayFine.length > 0 ? todayFine[todayFine.length - 1] : null;
  const latestTime = latestObs?.time_local.split(" ")[1] || "—";

  return (
    <div className="mx-auto max-w-[980px] px-5 pb-8 md:px-12">
      {/* Header */}
      <div className="pt-6 pb-3.5 md:pt-8">
        <h1 className="font-display text-[27px] font-bold leading-tight tracking-[-0.02em] text-ink lowercase">
          forecast vs. actual
        </h1>
        <p className="mt-1 text-sm text-fern">
          what the sky promised over {stationId || "your station"} — and what it delivered
        </p>
      </div>

      {/* Verdict chips */}
      {chips.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {chips.map((chip, i) => (
            <div
              key={i}
              className="inline-flex items-center gap-2 rounded-full bg-tint px-3 py-1.5 text-sm text-sec"
            >
              <span>{chip.emoji}</span>
              <span>{chip.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* No station configured callout */}
      {source === "none" && (
        <div className="card mb-6 rounded-[16px] border border-[#b7c4b3] bg-[#f3f5f1] p-4">
          <p className="mb-3 text-sm text-sec">
            add your weather underground station in settings to see real measurements here
          </p>
          <Link
            href="/settings"
            className="inline-flex press h-9 items-center gap-2 rounded-full bg-leaf px-4 font-bold text-white hover:bg-leafdark"
          >
            configure station
          </Link>
        </div>
      )}

      {/* Sky Strip */}
      {hours.length > 0 && (
        <SkyStrip hours={hours} days={comparison?.days || 3} stationId={stationId} />
      )}

      {/* Today at the station card */}
      {source === "wunderground" && todayFine.length > 0 && (
        <div className="card mb-6 p-5">
          <h2 className="mb-3 font-display text-[16px] font-semibold tracking-[-0.01em] text-sec">
            today at {stationId}
          </h2>

          {/* Big temp + humidity + time */}
          <div className="mb-4 flex items-baseline gap-3">
            <div className="font-display text-[40px] font-bold text-ink">
              {latestObs && latestObs.temp_f !== null && latestObs.temp_f !== undefined
                ? latestObs.temp_f.toFixed(0)
                : "—"}
              °
            </div>
            <div className="font-mono text-sm text-fern">
              · humidity {latestObs && latestObs.humidity !== null ? `${latestObs.humidity.toFixed(0)}%` : "—"} ·
              updated {latestTime}
            </div>
          </div>

          {/* Mini SVG with today's observations */}
          {todayFine.length > 0 && (
            <svg width="100%" height={90} style={{ display: "block" }} viewBox={`0 0 ${todayFine.length * 15} 90`} preserveAspectRatio="none">
              <defs>
                <linearGradient id="precipGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#5f9fd633" />
                  <stop offset="100%" stopColor="transparent" />
                </linearGradient>
              </defs>

              {/* Temp and humidity lines */}
              {(() => {
                const temps = todayFine.map((o) => o.temp_f).filter((t) => t !== null) as number[];
                const humidities = todayFine.map((o) => o.humidity).filter((h) => h !== null) as number[];
                const maxTemp = Math.max(...temps, 50);
                const minTemp = Math.min(...temps, 30);
                const tempRange = maxTemp - minTemp || 1;

                const getTempY = (temp: number | null) => {
                  if (temp === null) return 0;
                  return 70 - ((temp - minTemp) / tempRange) * 60;
                };

                const getHumidityY = (humidity: number | null) => {
                  if (humidity === null) return 0;
                  return 70 - (humidity / 100) * 60;
                };

                // Temp line
                const tempPath: string[] = [];
                for (let i = 0; i < todayFine.length; i++) {
                  const x = (i / (todayFine.length - 1)) * (todayFine.length * 15 - 1);
                  const y = getTempY(todayFine[i].temp_f);
                  tempPath.push(`${i === 0 ? "M" : "L"} ${x} ${y}`);
                }

                // Humidity line
                const humPath: string[] = [];
                for (let i = 0; i < todayFine.length; i++) {
                  const x = (i / (todayFine.length - 1)) * (todayFine.length * 15 - 1);
                  const y = getHumidityY(todayFine[i].humidity);
                  humPath.push(`${i === 0 ? "M" : "L"} ${x} ${y}`);
                }

                // Precip area
                const maxPrecip = Math.max(...todayFine.map((o) => o.precip_accum_in), 0.01);
                const precipPath: string[] = [`M 0 70`];
                for (let i = 0; i < todayFine.length; i++) {
                  const x = (i / (todayFine.length - 1)) * (todayFine.length * 15 - 1);
                  const y = 70 - (todayFine[i].precip_accum_in / maxPrecip) * 60;
                  precipPath.push(`L ${x} ${y}`);
                }
                precipPath.push(`L ${(todayFine.length - 1) * 15} 70`);

                return (
                  <>
                    {maxPrecip > 0 && (
                      <path d={precipPath.join(" ")} fill="url(#precipGradient)" />
                    )}
                    <path
                      d={tempPath.join(" ")}
                      stroke="#24382a"
                      strokeWidth={2}
                      fill="none"
                      vectorEffect="non-scaling-stroke"
                    />
                    <path
                      d={humPath.join(" ")}
                      stroke="#9ec9ef"
                      strokeWidth={1.5}
                      fill="none"
                      vectorEffect="non-scaling-stroke"
                    />
                  </>
                );
              })()}

              {/* Min/max labels */}
              {(() => {
                const temps = todayFine.map((o) => o.temp_f).filter((t) => t !== null) as number[];
                const maxTemp = Math.max(...temps, 50);
                const minTemp = Math.min(...temps, 30);
                return (
                  <>
                    <text x="2" y="75" fontSize={9} fontFamily="var(--font-mono)" fill="#8fa392">
                      {maxTemp.toFixed(0)}°
                    </text>
                    <text x="2" y="12" fontSize={9} fontFamily="var(--font-mono)" fill="#8fa392">
                      {minTemp.toFixed(0)}°
                    </text>
                  </>
                );
              })()}
            </svg>
          )}
        </div>
      )}

      {/* Scorecard row */}
      {stats && (
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* Temperature */}
          <div className="card p-5">
            <div className="mb-2 font-mono text-[20px] font-bold text-ink">
              {stats.temp.mae !== null ? `${stats.temp.mae.toFixed(1)}°F` : "—"}
            </div>
            <div className="text-sm text-sec">
              {stats.temp.mae !== null
                ? `average miss — ran ${stats.temp.bias !== null ? (stats.temp.bias > 0 ? "hot" : "cold") : "?"}`
                : "no comparison"}
            </div>
          </div>

          {/* Wind */}
          <div className="card p-5">
            <div className="mb-2 font-mono text-[20px] font-bold text-ink">
              {stats.wind.mae !== null
                ? `${stats.wind.mae.toFixed(1)} mph`
                : "—"}
            </div>
            <div className="text-sm text-sec">
              average miss
              {stats.wind.gate_agreement_pct !== null
                ? ` · gate agreed ${stats.wind.gate_agreement_pct.toFixed(0)}%`
                : ""}
            </div>
          </div>

          {/* Rain */}
          <div className="card p-5">
            <div className="mb-2 font-mono text-[20px] font-bold text-ink">
              {stats.rain.forecast_total_in.toFixed(2)}in
            </div>
            <div className="text-sm text-sec">
              promised · delivered {stats.rain.actual_total_in.toFixed(2)}in
            </div>
          </div>
        </div>
      )}

      {/* Divider */}
      <div className="mb-6 border-t border-hairline" />

      {/* Day by day section (from accuracy API) */}
      <h2 className="mb-4 font-display text-[16px] font-semibold tracking-[-0.01em] text-sec">
        day by day
      </h2>

      {accuracy?.days_data && accuracy.days_data.some((d) => d.predicted_rain_in !== null || d.actual_rain_in !== null) && (
        <div className="card mb-6 p-5">
          {/* Rain accuracy card */}
          <div className="space-y-3">
            {accuracy.days_data.map((day) => {
              const showDay =
                day.predicted_rain_in !== null || day.actual_rain_in !== null;
              if (!showDay) return null;

              const maxRainInView = Math.max(
                ...accuracy.days_data.map((d) =>
                  Math.max(d.predicted_rain_in || 0, d.actual_rain_in || 0)
                )
              );
              const rainScale = maxRainInView > 0 ? maxRainInView : 1;

              const predictedWidth = day.predicted_rain_in
                ? (day.predicted_rain_in / rainScale) * 100
                : 0;
              const actualWidth = day.actual_rain_in
                ? (day.actual_rain_in / rainScale) * 100
                : 0;

              return (
                <div key={day.date}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-display text-[14px] font-semibold text-ink">
                      {dayName(day.date)}
                    </span>
                  </div>

                  {/* Predicted bar */}
                  {day.predicted_rain_in !== null ? (
                    <div className="mb-1 flex items-center gap-2">
                      <div
                        className="flex-1 rounded-[6px] bg-rain transition-all"
                        style={{ width: `${Math.max(2, predictedWidth)}%`, height: "20px" }}
                      />
                      <span className="font-mono text-[12px] w-12 text-right text-fern">
                        {day.predicted_rain_in.toFixed(2)}"
                      </span>
                    </div>
                  ) : (
                    <div className="mb-1 text-[12px] text-fern italic">
                      no snapshot yet
                    </div>
                  )}

                  {/* Actual bar */}
                  {day.actual_rain_in !== null ? (
                    <div className="flex items-center gap-2">
                      <div
                        className="flex-1 rounded-[6px] bg-leaf transition-all"
                        style={{ width: `${Math.max(2, actualWidth)}%`, height: "20px" }}
                      />
                      <span className="font-mono text-[12px] w-12 text-right text-fern">
                        {day.actual_rain_in.toFixed(2)}"
                      </span>
                    </div>
                  ) : source === "wunderground" ? (
                    <div className="text-[12px] text-fern">—</div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {/* Rain accuracy scorecard */}
          {accuracy.hits && accuracy.hits.comparable_days > 0 && (
            <div className="mt-4 border-t border-hairline pt-3">
              <p className="text-sm text-sec">
                rain called right on {accuracy.hits.rain_called_right} of{" "}
                {accuracy.hits.comparable_days} days
                {accuracy.hits.misses > 0 && ` · ${accuracy.hits.misses} misses`}
                {accuracy.hits.false_alarms > 0 &&
                  ` · ${accuracy.hits.false_alarms} false alarms`}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Temperature & Wind card */}
      {accuracy?.days_data &&
        accuracy.days_data.some(
          (d) => d.predicted_high_f !== null || d.actual_high_f !== null
        ) && (
          <div className="card p-5">
            <div className="space-y-2">
              {accuracy.days_data.map((day) => {
                const showDay =
                  day.predicted_high_f !== null || day.actual_high_f !== null;
                if (!showDay) return null;

                const tempDelta =
                  day.predicted_high_f !== null && day.actual_high_f !== null
                    ? day.actual_high_f - day.predicted_high_f
                    : null;
                const windDelta =
                  day.predicted_wind_max !== null && day.actual_wind_max !== null
                    ? day.actual_wind_max - day.predicted_wind_max
                    : null;

                return (
                  <div key={day.date} className="flex justify-between text-sm py-1.5">
                    <span className="text-fern font-display">{dayName(day.date)}</span>
                    <div className="flex gap-4">
                      {day.predicted_high_f !== null ? (
                        <span className="font-mono text-ink">
                          {day.predicted_high_f.toFixed(0)}°F
                          {tempDelta !== null && (
                            <span
                              className={
                                tempDelta > 0
                                  ? "text-clay"
                                  : tempDelta < 0
                                    ? "text-leaf"
                                    : "text-fern"
                              }
                            >
                              {" "}
                              ({tempDelta > 0 ? "+" : ""}
                              {tempDelta.toFixed(0)}°)
                            </span>
                          )}
                          {day.actual_high_f === null &&
                            source === "wunderground" && (
                              <span className="text-fern"> → —</span>
                            )}
                        </span>
                      ) : (
                        <span className="text-fern italic">no snapshot</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
    </div>
  );
}

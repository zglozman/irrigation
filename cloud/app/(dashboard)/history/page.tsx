"use client";

import { useEffect, useState } from "react";
import { DayRecord, HourRecord, MonthRecord, YearStatistics } from "@/lib/station-history";

interface YearHistoryData {
  year: number;
  days: DayRecord[];
  records: YearStatistics;
  monthly: MonthRecord[];
}

interface DayDetailData {
  date: string;
  hours: HourRecord[];
}

function dayOfWeek(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return days[d.getDay()];
}

function formatMonthLabel(monthNum: number): string {
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  return months[monthNum - 1] || "";
}

// Rain calendar cell color by precipitation
function getRainColor(rainIn: number): string {
  if (rainIn < 0.01) return "#eef3ec"; // 0 → very light
  if (rainIn < 0.1) return "#dbeafe"; // drizzle
  if (rainIn < 0.35) return "#9ec9ef"; // light
  if (rainIn < 0.75) return "#5f9fd6"; // moderate
  return "#2f6fa8"; // heavy
}

export default function HistoryPage() {
  const [years, setYears] = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getUTCFullYear());
  const [history, setHistory] = useState<YearHistoryData | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayDetail, setDayDetail] = useState<DayDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dayDetailLoading, setDayDetailLoading] = useState(false);
  const [error, setError] = useState("");

  // Fetch available years on mount
  useEffect(() => {
    const fetchYears = async () => {
      try {
        const res = await fetch("/api/history/station");
        if (!res.ok) throw new Error("Failed to load years");
        const data = await res.json();
        setYears(data.available_years || []);
        // Set current year from fetched data
        if (data.current_year_history) {
          setHistory(data.current_year_history);
          setSelectedYear(data.current_year_history.year);
        }
        setLoading(false);
      } catch (err) {
        console.error("Error fetching years:", err);
        setError("Failed to load historical data");
        setLoading(false);
      }
    };

    fetchYears();
  }, []);

  // Fetch year history when year changes
  useEffect(() => {
    const fetchYear = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/history/station?year=${selectedYear}`);
        if (!res.ok) throw new Error("Failed to load year");
        const data = await res.json();
        setHistory(data);
        setSelectedDate(null);
        setDayDetail(null);
        setError("");
      } catch (err) {
        console.error("Error fetching year:", err);
        setError("Failed to load year data");
      } finally {
        setLoading(false);
      }
    };

    fetchYear();
  }, [selectedYear]);

  // Fetch day detail when date is selected
  useEffect(() => {
    if (!selectedDate) {
      setDayDetail(null);
      return;
    }

    const fetchDay = async () => {
      try {
        setDayDetailLoading(true);
        const res = await fetch(`/api/history/station?date=${selectedDate}`);
        if (!res.ok) throw new Error("Failed to load day");
        const data = await res.json();
        setDayDetail(data);
      } catch (err) {
        console.error("Error fetching day:", err);
        setDayDetail(null);
      } finally {
        setDayDetailLoading(false);
      }
    };

    fetchDay();
  }, [selectedDate]);

  if (loading || !history) {
    return (
      <div className="mx-auto max-w-[980px] px-5 pb-8 md:px-12">
        <div className="pt-6 pb-3.5 md:pt-8">
          <h1 className="font-display text-[27px] font-bold leading-tight tracking-[-0.02em] text-ink lowercase">
            the almanac
          </h1>
          <p className="mt-1 text-sm text-fern">
            everything the sky has done over this garden
          </p>
        </div>
        <div className="flex items-center justify-center p-8">
          <p className="text-fern">loading your history…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-[980px] px-5 pb-8 md:px-12">
        <div className="pt-6 pb-3.5 md:pt-8">
          <h1 className="font-display text-[27px] font-bold leading-tight tracking-[-0.02em] text-ink lowercase">
            the almanac
          </h1>
        </div>
        <div className="rounded-[16px] bg-claytint p-4 text-sm text-clay">{error}</div>
      </div>
    );
  }

  const { days, records, monthly } = history;
  const rainTotal = records.rain_total_in;
  const rainyDays = records.rain_days;

  // Group days by week for calendar grid
  const weeks: DayRecord[][] = [];
  let currentWeek: DayRecord[] = [];

  // Pad start of first week
  if (days.length > 0) {
    const firstDate = new Date(days[0].date + "T00:00:00Z");
    const firstDay = firstDate.getUTCDay();
    for (let i = 0; i < firstDay; i++) {
      currentWeek.push({
        date: "",
        t_min: 0,
        t_max: 0,
        t_avg: 0,
        rain_in: 0,
        wind_max: 0,
        hum_avg: 0,
      });
    }
  }

  for (const day of days) {
    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
    currentWeek.push(day);
  }

  // Pad end of last week
  while (currentWeek.length > 0 && currentWeek.length < 7) {
    currentWeek.push({
      date: "",
      t_min: 0,
      t_max: 0,
      t_avg: 0,
      rain_in: 0,
      wind_max: 0,
      hum_avg: 0,
    });
  }

  if (currentWeek.length > 0) {
    weeks.push(currentWeek);
  }

  // Temperature ribbon bounds
  const validTemps = days
    .filter((d) => d.t_min !== 0 || d.t_max !== 0)
    .flatMap((d) => [d.t_min, d.t_max]);
  const tempMin = validTemps.length > 0 ? Math.floor(Math.min(...validTemps)) : 32;
  const tempMax = validTemps.length > 0 ? Math.ceil(Math.max(...validTemps)) : 90;
  const tempRange = Math.max(tempMax - tempMin, 1);

  const getTempY = (temp: number): number => {
    return ((temp - tempMin) / tempRange) * 100;
  };

  return (
    <div className="mx-auto max-w-[980px] px-5 pb-8 md:px-12">
      {/* Header */}
      <div className="pt-6 pb-3.5 md:pt-8">
        <h1 className="font-display text-[27px] font-bold leading-tight tracking-[-0.02em] text-ink lowercase">
          the almanac
        </h1>
        <p className="mt-1 text-sm text-fern">
          everything the sky has done over this garden since 2020
        </p>
      </div>

      {/* Year Selector */}
      <div className="mb-6 flex flex-wrap gap-2">
        {years.map((year) => (
          <button
            key={year}
            onClick={() => setSelectedYear(year)}
            className={`press h-11 rounded-full px-4 text-sm font-semibold transition-colors ${
              selectedYear === year
                ? "bg-tint text-leaf"
                : "bg-white text-sec hover:bg-tint/60"
            }`}
            style={
              selectedYear === year
                ? { backgroundColor: "#e3f2e0" }
                : undefined
            }
          >
            {year}
          </button>
        ))}
      </div>

      {/* Rain Calendar */}
      <div className="card mb-6 overflow-x-auto p-5 rounded-[20px]">
        <div className="mb-4 flex items-center gap-3">
          <h2 className="font-display text-[16px] font-semibold tracking-[-0.01em] text-sec">
            rain calendar
          </h2>
        </div>

        {/* Labels + grid share one fixed-width unit so the month labels stay
            column-aligned and the whole calendar scrolls together — a flex-1
            label row sizes to the VISIBLE width, not the scroll width, and
            drifts hopelessly out of alignment past the first screenful. */}
        <div style={{ width: "max-content" }}>
          {/* Month labels — one cell per week column (12px + 4px gap) */}
          <div className="mb-2 flex gap-2">
            <div className="w-8 shrink-0" />
            <div className="flex gap-1">
              {weeks.map((week, weekIdx) => {
                const firstDayInWeek = week.find((d) => d.date);
                if (!firstDayInWeek) {
                  return <div key={`month-label-${weekIdx}`} className="w-3" />;
                }
                const [, month] = firstDayInWeek.date.split("-");
                const isFirstWeekOfMonth =
                  weekIdx === 0 ||
                  (weeks[weekIdx - 1] &&
                    !weeks[weekIdx - 1]
                      .find((d) => d.date)
                      ?.date?.startsWith(`${history.year}-${month}`));
                return (
                  <div
                    key={`month-label-${weekIdx}`}
                    className="w-3 overflow-visible whitespace-nowrap text-[9px] font-mono text-fern"
                  >
                    {isFirstWeekOfMonth ? formatMonthLabel(Number(month)) : ""}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Calendar grid */}
          <div className="flex gap-2">
            {/* Day labels (mon-sun) */}
            <div className="flex flex-col gap-1">
              {["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => (
                <div
                  key={day}
                  className="h-3 w-8 text-center text-[9px] font-mono text-fern"
                >
                  {day}
                </div>
              ))}
            </div>

            {/* Weeks */}
            <div className="flex gap-1">
              {weeks.map((week, weekIdx) => (
                <div key={`week-${weekIdx}`} className="flex flex-col gap-1">
                  {week.map((day, dayIdx) => (
                    <button
                      key={`${weekIdx}-${dayIdx}`}
                      onClick={() => day.date && setSelectedDate(day.date)}
                      disabled={!day.date}
                      className="transition-opacity hover:opacity-80 disabled:cursor-default"
                      style={{
                        width: "12px",
                        height: "12px",
                        borderRadius: "3px",
                        backgroundColor: day.date ? getRainColor(day.rain_in) : "transparent",
                        cursor: day.date ? "pointer" : "default",
                      }}
                      title={day.date ? `${day.date}: ${day.rain_in.toFixed(2)}"` : ""}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-3">
            <div className="flex gap-1">
              {[
                { color: "#eef3ec", label: "0" },
                { color: "#dbeafe", label: "<0.1" },
                { color: "#9ec9ef", label: "<0.35" },
                { color: "#5f9fd6", label: "<0.75" },
                { color: "#2f6fa8", label: "≥0.75" },
              ].map(({ color, label }) => (
                <div key={label} className="flex flex-col items-center gap-1">
                  <div
                    className="rounded-sm"
                    style={{
                      width: "16px",
                      height: "16px",
                      backgroundColor: color,
                    }}
                  />
                  <span className="text-[9px] font-mono text-fern">{label}</span>
                </div>
              ))}
            </div>
            <span className="text-sm text-sec">drizzle → downpour</span>
          </div>
          <div className="font-mono text-sm text-fern">
            {rainTotal.toFixed(2)} in over {rainyDays} rainy days
          </div>
        </div>
      </div>

      {/* Temperature Ribbon */}
      <div className="card mb-6 p-5 rounded-[20px]">
        <h2 className="mb-3 font-display text-[16px] font-semibold tracking-[-0.01em] text-sec">
          temperature band
        </h2>
        <svg width="100%" height={120} viewBox={`0 0 ${days.length} 100`} preserveAspectRatio="none">
          {/* Freeze line at 32°F if needed */}
          {tempMin < 36 && (
            <line
              x1={0}
              y1={getTempY(32)}
              x2={days.length}
              y2={getTempY(32)}
              stroke="#9ec9ef"
              strokeWidth={0.5}
              strokeDasharray="0.5,1"
            />
          )}

          {/* Temperature band */}
          {(() => {
            const minPath: string[] = [];
            const maxPath: string[] = [];

            for (let i = 0; i < days.length; i++) {
              const day = days[i];
              const minY = getTempY(day.t_min);
              const maxY = getTempY(day.t_max);
              const avgY = getTempY(day.t_avg);

              if (i === 0) {
                minPath.push(`M ${i} ${minY}`);
                maxPath.push(`M ${i} ${maxY}`);
              } else {
                minPath.push(`L ${i} ${minY}`);
                maxPath.push(`L ${i} ${maxY}`);
              }
            }

            // Close the path to form the band
            for (let i = days.length - 1; i >= 0; i--) {
              const day = days[i];
              const maxY = getTempY(day.t_max);
              maxPath.push(`L ${i} ${maxY}`);
            }

            // Avg line
            const avgPath: string[] = [];
            for (let i = 0; i < days.length; i++) {
              const day = days[i];
              const avgY = getTempY(day.t_avg);
              if (i === 0) {
                avgPath.push(`M ${i} ${avgY}`);
              } else {
                avgPath.push(`L ${i} ${avgY}`);
              }
            }

            return (
              <>
                {/* Band fill */}
                <path
                  d={`${minPath.join(" ")} L ${days.length - 1} ${getTempY(days[days.length - 1].t_max)} ${maxPath.join(" ")} Z`}
                  fill="#e9b94933"
                />
                {/* Average line */}
                <path
                  d={avgPath.join(" ")}
                  stroke="#24382a"
                  strokeWidth={1.5}
                  fill="none"
                  vectorEffect="non-scaling-stroke"
                />
              </>
            );
          })()}
        </svg>
        <div className="mt-2 font-mono text-[12px] text-fern">
          low {tempMin}° · high {tempMax}°
        </div>
      </div>

      {/* Day Drawer */}
      {selectedDate && dayDetail && (
        <div className="card mb-6 p-5 rounded-[20px] bg-white">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-[16px] font-semibold tracking-[-0.01em] text-sec">
              {dayOfWeek(selectedDate)} · {selectedDate.split("-")[1]}{" "}
              {selectedDate.split("-")[2]} {selectedDate.split("-")[0]}
            </h2>
            <button
              onClick={() => setSelectedDate(null)}
              className="press flex h-11 w-11 items-center justify-center rounded-full text-fern hover:bg-tint"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          {/* Day summary */}
          {dayDetail.hours.length > 0 && (() => {
            const temps = dayDetail.hours
              .map((h) => h.temp_f)
              .filter((t) => t !== null);
            const maxTemp = temps.length > 0 ? Math.max(...temps) : 0;
            const minTemp = temps.length > 0 ? Math.min(...temps) : 0;
            const totalRain = dayDetail.hours.reduce((sum, h) => sum + (h.precip_hourly_in || 0), 0);
            const maxWind = Math.max(
              ...dayDetail.hours.map((h) => h.wind_high_mph || 0)
            );

            return (
              <div className="mb-4 font-mono text-sm text-sec">
                high {maxTemp}° · low {minTemp}° · {totalRain.toFixed(2)} in rain ·
                gusts {maxWind} mph
              </div>
            );
          })()}

          {/* Hourly chart */}
          {dayDetailLoading ? (
            <div className="flex items-center justify-center p-4">
              <p className="text-fern">loading…</p>
            </div>
          ) : (
            <svg
              width="100%"
              height={110}
              viewBox={`0 0 ${dayDetail.hours.length * 15} 110`}
              preserveAspectRatio="none"
            >
              {(() => {
                const temps = dayDetail.hours
                  .map((h) => h.temp_f)
                  .filter((t) => t !== null) as number[];
                const maxTemp = Math.max(...temps, 50);
                const minTemp = Math.min(...temps, 30);
                const tempRange = maxTemp - minTemp || 1;

                const getTempY = (temp: number | null) => {
                  if (temp === null) return 0;
                  return 80 - ((temp - minTemp) / tempRange) * 60;
                };

                // Temp line
                const tempPath: string[] = [];
                for (let i = 0; i < dayDetail.hours.length; i++) {
                  const x = (i / (dayDetail.hours.length - 1)) * (dayDetail.hours.length * 15 - 1);
                  const y = getTempY(dayDetail.hours[i].temp_f);
                  tempPath.push(`${i === 0 ? "M" : "L"} ${x} ${y}`);
                }

                // Rain bars
                const maxRain = Math.max(
                  ...dayDetail.hours.map((h) => h.precip_hourly_in || 0),
                  0.01
                );

                return (
                  <>
                    {/* Rain bars */}
                    {dayDetail.hours.map((hour, i) => {
                      if (!hour.precip_hourly_in || hour.precip_hourly_in <= 0) return null;
                      const x = (i / dayDetail.hours.length) * (dayDetail.hours.length * 15);
                      const width = 15;
                      const height = (hour.precip_hourly_in / maxRain) * 40;
                      const y = 80 - height;
                      return (
                        <rect
                          key={`rain-${i}`}
                          x={x}
                          y={y}
                          width={width - 1}
                          height={height}
                          fill="#5f9fd6"
                        />
                      );
                    })}
                    {/* Temp line */}
                    <path
                      d={tempPath.join(" ")}
                      stroke="#24382a"
                      strokeWidth={1.5}
                      fill="none"
                      vectorEffect="non-scaling-stroke"
                    />
                  </>
                );
              })()}
            </svg>
          )}
        </div>
      )}

      {/* Records Shelf */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {records.wettest_day && (
          <div className="card rounded-[16px] p-4">
            <div className="text-[12px] text-sec">wettest day</div>
            <div className="font-mono text-[14px] font-bold text-ink">
              {records.wettest_day.date}
            </div>
            <div className="font-mono text-sm text-fern">
              {records.wettest_day.rain_in.toFixed(2)} in
            </div>
          </div>
        )}

        {records.hottest_day && (
          <div className="card rounded-[16px] p-4">
            <div className="text-[12px] text-sec">hottest</div>
            <div className="font-mono text-[14px] font-bold text-ink">
              {records.hottest_day.date}
            </div>
            <div className="font-mono text-sm text-fern">
              {records.hottest_day.t_max}°
            </div>
          </div>
        )}

        {records.coldest_morning && (
          <div className="card rounded-[16px] p-4">
            <div className="text-[12px] text-sec">coldest morning</div>
            <div className="font-mono text-[14px] font-bold text-ink">
              {records.coldest_morning.date}
            </div>
            <div className="font-mono text-sm text-fern">
              {records.coldest_morning.t_min}°
            </div>
          </div>
        )}

        {records.windiest_day && (
          <div className="card rounded-[16px] p-4">
            <div className="text-[12px] text-sec">windiest</div>
            <div className="font-mono text-[14px] font-bold text-ink">
              {records.windiest_day.date}
            </div>
            <div className="font-mono text-sm text-fern">
              {records.windiest_day.wind_max} mph
            </div>
          </div>
        )}

        {records.longest_dry_spell && (
          <div className="card rounded-[16px] p-4">
            <div className="text-[12px] text-sec">longest dry spell</div>
            <div className="font-mono text-[14px] font-bold text-ink">
              {records.longest_dry_spell.days} days
            </div>
            <div className="font-mono text-[11px] text-fern">
              {records.longest_dry_spell.start} → {records.longest_dry_spell.end}
            </div>
          </div>
        )}
      </div>

      {/* Monthly Table */}
      <div className="card rounded-[20px] p-5">
        <h2 className="mb-4 font-display text-[16px] font-semibold tracking-[-0.01em] text-sec">
          month by month
        </h2>
        <div className="space-y-2">
          {monthly.map((month) => {
            const maxMonthRain = Math.max(...monthly.map((m) => m.rain_in), 0.5);
            const rainWidth = (month.rain_in / maxMonthRain) * 100;
            return (
              <div key={month.month} className="flex items-center gap-3">
                <div className="w-12 text-[12px] font-bold text-sec">
                  {formatMonthLabel(month.month)}
                </div>
                <div className="flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <div
                      className="h-5 rounded-[4px] bg-rain transition-all"
                      style={{ width: `${rainWidth}%` }}
                    />
                    <span className="w-12 font-mono text-[11px] text-right text-fern">
                      {month.rain_in.toFixed(1)}"
                    </span>
                  </div>
                  <div className="font-mono text-[11px] text-fern">
                    {month.t_min.toFixed(0)}° – {month.t_max.toFixed(0)}°
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

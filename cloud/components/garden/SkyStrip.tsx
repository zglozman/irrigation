"use client";

import React, { useState, useRef } from "react";
import { HourlyComparison } from "@/lib/weather-compare";

interface SkyStripProps {
  hours: HourlyComparison[];
  days: number;
  stationId: string | null;
}

const SkyStrip: React.FC<SkyStripProps> = ({ hours, days, stationId }) => {
  const [hoveredHourIndex, setHoveredHourIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Get date boundaries from hours
  const dateMap = new Map<string, number[]>(); // date -> hour indices
  hours.forEach((h, i) => {
    if (!dateMap.has(h.day_local)) {
      dateMap.set(h.day_local, []);
    }
    dateMap.get(h.day_local)!.push(i);
  });
  const datesInOrder = Array.from(dateMap.keys()).sort();

  // SVG dimensions
  const hourWidth = 280 / 24; // 280px per day
  const totalWidth = days * 280;
  const totalHeight = 400; // 3 lanes: temp 150, rain 110, wind 100, plus gutters
  const gutter = 40;

  const tempLaneY = gutter;
  const tempLaneHeight = 150;
  const rainLaneY = tempLaneY + tempLaneHeight + 20;
  const rainLaneHeight = 110;
  const windLaneY = rainLaneY + rainLaneHeight + 20;
  const windLaneHeight = 100;

  // X-axis mapping: linear across all hours
  const getX = (hourIndex: number): number => hourIndex * hourWidth;

  // Temp bounds
  const allTemps = hours
    .map((h) => [h.f_temp, h.a_temp])
    .flat()
    .filter((t) => t !== null) as number[];
  const tempMin = Math.floor(Math.min(...allTemps, 50));
  const tempMax = Math.ceil(Math.max(...allTemps, 90));
  const tempRange = tempMax - tempMin;
  const getTempY = (temp: number | null) => {
    if (temp === null) return 0;
    return tempLaneY + tempLaneHeight - ((temp - tempMin) / tempRange) * tempLaneHeight;
  };

  // Rain bounds
  const maxRain = Math.max(
    ...hours.map((h) => Math.max(h.f_precip_in ?? 0, h.a_precip_in ?? 0))
  );
  const rainScale = maxRain > 0 ? maxRain : 0.1;
  const getRainY = (rain: number | null, isActual: boolean): number => {
    if (rain === null) return rainLaneY + rainLaneHeight / 2;
    const normalized = Math.min(rain / rainScale, 1);
    if (isActual) {
      return rainLaneY + rainLaneHeight / 2 + (normalized * rainLaneHeight) / 2;
    } else {
      return rainLaneY + rainLaneHeight / 2 - (normalized * rainLaneHeight) / 2;
    }
  };

  // Wind bounds
  const maxWind = Math.max(...hours.map((h) => Math.max(h.f_wind ?? 0, h.a_wind ?? 0)), 10);
  const windScale = Math.max(maxWind, 20);
  const getWindY = (wind: number | null): number => {
    if (wind === null) return windLaneY + windLaneHeight / 2;
    const normalized = Math.min(wind / windScale, 1);
    return windLaneY + windLaneHeight - normalized * windLaneHeight;
  };

  // Get hovered hour data
  const hoveredHour = hoveredHourIndex !== null ? hours[hoveredHourIndex] : null;
  const hoveredX = hoveredHourIndex !== null ? getX(hoveredHourIndex) : 0;

  // Format hour label
  const formatHourLabel = (time: string, day: string): string => {
    try {
      const date = new Date(time);
      const hours = date.getUTCHours();
      const dayName = new Date(day + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short" });
      const dayNum = parseInt(day.split("-")[2], 10);
      const isToday = new Date().toLocaleDateString("en-CA") === day;
      return `${isToday ? "today" : dayName} ${hours}:00`;
    } catch {
      return "—";
    }
  };

  return (
    <div
      className="card mb-6 overflow-x-auto rounded-[20px] p-0"
      ref={containerRef}
      onPointerLeave={() => setHoveredHourIndex(null)}
    >
      <svg
        ref={svgRef}
        width={totalWidth}
        height={totalHeight}
        style={{
          minWidth: `${totalWidth}px`,
          display: "block",
          userSelect: "none",
        }}
        onPointerMove={(e) => {
          if (!svgRef.current) return;
          const rect = svgRef.current.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const hourIndex = Math.round(x / hourWidth);
          if (hourIndex >= 0 && hourIndex < hours.length) {
            setHoveredHourIndex(hourIndex);
          }
        }}
      >
        <defs>
          <linearGradient id="tempGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#57b46f2e" />
            <stop offset="100%" stopColor="transparent" />
          </linearGradient>
          <pattern id="nightPattern" patternUnits="userSpaceOnUse" width={hourWidth * 24} height={totalHeight}>
            {Array.from({ length: 24 }, (_, h) => {
              const isNight = h < 7 || h >= 20;
              return isNight ? (
                <rect
                  key={h}
                  x={h * hourWidth}
                  y={0}
                  width={hourWidth}
                  height={totalHeight}
                  fill="#24382a08"
                />
              ) : null;
            })}
          </pattern>
        </defs>

        {/* Background night pattern */}
        <rect x={0} y={0} width={totalWidth} height={totalHeight} fill="url(#nightPattern)" />

        {/* Day boundaries */}
        {datesInOrder.map((date, i) => {
          if (i === 0) return null; // Skip first boundary
          const startIdx = (dateMap.get(datesInOrder[i - 1]) || [])[0] || 0;
          const endIdx = (dateMap.get(date) || [])[0] || 0;
          const x = getX(endIdx);
          return (
            <line
              key={`boundary-${date}`}
              x1={x}
              y1={0}
              x2={x}
              y2={totalHeight}
              stroke="#e2ebe0"
              strokeWidth={1}
            />
          );
        })}

        {/* Day labels in top gutter */}
        {datesInOrder.map((date, i) => {
          const indices = dateMap.get(date) || [];
          if (indices.length === 0) return null;
          const centerIdx = indices[12] || indices[0];
          const x = getX(centerIdx);
          const dayName = new Date(date + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short" });
          const dayNum = parseInt(date.split("-")[2], 10);
          const isToday = new Date().toLocaleDateString("en-CA") === date;
          const label = isToday ? "today" : `${dayName} ${dayNum}`;

          return (
            <text
              key={`day-label-${date}`}
              x={x}
              y={20}
              textAnchor="middle"
              fontSize={10}
              fontFamily="var(--font-mono)"
              fill="#79907e"
              fontWeight={400}
            >
              {label}
            </text>
          );
        })}

        {/* TEMPERATURE LANE */}
        <g>
          {/* Actual temp area fill + line */}
          {(() => {
            const path: string[] = [];
            let inPath = false;
            for (let i = 0; i < hours.length; i++) {
              const h = hours[i];
              const x = getX(i);
              const y = getTempY(h.a_temp);
              if (h.a_temp !== null) {
                if (!inPath) {
                  path.push(`M ${x} ${tempLaneY + tempLaneHeight}`);
                  inPath = true;
                }
                path.push(`L ${x} ${y}`);
              } else {
                if (inPath) {
                  path.push(`L ${getX(i - 1)} ${tempLaneY + tempLaneHeight}`);
                  inPath = false;
                }
              }
            }
            if (inPath) {
              path.push(`L ${getX(hours.length - 1)} ${tempLaneY + tempLaneHeight}`);
            }

            return (
              <>
                <path d={path.join(" ")} fill="url(#tempGradient)" />
                {/* Actual temp line */}
                {(() => {
                  const linePath: string[] = [];
                  let lineInPath = false;
                  for (let i = 0; i < hours.length; i++) {
                    const h = hours[i];
                    const x = getX(i);
                    const y = getTempY(h.a_temp);
                    if (h.a_temp !== null) {
                      if (!lineInPath) {
                        linePath.push(`M ${x} ${y}`);
                        lineInPath = true;
                      } else {
                        linePath.push(`L ${x} ${y}`);
                      }
                    } else {
                      lineInPath = false;
                    }
                  }
                  return (
                    <path
                      d={linePath.join(" ")}
                      stroke="#24382a"
                      strokeWidth={2.5}
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  );
                })()}
              </>
            );
          })()}

          {/* Forecast temp dashed line */}
          {(() => {
            const linePath: string[] = [];
            let lineInPath = false;
            for (let i = 0; i < hours.length; i++) {
              const h = hours[i];
              const x = getX(i);
              const y = getTempY(h.f_temp);
              if (h.f_temp !== null) {
                if (!lineInPath) {
                  linePath.push(`M ${x} ${y}`);
                  lineInPath = true;
                } else {
                  linePath.push(`L ${x} ${y}`);
                }
              } else {
                lineInPath = false;
              }
            }
            return (
              <path
                d={linePath.join(" ")}
                stroke="#e9b949"
                strokeWidth={2}
                fill="none"
                strokeDasharray="6 4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })()}

          {/* Difference bars */}
          {hours.map((h, i) => {
            if (h.f_temp === null || h.a_temp === null) return null;
            if (h.f_temp === h.a_temp) return null;
            const x = getX(i);
            const y1 = getTempY(h.f_temp);
            const y2 = getTempY(h.a_temp);
            const isForecastHotter = h.f_temp > h.a_temp;
            return (
              <line
                key={`diff-temp-${i}`}
                x1={x}
                y1={Math.min(y1, y2)}
                x2={x}
                y2={Math.max(y1, y2)}
                stroke={isForecastHotter ? "#d2674322" : "#9ec9ef2e"}
                strokeWidth={3}
              />
            );
          })}

          {/* Left gutter labels */}
          <text x={5} y={tempLaneY + 15} fontSize={9} fontFamily="var(--font-mono)" fill="#8fa392">
            {tempMax}°F
          </text>
          <text
            x={5}
            y={tempLaneY + tempLaneHeight - 5}
            fontSize={9}
            fontFamily="var(--font-mono)"
            fill="#8fa392"
          >
            {tempMin}°F
          </text>
        </g>

        {/* RAIN LANE */}
        <g>
          {/* Forecast rain probability background */}
          {(() => {
            const path: string[] = [];
            let inPath = false;
            for (let i = 0; i < hours.length; i++) {
              const h = hours[i];
              const x = getX(i);
              const prob = h.f_prob ?? 0;
              const normalized = Math.min(prob / 100, 1);
              const y = rainLaneY + rainLaneHeight / 2 - (normalized * rainLaneHeight) / 2;
              if (h.f_prob !== null) {
                if (!inPath) {
                  path.push(`M ${x} ${rainLaneY + rainLaneHeight / 2}`);
                  inPath = true;
                }
                path.push(`L ${x} ${y}`);
              } else {
                if (inPath) {
                  path.push(`L ${getX(i - 1)} ${rainLaneY + rainLaneHeight / 2}`);
                  inPath = false;
                }
              }
            }
            if (inPath) {
              path.push(`L ${getX(hours.length - 1)} ${rainLaneY + rainLaneHeight / 2}`);
            }
            path.push(`L ${getX(hours.length - 1)} ${rainLaneY + rainLaneHeight / 2}`);

            return <path d={path.join(" ")} fill="#9ec9ef1f" />;
          })()}

          {/* Forecast and actual rain bars */}
          {hours.map((h, i) => {
            const x = getX(i) + 2;
            const barWidth = hourWidth - 4;

            return (
              <g key={`rain-${i}`}>
                {/* Forecast UP */}
                {h.f_precip_in !== null && h.f_precip_in > 0 && (
                  <rect
                    x={x}
                    y={getRainY(h.f_precip_in, false)}
                    width={barWidth}
                    height={
                      rainLaneY + rainLaneHeight / 2 - getRainY(h.f_precip_in, false)
                    }
                    fill="#9ec9ef66"
                    stroke="#9ec9ef"
                    strokeWidth={1}
                  />
                )}
                {/* Actual DOWN */}
                {h.a_precip_in !== null && h.a_precip_in > 0 && (
                  <rect
                    x={x}
                    y={rainLaneY + rainLaneHeight / 2}
                    width={barWidth}
                    height={
                      getRainY(h.a_precip_in, true) -
                      (rainLaneY + rainLaneHeight / 2)
                    }
                    fill="#5f9fd6"
                  />
                )}
              </g>
            );
          })}

          {/* Day cumulative captions at boundary tops */}
          {datesInOrder.map((date, dateIdx) => {
            const indices = dateMap.get(date) || [];
            if (indices.length === 0) return null;

            let forecastTotal = 0;
            let actualTotal = 0;
            for (const idx of indices) {
              if (hours[idx].f_precip_in !== null) forecastTotal += hours[idx].f_precip_in;
              if (hours[idx].a_precip_in !== null) actualTotal += hours[idx].a_precip_in;
            }

            const x = getX(indices[0]);
            return (
              <text
                key={`rain-label-${date}`}
                x={x + 5}
                y={rainLaneY + 12}
                fontSize={9}
                fontFamily="var(--font-mono)"
                fill="#8fa392"
              >
                {forecastTotal.toFixed(2)}in · {actualTotal.toFixed(2)}in
              </text>
            );
          })}

          {/* Left gutter label */}
          <text
            x={5}
            y={rainLaneY + rainLaneHeight / 2 + 15}
            fontSize={9}
            fontFamily="var(--font-mono)"
            fill="#8fa392"
          >
            forecast ↑ / measured ↓
          </text>
        </g>

        {/* WIND LANE */}
        <g>
          {/* Actual wind line */}
          {(() => {
            const linePath: string[] = [];
            let lineInPath = false;
            for (let i = 0; i < hours.length; i++) {
              const h = hours[i];
              const x = getX(i);
              const y = getWindY(h.a_wind);
              if (h.a_wind !== null) {
                if (!lineInPath) {
                  linePath.push(`M ${x} ${y}`);
                  lineInPath = true;
                } else {
                  linePath.push(`L ${x} ${y}`);
                }
              } else {
                lineInPath = false;
              }
            }
            return (
              <path
                d={linePath.join(" ")}
                stroke="#57b46f"
                strokeWidth={2}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })()}

          {/* Forecast wind dashed line */}
          {(() => {
            const linePath: string[] = [];
            let lineInPath = false;
            for (let i = 0; i < hours.length; i++) {
              const h = hours[i];
              const x = getX(i);
              const y = getWindY(h.f_wind);
              if (h.f_wind !== null) {
                if (!lineInPath) {
                  linePath.push(`M ${x} ${y}`);
                  lineInPath = true;
                } else {
                  linePath.push(`L ${x} ${y}`);
                }
              } else {
                lineInPath = false;
              }
            }
            return (
              <path
                d={linePath.join(" ")}
                stroke="#b7c4b3"
                strokeWidth={2}
                fill="none"
                strokeDasharray="6 4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })()}

          {/* 10 mph threshold line */}
          {(() => {
            const y = getWindY(10);
            return (
              <>
                <line
                  x1={0}
                  y1={y}
                  x2={totalWidth}
                  y2={y}
                  stroke="#d26743"
                  strokeWidth={1.5}
                  strokeDasharray="3 4"
                />
                <text
                  x={totalWidth - 5}
                  y={y - 4}
                  fontSize={9}
                  fontFamily="var(--font-mono)"
                  fill="#d26743"
                  textAnchor="end"
                >
                  skip threshold
                </text>
              </>
            );
          })()}

          {/* Wind >= 10 dots on actual */}
          {hours.map((h, i) => {
            if (h.a_wind === null || h.a_wind < 10) return null;
            const x = getX(i);
            const y = getWindY(h.a_wind);
            return (
              <circle key={`wind-dot-${i}`} cx={x} cy={y} r={2.5} fill="#d26743" />
            );
          })}

          {/* Left gutter labels */}
          <text
            x={5}
            y={windLaneY + 15}
            fontSize={9}
            fontFamily="var(--font-mono)"
            fill="#8fa392"
          >
            {Math.ceil(windScale)} mph
          </text>
          <text
            x={5}
            y={windLaneY + windLaneHeight - 5}
            fontSize={9}
            fontFamily="var(--font-mono)"
            fill="#8fa392"
          >
            0
          </text>
        </g>

        {/* Hover cursor line and chip */}
        {hoveredHour && (
          <>
            <line
              x1={hoveredX}
              y1={0}
              x2={hoveredX}
              y2={totalHeight}
              stroke="#24382a55"
              strokeWidth={1}
            />
          </>
        )}
      </svg>

      {/* Hover chip - positioned absolutely outside SVG */}
      {hoveredHour && (
        <div
          style={{
            position: "absolute",
            left: `${(hoveredX / totalWidth) * 100 + 5}%`,
            top: "10px",
            backgroundColor: "#ffffff",
            border: "1px solid #e2ebe0",
            borderRadius: "12px",
            padding: "8px 12px",
            fontSize: "11px",
            fontFamily: "var(--font-mono)",
            color: "#24382a",
            boxShadow: "0 2px 8px #2f8f4e14",
            whiteSpace: "nowrap",
            zIndex: 10,
          }}
        >
          <div>
            {formatHourLabel(hoveredHour.time, hoveredHour.day_local)}
          </div>
          <div>
            {hoveredHour.a_temp !== null ? `${hoveredHour.a_temp.toFixed(0)}°` : "—"}{" "}
            (said{" "}
            {hoveredHour.f_temp !== null ? `${hoveredHour.f_temp.toFixed(0)}°` : "—"})
          </div>
          <div>
            {hoveredHour.a_precip_in !== null
              ? `${hoveredHour.a_precip_in.toFixed(2)}in`
              : "—"}{" "}
            (said{" "}
            {hoveredHour.f_precip_in !== null
              ? `${hoveredHour.f_precip_in.toFixed(2)}in`
              : "—"})
          </div>
          <div>
            wind {hoveredHour.a_wind !== null ? hoveredHour.a_wind.toFixed(0) : "—"}{" "}
            (said{" "}
            {hoveredHour.f_wind !== null ? hoveredHour.f_wind.toFixed(0) : "—"})
          </div>
        </div>
      )}
    </div>
  );
};

export default SkyStrip;

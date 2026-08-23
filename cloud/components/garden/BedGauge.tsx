// BedGauge — the soil-bed moisture cross-section (Terraced Beds design).
// A rounded bed of earth seen from the side: a wavy soil strip on top,
// layered moisture waves for irrigation (light over dark leaf) and rain,
// and a dashed weekly-goal line near the right edge that turns solid
// green with a "full ✓" once the bed has drunk its fill.

"use client";

import { useId } from "react";

const W = 346;
const H = 84;
const TARGET_X = 330; // the weekly-goal line
const MAX_X = 336; // slight overshoot allowed when the bed is over-full

// Undulating moisture surface from x=0 to x, with its top around depth y.
// Shape parameterized from the artboard waves (control points at ~14%,
// ~28% and ~62% of the extent).
function wavePath(x: number, y: number): string {
  const f = (n: number) => Math.round(n * 10) / 10;
  return [
    `M0 ${H}`,
    `L 0 ${y}`,
    `Q ${f(x * 0.14)} ${y - 5} ${f(x * 0.28)} ${y - 1}`,
    `T ${f(x * 0.62)} ${y - 2}`,
    `T ${f(x)} ${y + 1}`,
    `L ${f(x)} ${H} Z`,
  ].join(" ");
}

export interface BedGaugeProps {
  /** delivered irrigation as a fraction of the weekly target */
  deliveredFrac: number;
  /** rainfall as a fraction of the weekly target */
  rainFrac: number;
  /** fraction of target considered "full" (default 1) */
  targetFullFrac?: number;
  /** rendered height in px (the SVG stretches to its container width) */
  heightPx?: number;
}

export function BedGauge({
  deliveredFrac,
  rainFrac,
  targetFullFrac = 1,
  heightPx = 84,
}: BedGaugeProps) {
  const uid = useId();
  const irrClipId = `bed-irr-${uid}`;
  const rainClipId = `bed-rain-${uid}`;

  const delivered = Math.max(0, deliveredFrac || 0);
  const rain = Math.max(0, rainFrac || 0);
  const total = delivered + rain;
  const full = targetFullFrac > 0 && total >= targetFullFrac - 1e-6;

  const xIrr = Math.min(MAX_X, total * TARGET_X);
  const xRain = Math.min(MAX_X, rain * TARGET_X);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      fill="none"
      preserveAspectRatio="none"
      className="block w-full overflow-hidden rounded-[10px]"
      style={{ height: heightPx }}
      aria-hidden="true"
    >
      <defs>
        {/* moisture waves animate width changes — honest ease-out, no bounce */}
        <clipPath id={irrClipId}>
          <rect className="gauge-clip" x="0" y="0" width={xIrr} height={H} />
        </clipPath>
        <clipPath id={rainClipId}>
          <rect className="gauge-clip" x="0" y="0" width={xRain} height={H} />
        </clipPath>
      </defs>

      {/* the bed */}
      <rect width={W} height={H} rx="10" fill="#edf3e7" />
      {/* soil surface strip */}
      <path d="M0 10 Q 40 6 90 9 T 200 8 T 346 10 L 346 0 L 0 0 Z" fill="#c9ab84" />

      {/* irrigation moisture — light leaf over deep leaf */}
      <g clipPath={`url(#${irrClipId})`}>
        <path d={wavePath(MAX_X, 34)} fill="#57b46f" />
        <path d={wavePath(MAX_X, 44)} fill="#2f8f4e" />
      </g>
      {/* rain contribution overlay */}
      <g clipPath={`url(#${rainClipId})`}>
        <path d={wavePath(MAX_X, 56)} fill="#9ec9ef" />
      </g>

      {/* weekly goal line */}
      {full ? (
        <>
          <line x1={TARGET_X} y1="16" x2={TARGET_X} y2={H} stroke="#2f8f4e" strokeWidth="1.5" />
          <text
            x="296"
            y="28"
            fontFamily="var(--font-karla), sans-serif"
            fontSize="10"
            fill="#2f8f4e"
          >
            full ✓
          </text>
        </>
      ) : (
        <line
          x1={TARGET_X}
          y1="16"
          x2={TARGET_X}
          y2={H}
          stroke="#b7c4b3"
          strokeWidth="1.5"
          strokeDasharray="2 4"
        />
      )}
    </svg>
  );
}

// Compact 14px-tall progress variant for "running now" rows.
export function BedGaugeCompact({ frac }: { frac: number }) {
  const uid = useId();
  const clipId = `bedc-${uid}`;
  const CW = 312;
  const CH = 14;
  const x = Math.min(CW, Math.max(0, frac || 0) * CW);

  return (
    <svg
      viewBox={`0 0 ${CW} ${CH}`}
      fill="none"
      preserveAspectRatio="none"
      className="block h-[14px] w-full overflow-hidden rounded-[7px]"
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clipId}>
          <rect className="gauge-clip" x="0" y="0" width={x} height={CH} />
        </clipPath>
      </defs>
      <rect width={CW} height={CH} rx="7" fill="#eef3ec" />
      <g clipPath={`url(#${clipId})`}>
        <path
          d={`M0 ${CH} L 0 6 Q 40 3 80 5 T 160 4 T ${CW} 6 L ${CW} ${CH} Z`}
          fill="#2f8f4e"
        />
      </g>
    </svg>
  );
}

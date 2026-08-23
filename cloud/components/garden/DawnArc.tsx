// DawnArc — the watering-window horizon (Terraced Beds design).
// A quiet horizon with the 4am–8am watering window marked in leaf green,
// a dashed sun arc, the pollen sun positioned by the current time, and
// the day's zone drink marks sitting on the window band. Static SVG.

export interface DawnArcMark {
  label: string;
  /** local hour as a decimal, e.g. 4.5 = 4:30 am */
  hour: number;
  color: string;
}

// x mapping: the window band runs 4am (x=40) to 8am (x=240) — 50px/hour.
function hourToX(hour: number): number {
  return Math.max(10, Math.min(336, 40 + (hour - 4) * 50));
}

// y on the dashed sun arc  M 10 92 Q 173 -30 336 92  for a given x
function arcY(x: number): number {
  const s = (x - 10) / 326;
  return (1 - s) * (1 - s) * 92 + 2 * s * (1 - s) * -30 + s * s * 92;
}

export function DawnArc({
  marks,
  nowHour,
}: {
  marks: DawnArcMark[];
  nowHour: number;
}) {
  const sunX = hourToX(nowHour);
  const sunY = arcY(sunX);
  const labelled = marks.slice(0, 2);

  return (
    <svg viewBox="0 0 346 112" fill="none" className="block h-auto w-full" aria-hidden="true">
      {/* horizon */}
      <line x1="0" y1="92" x2="346" y2="92" stroke="#cfe0cf" strokeWidth="1" />
      {/* watering window band on horizon */}
      <line x1="40" y1="92" x2="240" y2="92" stroke="#2f8f4e" strokeWidth="3" strokeLinecap="round" />
      {/* sun path arc */}
      <path d="M 10 92 Q 173 -30 336 92" stroke="#cfe0cf" strokeWidth="1" strokeDasharray="3 5" />
      {/* sun now */}
      <circle cx={sunX} cy={sunY} r="9" fill="#e9b949" />
      <circle cx={sunX} cy={sunY} r="14" fill="#e9b94933" />
      {/* zone drink marks on the window band */}
      {marks.map((mark, i) => (
        <circle key={i} cx={hourToX(mark.hour)} cy="92" r="4.5" fill={mark.color} />
      ))}
      <text x="40" y="108" fontFamily="var(--font-spline-mono), monospace" fontSize="9" fill="#79907e">
        4am
      </text>
      <text x="224" y="108" fontFamily="var(--font-spline-mono), monospace" fontSize="9" fill="#79907e">
        8am
      </text>
      {labelled.map((mark, i) => (
        <text
          key={i}
          x={Math.max(4, hourToX(mark.hour) - 10)}
          y={i === 0 ? 80 : 66}
          fontFamily="var(--font-karla), sans-serif"
          fontSize="10"
          fill="#4d6a52"
        >
          {mark.label}
        </text>
      ))}
    </svg>
  );
}

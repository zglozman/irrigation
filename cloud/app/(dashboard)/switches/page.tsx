// Valves page — the manifold. Direct relay control (bypasses scheduler);
// each valve is a tap on the supply line: vertical green handle = open,
// horizontal stone handle = closed.

"use client";

import { useEffect, useState } from "react";

interface RelayStates {
  [channel: number]: "ON" | "OFF" | "UNKNOWN";
}

interface BoardStatus {
  state: "online" | "offline" | "unknown";
  since: string | null;
}

function ValveHandle({ open, unknown }: { open: boolean; unknown: boolean }) {
  const color = open ? "#2f8f4e" : unknown ? "#a6b5a9" : "#b7c4b3";
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden="true">
      <circle
        cx="15"
        cy="15"
        r="12"
        stroke={color}
        strokeWidth="2.5"
        style={{ transition: "stroke 300ms ease" }}
      />
      {/* one handle, rotated between open (vertical) and closed (horizontal) */}
      <line
        x1="15"
        y1="5"
        x2="15"
        y2="25"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        style={{
          transform: open ? "rotate(0deg)" : "rotate(90deg)",
          transformOrigin: "15px 15px",
          transition: "transform 300ms cubic-bezier(0.25, 1, 0.5, 1), stroke 300ms ease",
        }}
      />
    </svg>
  );
}

function ValveTile({
  channel,
  state,
  loading,
  error,
  dimmed,
  zoneName,
  onToggle,
}: {
  channel: number;
  state: "ON" | "OFF" | "UNKNOWN";
  loading: boolean;
  error?: string;
  dimmed?: boolean;
  zoneName?: string;
  onToggle: (on: boolean) => void;
}) {
  const isOn = state === "ON";
  const treatAsOff = state === "UNKNOWN" || state === "OFF";

  const caption =
    state === "UNKNOWN"
      ? "unknown"
      : `${isOn ? "open" : "closed"}${zoneName ? ` · ${zoneName}` : ""}`;

  return (
    <button
      aria-label={`Toggle relay ${channel}`}
      onClick={() => onToggle(treatAsOff)}
      disabled={loading}
      className={`press flex min-h-[54px] items-center gap-3 rounded-[16px] border bg-white px-3.5 py-3 text-left ${
        isOn ? "border-[#cfe0cf] [box-shadow:0_2px_10px_#2f8f4e1a]" : "border-hairline"
      } ${dimmed ? "opacity-50" : ""} ${loading ? "animate-pulse" : ""}`}
    >
      <ValveHandle open={isOn} unknown={state === "UNKNOWN"} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-display text-[15px] font-semibold leading-tight text-ink">
          {channel}
        </span>
        <span
          className={`truncate text-[11px] ${
            isOn ? "font-bold text-leaf" : "text-fern"
          }`}
        >
          {caption}
        </span>
        {error && <span className="mt-0.5 text-[11px] text-clay">{error}</span>}
      </span>
    </button>
  );
}

export default function SwitchboardPage() {
  const [states, setStates] = useState<RelayStates>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [inFlight, setInFlight] = useState<Set<number>>(new Set());
  const [optimisticStates, setOptimisticStates] = useState<RelayStates>({});
  const [tileErrors, setTileErrors] = useState<Record<number, string>>({});
  const [lastCommandAt, setLastCommandAt] = useState<Record<number, number>>({});
  const [allOffFailed, setAllOffFailed] = useState<number[]>([]);
  const [boardStatus, setBoardStatus] = useState<BoardStatus>({ state: "unknown", since: null });
  const [zoneByChannel, setZoneByChannel] = useState<Record<number, string>>({});

  useEffect(() => {
    loadStates();
    loadBoardStatus();

    // Poll every 5 seconds
    const interval = setInterval(() => {
      loadStates();
      loadBoardStatus();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  // Zone-name captions where a zone maps to a channel
  useEffect(() => {
    const loadZones = async () => {
      try {
        const res = await fetch("/api/zones");
        if (res.ok) {
          const zones = await res.json();
          const map: Record<number, string> = {};
          for (const z of zones) {
            if (z.relay_channel && z.name) {
              map[z.relay_channel] = String(z.name).toLowerCase();
            }
          }
          setZoneByChannel(map);
        }
      } catch (err) {
        console.error("[Switches] Zones error:", err);
      }
    };
    loadZones();
  }, []);

  const loadStates = async () => {
    try {
      const response = await fetch("/api/switches");
      if (!response.ok) throw new Error("Failed to load relay states");
      const data = await response.json();

      // Only update states for channels not recently commanded (avoid bounce)
      const now = Date.now();
      const filtered: RelayStates = {};

      for (let ch = 1; ch <= 16; ch++) {
        const lastCmd = lastCommandAt[ch] || 0;
        if (now - lastCmd < 3000) {
          // Still within 3-second bounce suppression, keep current value
          filtered[ch] = states[ch] ?? data.states[ch];
        } else {
          // Use fetched value
          filtered[ch] = data.states[ch];
        }
      }

      setStates(filtered);
      setError("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load relay states";
      setError(message);
      console.error("[Switches] Load error:", err);
    } finally {
      setLoading(false);
    }
  };

  const loadBoardStatus = async () => {
    try {
      const response = await fetch("/api/device/status");
      if (!response.ok) throw new Error("Failed to load board status");
      const data = await response.json();
      setBoardStatus(data.board || { state: "unknown", since: null });
    } catch (err) {
      console.error("[Switches] Board status error:", err);
    }
  };

  const handleToggle = async (channel: number, on: boolean) => {
    setInFlight((prev) => new Set([...prev, channel]));
    setOptimisticStates((prev) => ({
      ...prev,
      [channel]: on ? "ON" : "OFF",
    }));
    setTileErrors((prev) => {
      const next = { ...prev };
      delete next[channel];
      return next;
    });

    // Record command time for bounce suppression
    setLastCommandAt((prev) => ({
      ...prev,
      [channel]: Date.now(),
    }));

    try {
      const response = await fetch(`/api/switches/${channel}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on }),
      });

      if (!response.ok) throw new Error("Failed to control relay");

      // Clear optimistic state on success
      setOptimisticStates((prev) => {
        const next = { ...prev };
        delete next[channel];
        return next;
      });

      // Refetch after command
      await loadStates();
    } catch (err) {
      console.error(`[Switches] Control error for channel ${channel}:`, err);

      // Show error in tile and clear optimistic state
      const message = err instanceof Error ? err.message : "Failed";
      setTileErrors((prev) => ({
        ...prev,
        [channel]: message,
      }));

      setOptimisticStates((prev) => {
        const next = { ...prev };
        delete next[channel];
        return next;
      });
    } finally {
      setInFlight((prev) => {
        const next = new Set(prev);
        next.delete(channel);
        return next;
      });
    }
  };

  const handleAllOff = async () => {
    const allChannels = Array.from({ length: 16 }, (_, i) => i + 1);

    // Set all to optimistic OFF
    const optimistic: RelayStates = {};
    allChannels.forEach((ch) => {
      optimistic[ch] = "OFF";
    });
    setOptimisticStates(optimistic);

    // Mark all in flight
    setInFlight(new Set(allChannels));
    setAllOffFailed([]);

    try {
      const failed: number[] = [];

      // Send commands sequentially
      for (const channel of allChannels) {
        try {
          const response = await fetch(`/api/switches/${channel}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ on: false }),
          });

          if (!response.ok) {
            failed.push(channel);
          }
        } catch (err) {
          console.error(`Failed to turn off channel ${channel}:`, err);
          failed.push(channel);
        }
      }

      // Refetch final state
      await loadStates();

      // Show failures if any
      if (failed.length > 0) {
        setError(`Failed to turn off channels: ${failed.join(", ")}`);
        setAllOffFailed(failed);
      }
    } finally {
      setInFlight(new Set());
      setOptimisticStates({});
    }
  };

  if (error && loading) {
    return (
      <div className="p-5 md:p-8">
        <div className="rounded-[16px] bg-claytint p-4 text-sm text-clay">{error}</div>
      </div>
    );
  }

  const displayStates = Object.keys(optimisticStates).length > 0
    ? { ...states, ...optimisticStates }
    : states;

  const openCount = Array.from({ length: 16 }, (_, i) => i + 1).filter(
    (ch) => displayStates[ch] === "ON"
  ).length;
  const flowFrac = openCount === 0 ? 0 : Math.min(1, 0.25 + (0.75 * openCount) / 16);

  return (
    <div className="mx-auto max-w-[980px] px-5 md:px-12">
      {/* Header */}
      <div className="flex items-baseline justify-between pb-2 pt-6 md:pt-8">
        <h1 className="font-display text-[27px] font-bold leading-tight tracking-[-0.02em] text-ink">
          valves
        </h1>
        <button
          onClick={handleAllOff}
          disabled={inFlight.size > 0}
          className="pill pill-stop h-11 px-[18px] text-[13px]"
        >
          close all
        </button>
      </div>

      {/* Offline banner */}
      {boardStatus.state !== "online" && (
        <div className="mb-3 flex items-start gap-2.5 rounded-[12px] bg-claytint p-3.5">
          <span className="text-lg" aria-hidden="true">
            🔌
          </span>
          <span className="text-[12px] leading-normal text-clay">
            the board is asleep — flips won&apos;t reach it right now.
          </span>
        </div>
      )}

      {/* Pollen warning banner */}
      <div className="mb-3.5 flex items-start gap-2.5 rounded-[12px] border border-[#eddfb4] bg-warntint px-3.5 py-3">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#c9972e"
          strokeWidth="2"
          strokeLinecap="round"
          className="mt-0.5 shrink-0"
          aria-hidden="true"
        >
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        </svg>
        <span className="text-[12px] leading-normal text-[#8a6d2c]">
          Hand-opened valves skip the schedule and water budgets. The board hard-stops
          every valve after 60 min.
        </span>
      </div>

      {error && !loading && (
        <div className="mb-3.5 rounded-[12px] bg-claytint p-3.5 text-[12px] text-clay">
          {error}
          {allOffFailed.length > 0 && (
            <span className="mt-1 block font-mono text-[11px]">
              still open: {allOffFailed.join(", ")}
            </span>
          )}
        </div>
      )}

      {/* Supply pipe */}
      <svg
        viewBox="0 0 346 16"
        fill="none"
        preserveAspectRatio="none"
        className="mb-2.5 block h-4 w-full"
        aria-hidden="true"
      >
        <rect y="5" width="346" height="6" rx="3" fill="#c9ab84" />
        <rect
          y="5"
          width={346 * flowFrac}
          height="6"
          rx="3"
          fill="#9ec9ef"
          className="gauge-clip"
        />
      </svg>

      {/* Manifold: valves as taps on the supply line */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 16 }, (_, i) => {
          const channel = i + 1;
          const state = displayStates[channel] || "UNKNOWN";
          const isLoading = inFlight.has(channel);
          const tileError = tileErrors[channel];

          return (
            <ValveTile
              key={channel}
              channel={channel}
              state={state}
              loading={isLoading}
              error={tileError}
              dimmed={boardStatus.state !== "online"}
              zoneName={zoneByChannel[channel]}
              onToggle={(on) => handleToggle(channel, on)}
            />
          );
        })}
      </div>

      <div className="flex justify-center py-4">
        <span className="font-mono text-[11px] text-fern">
          {loading ? "listening to the board…" : "open handle = water flows"}
        </span>
      </div>
    </div>
  );
}

// Switchboard page - direct relay control (bypasses scheduler)

"use client";

import { useEffect, useState } from "react";

interface RelayStates {
  [channel: number]: "ON" | "OFF" | "UNKNOWN";
}

interface BoardStatus {
  state: "online" | "offline" | "unknown";
  since: string | null;
}

function ToggleSwitch({
  channel,
  state,
  loading,
  onChange,
}: {
  channel: number;
  state: "ON" | "OFF" | "UNKNOWN";
  loading: boolean;
  onChange: (on: boolean) => void;
}) {
  const isOn = state === "ON";
  const treatAsOff = state === "UNKNOWN" || state === "OFF";

  return (
    <div
      className={`relative inline-flex items-center rounded-full px-3 py-2 transition-all ${
        loading ? "ring-2 ring-offset-1 ring-offset-slate-950 ring-teal-500 animate-pulse" : ""
      } ${
        isOn
          ? "bg-teal-600 text-white"
          : "bg-slate-700 text-slate-300"
      }`}
    >
      <button
        onClick={() => onChange(!treatAsOff)}
        disabled={loading}
        className="relative inline-flex h-6 w-11 items-center rounded-full bg-current opacity-75 disabled:opacity-50 transition-opacity"
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            isOn ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

function RelayTile({
  channel,
  state,
  loading,
  error,
  dimmed,
  onToggle,
}: {
  channel: number;
  state: "ON" | "OFF" | "UNKNOWN";
  loading: boolean;
  error?: string;
  dimmed?: boolean;
  onToggle: (on: boolean) => void;
}) {
  return (
    <div
      className={`p-4 bg-slate-900 border border-slate-800 rounded-lg text-center transition-opacity ${
        dimmed ? "opacity-50" : ""
      }`}
    >
      <div className="text-3xl font-bold text-white mb-3">Relay {channel}</div>
      <div className="flex justify-center mb-3">
        <ToggleSwitch channel={channel} state={state} loading={loading} onChange={onToggle} />
      </div>
      <div className="text-sm font-medium text-slate-400 mb-1">
        {state === "UNKNOWN" ? "—" : state}
      </div>
      {error && (
        <div className="text-xs text-red-400 mt-2 p-1 bg-red-900/20 rounded">
          {error}
        </div>
      )}
    </div>
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
      <div className="p-8">
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded text-red-400">
          {error}
        </div>
      </div>
    );
  }

  const displayStates = Object.keys(optimisticStates).length > 0
    ? { ...states, ...optimisticStates }
    : states;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Switchboard</h1>
        <p className="text-slate-400">Direct relay control</p>
      </div>

      {/* Offline banner */}
      {boardStatus.state !== "online" && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-3">
          <div className="text-2xl">🔌</div>
          <div className="flex-1">
            <div className="font-semibold text-red-300">Board is offline — commands will not reach it</div>
          </div>
        </div>
      )}

      {/* Warning banner */}
      <div className="mb-6 p-4 bg-amber-900/30 border border-amber-600/50 rounded-lg flex items-start gap-3">
        <div className="text-2xl">⚡</div>
        <div className="flex-1">
          <div className="font-semibold text-amber-300">Direct relay control</div>
          <div className="text-sm text-amber-300/70 mt-1">
            Bypasses the scheduler and water budgets. The board force-closes any relay after 60 minutes.
          </div>
        </div>
      </div>

      {error && !loading && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* All off button */}
      <div className="mb-6 flex justify-end">
        <button
          onClick={handleAllOff}
          disabled={inFlight.size > 0}
          className="px-4 py-2 bg-red-600/20 hover:bg-red-600/30 disabled:bg-slate-700 text-red-300 disabled:text-slate-500 border border-red-500/30 rounded-lg font-medium transition-colors disabled:opacity-50"
        >
          All Off
        </button>
      </div>

      {/* 4x4 grid of relays */}
      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 16 }, (_, i) => {
          const channel = i + 1;
          const state = displayStates[channel] || "UNKNOWN";
          const isLoading = inFlight.has(channel);
          const tileError = tileErrors[channel];

          return (
            <RelayTile
              key={channel}
              channel={channel}
              state={state}
              loading={isLoading}
              error={tileError}
              dimmed={boardStatus.state !== "online"}
              onToggle={(on) => handleToggle(channel, on)}
            />
          );
        })}
      </div>

      {loading && (
        <div className="mt-8 text-center text-slate-400">
          Loading relay states...
        </div>
      )}
    </div>
  );
}

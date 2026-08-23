// Client-side rain station configuration form (settings page interactivity)

"use client";

import { useState, useEffect } from "react";

interface ValidationStatus {
  ok: boolean;
  neighborhood?: string;
  obs_time?: string;
  precip_today_in?: number;
  temp_f?: number;
  error?: string;
}

export default function RainStationForm() {
  const [stationId, setStationId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [currentSource, setCurrentSource] = useState("tomorrow.io");
  const [validation, setValidation] = useState<ValidationStatus | null>(null);

  // Load current settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await fetch("/api/settings/weather");
        if (!response.ok) throw new Error("Failed to load settings");

        const data = (await response.json()) as {
          wu_station_id?: string;
          wu_api_key_masked?: string;
          source?: string;
          validation?: ValidationStatus;
        };

        if (data.wu_station_id) {
          setStationId(data.wu_station_id);
        }
        setCurrentSource(data.source || "tomorrow.io");
        if (data.validation) {
          setValidation(data.validation);
        }
      } catch (err) {
        console.error("Failed to load rain station settings", err);
      } finally {
        setLoading(false);
      }
    };

    loadSettings();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setSaving(true);

    try {
      const response = await fetch("/api/settings/weather", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wu_station_id: stationId.trim(),
          wu_api_key: apiKey.trim(),
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        validation?: ValidationStatus;
      };

      if (!response.ok) {
        throw new Error(data.error || "Failed to save settings");
      }

      setSuccess("Rain station configured");
      setApiKey("");
      if (data.validation) {
        setValidation(data.validation);
        setCurrentSource("wunderground");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save";
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!window.confirm("Remove Weather Underground station and fall back to estimates?")) {
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/settings/weather", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wu_station_id: "", wu_api_key: "" }),
      });

      const data = (await response.json()) as { success?: boolean; error?: string };

      if (!response.ok) {
        throw new Error(data.error || "Failed to remove settings");
      }

      setStationId("");
      setApiKey("");
      setValidation(null);
      setCurrentSource("tomorrow.io");
      setSuccess("Rain station removed");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to remove";
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="card flex flex-col gap-3.5 p-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-display text-[16px] font-semibold tracking-[-0.01em] text-ink">
            Rain station
          </h2>
        </div>
        <div className="text-[12px] text-fern">Loading…</div>
      </div>
    );
  }

  return (
    <div className="card flex flex-col gap-3.5 p-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-display text-[16px] font-semibold tracking-[-0.01em] text-ink">
          Rain station
        </h2>
        <p className="text-[12px] text-fern">
          measure real rainfall from your weather underground station instead of estimates
        </p>
      </div>

      {error && (
        <div className="rounded-[10px] bg-claytint p-3 text-[12px] text-clay">{error}</div>
      )}

      {success && (
        <div className="rounded-[10px] border border-inputb bg-tint p-3 text-[12px] text-leafdark">
          {success}
        </div>
      )}

      {stationId ? (
        <>
          {validation && validation.ok && (
            <div className="rounded-[10px] border border-inputb bg-tint p-3 text-[12px] text-leafdark">
              <div className="font-semibold">measuring rain from {stationId}</div>
              <div className="text-[11px]">
                {validation.neighborhood} · {validation.precip_today_in?.toFixed(2)} in today
              </div>
            </div>
          )}
          {validation && !validation.ok && (
            <div className="rounded-[10px] bg-claytint p-3 text-[12px] text-clay">
              station error: {validation.error}
            </div>
          )}
          <button
            type="button"
            onClick={handleRemove}
            disabled={saving}
            className="text-[12px] text-blue-600 hover:text-blue-800 disabled:text-gray-400"
          >
            {saving ? "removing…" : "remove"}
          </button>
        </>
      ) : (
        <>
          <div className="text-[12px] text-fern">using {currentSource} estimates</div>

          <form onSubmit={handleSave} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-bold text-sec" htmlFor="station-id">
                Station ID
              </label>
              <input
                id="station-id"
                type="text"
                value={stationId}
                onChange={(e) => setStationId(e.target.value.toUpperCase())}
                placeholder="e.g., KABCD1234"
                required
                className="h-[46px] w-full rounded-[10px] border border-inputb bg-white px-3.5 text-[14px] text-ink placeholder:text-stone focus:outline-none focus:ring-2 focus:ring-leaflight"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-bold text-sec" htmlFor="api-key">
                api key <span className="font-normal text-stone">(optional)</span>
              </label>
              <input
                id="api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="leave blank to use the public web key"
                className="h-[46px] w-full rounded-[10px] border border-inputb bg-white px-3.5 text-[14px] text-ink placeholder:text-stone focus:outline-none focus:ring-2 focus:ring-leaflight"
              />
            </div>

            <button
              type="submit"
              disabled={saving || !stationId}
              className="pill pill-primary h-12 w-full text-[14px]"
            >
              {saving ? "saving…" : "save"}
            </button>
          </form>
        </>
      )}

      <p className="text-[11px] leading-normal text-fern">
        Get a free API key from{" "}
        <a
          href="https://www.wunderground.com/member/devices"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:text-blue-800"
        >
          Weather Underground
        </a>
        . Enter your personal weather station ID (e.g., KABCD1234).
      </p>
    </div>
  );
}

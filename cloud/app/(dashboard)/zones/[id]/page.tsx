// Bed editor — what grows here, how it drinks, and its journal entries.

"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { getZoneTypes } from "@/domain/water-need-calculator";
import { BedGauge } from "@/components/garden/BedGauge";

interface HistoryItem {
  timestamp: string;
  zone_id: string;
  relay_channel: number;
  trigger_type: string;
  outcome: string;
  scheduled_runtime_min: number | null;
  actual_runtime_min: number | null;
  gallons_estimated_delivered: number | null;
  reason: string;
}

function outcomeDot(item: HistoryItem): string {
  if (/watchdog/i.test(item.trigger_type) || /watchdog/i.test(item.reason)) return "#d26743";
  switch (item.outcome) {
    case "RAN":
      return "#2f8f4e";
    case "REDUCED":
      return "#9ec9ef";
    case "FAILED":
      return "#d26743";
    default:
      return "#b7c4b3";
  }
}

function historyTitle(item: HistoryItem): string {
  if (/watchdog/i.test(item.trigger_type) || /watchdog/i.test(item.reason)) {
    return "closed by the watchdog";
  }
  switch (item.outcome) {
    case "RAN":
      return item.trigger_type === "MANUAL" ? "hand-watered" : "watered";
    case "SKIPPED":
      return "rested";
    case "REDUCED":
      return item.actual_runtime_min != null
        ? `trimmed to ${Math.round(item.actual_runtime_min)} min`
        : "trimmed";
    case "DELAYED":
      return "held for later";
    case "SCHEDULED":
      return "penciled in";
    case "FAILED":
      return "didn't water";
    default:
      return item.outcome.toLowerCase();
  }
}

function ledgerDate(iso: string): string {
  try {
    return new Date(iso)
      .toLocaleDateString("en-US", { month: "short", day: "numeric" })
      .toLowerCase();
  } catch {
    return iso;
  }
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

interface Zone {
  zone_id: string;
  name: string;
  relay_channel: number;
  area_sqft: number;
  location?: string;
  plantConfig?: {
    zone_type: string;
    irrigation_method: string;
    emitter_count?: number;
    emitter_gph?: number;
    head_count?: number;
    head_gpm?: number;
    soaker_length_ft?: number;
    soaker_gph_per_ft?: number;
    plant_quantity?: number;
    gal_per_week_per_plant?: number;
    total_gal_per_week?: number;
  };
  budget?: {
    weekly_target_gal: number;
    delivered_gal_this_week: number;
    rainfall_gal_this_week: number;
  };
}

const zoneTypes = getZoneTypes();

const fieldLabel = "text-[11px] text-fern";
const fieldInput =
  "h-[46px] w-full rounded-[10px] border border-inputb bg-white px-3.5 text-[14px] text-ink placeholder:text-stone focus:outline-none focus:ring-2 focus:ring-leaflight";
const fieldInputMono = `${fieldInput} font-mono text-[15px]`;

export default function ZoneDetailPage() {
  const router = useRouter();
  const params = useParams();
  const zoneId = params.id as string;
  const isNew = zoneId === "new";

  const [zone, setZone] = useState<Zone | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

  const [formData, setFormData] = useState({
    name: "",
    relay_channel: 1,
    area_sqft: 100,
    location: "",
    plantConfig: {
      zone_type: "vegetable",
      irrigation_method: "drip",
      emitter_count: 10,
      emitter_gph: 0.5,
      head_count: 4,
      head_gpm: 1,
      soaker_length_ft: 50,
      soaker_gph_per_ft: 0.5,
      plant_quantity: 5,
      gal_per_week_per_plant: 1.5,
      total_gal_per_week: 0,
    },
  });

  useEffect(() => {
    if (!isNew) {
      loadZone();
    }
  }, [zoneId, isNew]);

  const loadZone = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/zones/${zoneId}`);
      if (!response.ok) throw new Error("Zone not found");
      const data = await response.json();
      setZone(data);
      setFormData({
        name: data.name,
        relay_channel: data.relay_channel,
        area_sqft: data.area_sqft,
        location: data.location || "",
        plantConfig: data.plantConfig || formData.plantConfig,
      });

      // Load history for this zone's relay channel
      await loadHistory(data.relay_channel);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load zone";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async (relayChannel: number) => {
    if (!Number.isInteger(relayChannel) || relayChannel < 1 || relayChannel > 16) {
      setHistoryError("Zone has no valid relay channel — history unavailable");
      return;
    }
    try {
      setHistoryLoading(true);
      setHistoryError("");
      const response = await fetch(`/api/history?zone=${relayChannel}&days=30`);
      if (!response.ok) {
        setHistoryError("Could not load run history");
        return;
      }
      const data = await response.json();
      setHistory(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load history:", err);
      setHistoryError("Could not load run history");
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const url = isNew ? "/api/zones" : `/api/zones/${zoneId}`;
      const method = isNew ? "POST" : "PUT";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          zone_type: formData.plantConfig.zone_type,
          irrigation_method: formData.plantConfig.irrigation_method,
          emitter_count: formData.plantConfig.emitter_count,
          emitter_gph: formData.plantConfig.emitter_gph,
          head_count: formData.plantConfig.head_count,
          head_gpm: formData.plantConfig.head_gpm,
          soaker_length_ft: formData.plantConfig.soaker_length_ft,
          soaker_gph_per_ft: formData.plantConfig.soaker_gph_per_ft,
          plant_quantity: formData.plantConfig.plant_quantity,
          gal_per_week_per_plant: formData.plantConfig.gal_per_week_per_plant,
          weekly_target_gal: calculateWeeklyTarget(),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to save zone");
      }

      setSuccess(isNew ? "Bed planted!" : "Bed saved!");
      if (isNew) {
        setTimeout(() => router.push("/zones"), 1500);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save";
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this zone?")) return;

    try {
      const response = await fetch(`/api/zones/${zoneId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to delete");
      router.push("/zones");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete";
      setError(message);
    }
  };

  const calculateWeeklyTarget = (): number => {
    // Simple calculation: area × depth
    // In production, this would use the domain calculator
    return formData.area_sqft * 0.6;
  };

  const updateField = (path: string, value: any) => {
    setFormData((prev) => {
      const keys = path.split(".");
      const updated = { ...prev };
      let current: any = updated;

      for (let i = 0; i < keys.length - 1; i++) {
        if (!current[keys[i]]) current[keys[i]] = {};
        current = current[keys[i]];
      }

      current[keys[keys.length - 1]] = value;
      return updated;
    });
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-fern">walking to the bed…</p>
      </div>
    );
  }

  const budget = zone?.budget;
  const target = budget?.weekly_target_gal || 0;
  const delivered = budget?.delivered_gal_this_week || 0;
  const rainfall = budget?.rainfall_gal_this_week || 0;
  const [emojiA, emojiB] = plantEmojis(formData.plantConfig.zone_type);

  return (
    <div className="mx-auto max-w-[720px] px-5 pb-8 md:px-12">
      {/* Header */}
      <div className="flex items-center gap-2.5 pt-6 md:pt-8">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="back to the beds"
          className="press -ml-2.5 flex h-11 w-11 items-center justify-center rounded-full text-fern hover:bg-tint hover:text-sec"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m15 6-6 6 6 6" />
          </svg>
        </button>
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate font-display text-[24px] font-bold leading-tight tracking-[-0.02em] text-ink">
            {isNew ? "new bed" : formData.name.toLowerCase()}
          </h1>
          <span className="font-mono text-[11px] text-fern">
            {isNew
              ? "plant something"
              : `valve ${formData.relay_channel} · ${formData.plantConfig.zone_type} bed`}
          </span>
        </div>
      </div>

      {/* This bed, live */}
      {!isNew && budget && (
        <div className="relative mt-6 h-[84px]">
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
            {(delivered + rainfall).toFixed(1)}/{target.toFixed(1)} gal this week
          </span>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-[12px] bg-claytint p-3.5 text-sm text-clay">{error}</div>
      )}
      {success && (
        <div className="mt-4 rounded-[12px] border border-inputb bg-tint p-3.5 text-sm text-leafdark">
          {success}
        </div>
      )}

      {/* What grows here */}
      <form onSubmit={handleSave} className="flex flex-col gap-2.5 pt-5">
        <h2 className="font-display text-[16px] font-semibold tracking-[-0.01em] text-sec">
          What grows here
        </h2>

        <div className="grid grid-cols-2 gap-2.5">
          <div className="col-span-2 flex flex-col gap-[5px]">
            <label className={fieldLabel} htmlFor="bed-name">
              Bed name
            </label>
            <input
              id="bed-name"
              type="text"
              value={formData.name}
              onChange={(e) => updateField("name", e.target.value)}
              className={fieldInput}
              required
            />
          </div>

          <div className="flex flex-col gap-[5px]">
            <label className={fieldLabel} htmlFor="bed-valve">
              Valve
            </label>
            <select
              id="bed-valve"
              value={formData.relay_channel}
              onChange={(e) => updateField("relay_channel", parseInt(e.target.value))}
              className={fieldInput}
            >
              {Array.from({ length: 16 }, (_, i) => i + 1).map((ch) => (
                <option key={ch} value={ch}>
                  valve {ch}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-[5px]">
            <label className={fieldLabel} htmlFor="bed-size">
              Bed size (sq ft)
            </label>
            <input
              id="bed-size"
              type="number"
              min="1"
              step="0.1"
              value={formData.area_sqft}
              onChange={(e) => updateField("area_sqft", parseFloat(e.target.value))}
              className={fieldInputMono}
              required
            />
          </div>

          <div className="flex flex-col gap-[5px]">
            <label className={fieldLabel} htmlFor="bed-planting">
              Planting
            </label>
            <select
              id="bed-planting"
              value={formData.plantConfig.zone_type}
              onChange={(e) => updateField("plantConfig.zone_type", e.target.value)}
              className={fieldInput}
            >
              {zoneTypes.map((zt) => (
                <option key={zt.value} value={zt.value}>
                  {zt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-[5px]">
            <label className={fieldLabel} htmlFor="bed-method">
              Watered by
            </label>
            <select
              id="bed-method"
              value={formData.plantConfig.irrigation_method}
              onChange={(e) => updateField("plantConfig.irrigation_method", e.target.value)}
              className={fieldInput}
            >
              <option value="drip">Drip line</option>
              <option value="spray">Spray heads</option>
              <option value="soaker">Soaker hose</option>
            </select>
          </div>

          {formData.plantConfig.irrigation_method === "drip" && (
            <>
              <div className="flex flex-col gap-[5px]">
                <label className={fieldLabel} htmlFor="bed-emitters">
                  Emitters
                </label>
                <input
                  id="bed-emitters"
                  type="number"
                  min="1"
                  value={formData.plantConfig.emitter_count}
                  onChange={(e) =>
                    updateField("plantConfig.emitter_count", parseInt(e.target.value))
                  }
                  className={fieldInputMono}
                />
              </div>
              <div className="flex flex-col gap-[5px]">
                <label className={fieldLabel} htmlFor="bed-emitter-gph">
                  gph per emitter
                </label>
                <input
                  id="bed-emitter-gph"
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={formData.plantConfig.emitter_gph}
                  onChange={(e) =>
                    updateField("plantConfig.emitter_gph", parseFloat(e.target.value))
                  }
                  className={fieldInputMono}
                />
              </div>
            </>
          )}

          {formData.plantConfig.irrigation_method === "spray" && (
            <>
              <div className="flex flex-col gap-[5px]">
                <label className={fieldLabel} htmlFor="bed-heads">
                  Spray heads
                </label>
                <input
                  id="bed-heads"
                  type="number"
                  min="1"
                  value={formData.plantConfig.head_count}
                  onChange={(e) =>
                    updateField("plantConfig.head_count", parseInt(e.target.value))
                  }
                  className={fieldInputMono}
                />
              </div>
              <div className="flex flex-col gap-[5px]">
                <label className={fieldLabel} htmlFor="bed-head-gpm">
                  gpm per head
                </label>
                <input
                  id="bed-head-gpm"
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={formData.plantConfig.head_gpm}
                  onChange={(e) =>
                    updateField("plantConfig.head_gpm", parseFloat(e.target.value))
                  }
                  className={fieldInputMono}
                />
              </div>
            </>
          )}

          {formData.plantConfig.irrigation_method === "soaker" && (
            <>
              <div className="flex flex-col gap-[5px]">
                <label className={fieldLabel} htmlFor="bed-soaker-len">
                  Soaker length (ft)
                </label>
                <input
                  id="bed-soaker-len"
                  type="number"
                  min="1"
                  value={formData.plantConfig.soaker_length_ft}
                  onChange={(e) =>
                    updateField("plantConfig.soaker_length_ft", parseFloat(e.target.value))
                  }
                  className={fieldInputMono}
                />
              </div>
              <div className="flex flex-col gap-[5px]">
                <label className={fieldLabel} htmlFor="bed-soaker-gph">
                  gph per foot
                </label>
                <input
                  id="bed-soaker-gph"
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={formData.plantConfig.soaker_gph_per_ft}
                  onChange={(e) =>
                    updateField("plantConfig.soaker_gph_per_ft", parseFloat(e.target.value))
                  }
                  className={fieldInputMono}
                />
              </div>
            </>
          )}

          <div className="col-span-2 flex flex-col gap-[5px]">
            <label className={fieldLabel} htmlFor="bed-location">
              Where it sits (optional)
            </label>
            <input
              id="bed-location"
              type="text"
              value={formData.location}
              onChange={(e) => updateField("location", e.target.value)}
              placeholder="front yard, back patio…"
              className={fieldInput}
            />
          </div>
        </div>

        {/* Weekly thirst */}
        <div className="flex items-center justify-between rounded-[10px] border border-[#cfe0cf] bg-tint px-3.5 py-3">
          <span className="text-[12px] text-sec">This bed wants about</span>
          <span className="font-mono text-[15px] font-medium text-leaf">
            {calculateWeeklyTarget().toFixed(1)} gal / week
          </span>
        </div>

        <button type="submit" disabled={saving} className="pill pill-primary h-[50px] w-full text-[15px]">
          {saving ? "saving…" : "save this bed"}
        </button>

        <div className="flex gap-2.5">
          {!isNew && (
            <button
              type="button"
              onClick={handleDelete}
              className="pill pill-stop h-11 flex-1 text-[13px]"
            >
              dig up this bed
            </button>
          )}
          <button
            type="button"
            onClick={() => router.back()}
            className="pill h-11 flex-1 bg-track text-[13px] text-sec hover:bg-hairline"
          >
            never mind
          </button>
        </div>
      </form>

      {/* From the journal */}
      {!isNew && (
        <div className="flex flex-col pt-6">
          <h2 className="pb-1.5 font-display text-[16px] font-semibold tracking-[-0.01em] text-sec">
            From the journal
          </h2>

          {historyLoading ? (
            <p className="border-t border-hairline py-4 text-sm text-fern">
              leafing back through the pages…
            </p>
          ) : historyError ? (
            <div className="rounded-[12px] bg-claytint p-3.5 text-sm text-clay">
              {historyError}
            </div>
          ) : history.length === 0 ? (
            <p className="border-t border-hairline py-4 text-sm text-fern">
              no entries yet — they appear after the first watering
            </p>
          ) : (
            history.map((item, idx) => (
              <div key={idx} className="flex gap-3 border-t border-hairline py-2.5">
                <span className="min-w-[60px] pt-0.5 font-mono text-[11px] text-fern">
                  {ledgerDate(item.timestamp)}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: outcomeDot(item) }}
                    />
                    <span className="text-[13px] font-bold text-ink">{historyTitle(item)}</span>
                    {item.gallons_estimated_delivered != null &&
                      item.gallons_estimated_delivered > 0 && (
                        <span className="font-mono text-[11px] text-sec">
                          {Number(item.gallons_estimated_delivered).toFixed(1)} gal
                        </span>
                      )}
                  </div>
                  {item.reason && (
                    <span className="text-[12px] leading-normal text-fern">{item.reason}</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

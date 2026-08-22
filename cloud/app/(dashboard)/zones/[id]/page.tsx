// Zone detail/editor page

"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { getZoneTypes } from "@/domain/water-need-calculator";

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

function getOutcomeBadgeColor(outcome: string) {
  switch (outcome) {
    case "RAN":
      return "bg-green-500/20 text-green-300 border-green-500/30";
    case "SKIPPED":
      return "bg-slate-500/20 text-slate-300 border-slate-500/30";
    case "SCHEDULED":
      return "bg-sky-500/20 text-sky-300 border-sky-500/30";
    case "DELAYED":
      return "bg-amber-500/20 text-amber-300 border-amber-500/30";
    case "REDUCED":
      return "bg-blue-500/20 text-blue-300 border-blue-500/30";
    case "FAILED":
      return "bg-red-500/20 text-red-300 border-red-500/30";
    default:
      return "bg-slate-500/20 text-slate-300 border-slate-500/30";
  }
}

function formatLocalTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

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

      setSuccess(isNew ? "Zone created!" : "Zone updated!");
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
      <div className="p-8 flex items-center justify-center h-full">
        <p className="text-slate-400">Loading...</p>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">
          {isNew ? "New Zone" : formData.name}
        </h1>
        <p className="text-slate-400">
          {isNew ? "Create a new irrigation zone" : "Edit zone settings"}
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded text-red-400">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-6 p-4 bg-green-500/10 border border-green-500/30 rounded text-green-400">
          {success}
        </div>
      )}

      <form onSubmit={handleSave} className="max-w-2xl space-y-8">
        {/* Zone Info */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-bold text-white">Zone Information</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-200 mb-2">
                Zone Name
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => updateField("name", e.target.value)}
                className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-200 mb-2">
                Relay Channel
              </label>
              <select
                value={formData.relay_channel}
                onChange={(e) => updateField("relay_channel", parseInt(e.target.value))}
                className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                {Array.from({ length: 16 }, (_, i) => i + 1).map((ch) => (
                  <option key={ch} value={ch}>
                    Relay {ch}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-200 mb-2">
                Area (sq ft)
              </label>
              <input
                type="number"
                min="1"
                step="0.1"
                value={formData.area_sqft}
                onChange={(e) => updateField("area_sqft", parseFloat(e.target.value))}
                className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-200 mb-2">
                Location (optional)
              </label>
              <input
                type="text"
                value={formData.location}
                onChange={(e) => updateField("location", e.target.value)}
                placeholder="Front yard, Back patio, etc."
                className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>
        </div>

        {/* Plant Config */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-bold text-white">Plant & Irrigation</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-200 mb-2">
                Zone Type
              </label>
              <select
                value={formData.plantConfig.zone_type}
                onChange={(e) => updateField("plantConfig.zone_type", e.target.value)}
                className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                {zoneTypes.map((zt) => (
                  <option key={zt.value} value={zt.value}>
                    {zt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-200 mb-2">
                Irrigation Method
              </label>
              <select
                value={formData.plantConfig.irrigation_method}
                onChange={(e) => updateField("plantConfig.irrigation_method", e.target.value)}
                className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                <option value="drip">Drip</option>
                <option value="spray">Spray</option>
                <option value="soaker">Soaker</option>
              </select>
            </div>
          </div>

          {/* Method-specific fields */}
          {formData.plantConfig.irrigation_method === "drip" && (
            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-700">
              <div>
                <label className="block text-sm font-medium text-slate-200 mb-2">
                  Emitter Count
                </label>
                <input
                  type="number"
                  min="1"
                  value={formData.plantConfig.emitter_count}
                  onChange={(e) => updateField("plantConfig.emitter_count", parseInt(e.target.value))}
                  className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-200 mb-2">
                  GPH per Emitter
                </label>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={formData.plantConfig.emitter_gph}
                  onChange={(e) => updateField("plantConfig.emitter_gph", parseFloat(e.target.value))}
                  className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
            </div>
          )}

          {formData.plantConfig.irrigation_method === "spray" && (
            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-700">
              <div>
                <label className="block text-sm font-medium text-slate-200 mb-2">
                  Spray Head Count
                </label>
                <input
                  type="number"
                  min="1"
                  value={formData.plantConfig.head_count}
                  onChange={(e) => updateField("plantConfig.head_count", parseInt(e.target.value))}
                  className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-200 mb-2">
                  GPM per Head
                </label>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={formData.plantConfig.head_gpm}
                  onChange={(e) => updateField("plantConfig.head_gpm", parseFloat(e.target.value))}
                  className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
            </div>
          )}

          {formData.plantConfig.irrigation_method === "soaker" && (
            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-700">
              <div>
                <label className="block text-sm font-medium text-slate-200 mb-2">
                  Soaker Length (ft)
                </label>
                <input
                  type="number"
                  min="1"
                  value={formData.plantConfig.soaker_length_ft}
                  onChange={(e) => updateField("plantConfig.soaker_length_ft", parseFloat(e.target.value))}
                  className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-200 mb-2">
                  GPH per Foot
                </label>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={formData.plantConfig.soaker_gph_per_ft}
                  onChange={(e) => updateField("plantConfig.soaker_gph_per_ft", parseFloat(e.target.value))}
                  className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex space-x-4">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-3 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-700 text-white font-medium rounded transition-colors"
          >
            {saving ? "Saving..." : isNew ? "Create Zone" : "Update Zone"}
          </button>

          {!isNew && (
            <button
              type="button"
              onClick={handleDelete}
              className="px-6 py-3 bg-red-600/20 hover:bg-red-600/30 text-red-300 font-medium rounded transition-colors border border-red-500/30"
            >
              Delete
            </button>
          )}

          <button
            type="button"
            onClick={() => router.back()}
            className="px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white font-medium rounded transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>

      {/* Run History */}
      {!isNew && (
        <div className="mt-12">
          <h2 className="text-xl font-bold text-white mb-4">Run History</h2>

          {historyLoading ? (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-8 text-center">
              <p className="text-slate-400">Loading history...</p>
            </div>
          ) : historyError ? (
            <div className="bg-slate-900 border border-red-500/30 rounded-lg p-8 text-center">
              <p className="text-red-400">{historyError}</p>
            </div>
          ) : history.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-8 text-center">
              <p className="text-slate-400">No runs yet — history appears after the first watering</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="px-4 py-3 text-left text-slate-300 font-medium">Time</th>
                    <th className="px-4 py-3 text-left text-slate-300 font-medium">Trigger</th>
                    <th className="px-4 py-3 text-left text-slate-300 font-medium">Outcome</th>
                    <th className="px-4 py-3 text-left text-slate-300 font-medium">Scheduled (min)</th>
                    <th className="px-4 py-3 text-left text-slate-300 font-medium">Actual (min)</th>
                    <th className="px-4 py-3 text-left text-slate-300 font-medium">Gallons</th>
                    <th className="px-4 py-3 text-left text-slate-300 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((item, idx) => (
                    <tr key={idx} className="border-b border-slate-800 hover:bg-slate-800/30 transition-colors">
                      <td className="px-4 py-3 text-slate-400 font-mono text-xs">
                        {formatLocalTime(item.timestamp)}
                      </td>
                      <td className="px-4 py-3 text-slate-300 text-xs">{item.trigger_type}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium border ${getOutcomeBadgeColor(
                            item.outcome
                          )}`}
                        >
                          {item.outcome}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-300">
                        {item.scheduled_runtime_min != null ? Number(item.scheduled_runtime_min).toFixed(1) : "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-300">
                        {item.actual_runtime_min != null ? Number(item.actual_runtime_min).toFixed(1) : "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-300">
                        {item.gallons_estimated_delivered != null ? Number(item.gallons_estimated_delivered).toFixed(1) : "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-400 font-mono text-xs max-w-xs truncate">
                        {item.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

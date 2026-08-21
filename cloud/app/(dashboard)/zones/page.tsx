// Zones listing page

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Zone {
  zone_id: string;
  name: string;
  relay_channel: number;
  area_sqft: number;
  plantConfig?: {
    zone_type: string;
  };
}

export default function ZonesPage() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadZones();
  }, []);

  const loadZones = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/zones");
      if (!response.ok) throw new Error("Failed to load zones");
      const data = await response.json();
      setZones(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load zones";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <p className="text-slate-400">Loading zones...</p>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Zones</h1>
          <p className="text-slate-400">Manage your irrigation zones</p>
        </div>
        <Link
          href="/zones/new"
          className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded font-medium transition-colors"
        >
          New Zone
        </Link>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded text-red-400">
          {error}
        </div>
      )}

      {zones.length === 0 ? (
        <div className="text-center py-12 bg-slate-900/50 border border-slate-800 rounded-lg">
          <p className="text-slate-400 mb-4">No zones created yet</p>
          <Link
            href="/zones/new"
            className="inline-block px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded font-medium transition-colors"
          >
            Create Your First Zone
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {zones.map((zone) => (
            <Link
              key={zone.zone_id}
              href={`/zones/${zone.zone_id}`}
              className="block bg-slate-900 border border-slate-800 rounded-lg p-4 hover:border-slate-700 hover:shadow-lg transition-all"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-white hover:text-teal-400 transition-colors">
                    {zone.name}
                  </h3>
                  <div className="flex space-x-4 mt-2 text-sm text-slate-400">
                    <span>Relay {zone.relay_channel}</span>
                    <span>{zone.area_sqft.toFixed(0)} sq ft</span>
                    <span>{zone.plantConfig?.zone_type || "Unknown"}</span>
                  </div>
                </div>
                <div className="text-right">
                  <svg
                    className="w-5 h-5 text-slate-600 group-hover:text-slate-400"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// Beds listing page — simple hairline rows

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
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-fern">counting the beds…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[720px] px-5 pb-8 md:px-12">
      <div className="flex items-baseline justify-between pb-3.5 pt-6 md:pt-8">
        <h1 className="font-display text-[27px] font-bold leading-tight tracking-[-0.02em] text-ink">
          beds
        </h1>
        <Link href="/zones/new" className="pill pill-soft h-11 px-[18px] text-[13px]">
          new bed
        </Link>
      </div>

      {error && (
        <div className="mb-4 rounded-[12px] bg-claytint p-3.5 text-sm text-clay">{error}</div>
      )}

      {zones.length === 0 ? (
        <div className="card flex flex-col items-center gap-4 p-8 text-center">
          <p className="text-sm text-fern">nothing planted yet</p>
          <Link href="/zones/new" className="pill pill-primary h-11 px-5 text-sm">
            plant the first bed
          </Link>
        </div>
      ) : (
        <div className="flex flex-col">
          {zones.map((zone) => (
            <Link
              key={zone.zone_id}
              href={`/zones/${zone.zone_id}`}
              className="press flex min-h-[44px] items-center justify-between gap-3 border-t border-hairline py-3.5"
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-display text-[17px] font-semibold leading-tight tracking-[-0.01em] text-ink">
                  {zone.name.toLowerCase()}
                </span>
                <span className="font-mono text-[11px] text-fern">
                  valve {zone.relay_channel} · {zone.area_sqft.toFixed(0)} sq ft ·{" "}
                  {zone.plantConfig?.zone_type || "unplanted"}
                </span>
              </div>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#b7c4b3"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0"
                aria-hidden="true"
              >
                <path d="m9 6 6 6-6 6" />
              </svg>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

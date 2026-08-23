// ActivityBadge — the "N beds drinking" pill (client component)

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface ActivityData {
  running: Array<{
    zone_id: string;
    zone_name: string | null;
    relay_channel: number;
    actual_start: string;
    scheduled_end: string;
    remaining_min: number;
    raw?: boolean;
  }>;
  recent: any[];
}

export function ActivityBadge() {
  const [activity, setActivity] = useState<ActivityData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchActivity = async () => {
      try {
        const res = await fetch("/api/activity");
        if (res.ok) {
          const data = await res.json();
          setActivity(data);
        }
      } catch (err) {
        console.error("Failed to fetch activity:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchActivity();
    const interval = setInterval(fetchActivity, 10000); // Poll every 10s

    return () => clearInterval(interval);
  }, []);

  const hasRunning = activity?.running && activity.running.length > 0;
  const firstRunning = activity?.running?.[0];

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-[10px] border border-inputb bg-white px-3 py-2.5">
        <span className="h-2 w-2 animate-pulse rounded-full bg-stone" />
        <span className="text-[12px] font-bold text-fern">listening…</span>
      </div>
    );
  }

  if (!hasRunning) {
    return (
      <div className="flex items-center gap-2 rounded-[10px] border border-inputb bg-white px-3 py-2.5">
        <span className="h-2 w-2 rounded-full bg-stone" />
        <span className="text-[12px] font-bold text-sec">all beds resting</span>
      </div>
    );
  }

  const count = activity!.running.length;

  return (
    <Link href="/activity" className="press block">
      <div className="flex items-center gap-2 rounded-[10px] border border-inputb bg-white px-3 py-2.5">
        <span className="h-2 w-2 animate-pulse rounded-full bg-leaflight" />
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-bold text-sec">
            {count} {count === 1 ? "bed" : "beds"} drinking
          </div>
          <div className="truncate font-mono text-[11px] text-fern">
            {(firstRunning?.zone_name || `valve ${firstRunning?.relay_channel}`).toLowerCase()}
            {firstRunning?.remaining_min ? ` · ${firstRunning.remaining_min}m` : ""}
          </div>
        </div>
      </div>
    </Link>
  );
}

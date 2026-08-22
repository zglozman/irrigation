// ActivityBadge — live activity indicator in sidebar (client component)

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
      <div className="flex items-center space-x-2 px-4 py-3 text-slate-400 text-sm">
        <div className="w-2 h-2 bg-slate-600 rounded-full"></div>
        <span>Loading...</span>
      </div>
    );
  }

  if (!hasRunning) {
    return (
      <div className="flex items-center space-x-2 px-4 py-3 text-slate-400 text-sm">
        <div className="w-2 h-2 bg-slate-700 rounded-full"></div>
        <span>Idle</span>
      </div>
    );
  }

  return (
    <Link href="/activity">
      <div className="flex items-center space-x-2 px-4 py-3 text-white text-sm hover:bg-slate-800 rounded-lg transition-colors">
        <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
        <div className="flex-1 min-w-0">
          <div className="font-medium">{activity.running.length} running</div>
          <div className="text-xs text-slate-400 truncate">
            {firstRunning?.zone_name || `Relay ${firstRunning?.relay_channel}`}
            {firstRunning?.remaining_min ? ` • ${firstRunning.remaining_min}m` : ""}
          </div>
        </div>
      </div>
    </Link>
  );
}

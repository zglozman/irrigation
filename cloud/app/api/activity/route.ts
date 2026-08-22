// GET /api/activity — live activity (running + recent)

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { listUserSubs, getSchedules, getZone } from "@/lib/dynamo";
import { getAllRelayStates } from "@/lib/iot-mqtt";
import { runQuery } from "@/lib/athena";
import { config } from "@/lib/config";
import { cached } from "@/lib/weather-cache";

interface RunningItem {
  zone_id: string;
  zone_name: string | null;
  relay_channel: number;
  actual_start: string;
  scheduled_end: string;
  remaining_min: number;
  raw?: boolean; // true if relay is ON without an active schedule
}

interface RecentItem {
  timestamp: string;
  zone_id: string;
  relay_channel: number;
  trigger_type: string;
  outcome: string;
  actual_runtime_min: number | null;
  gallons_estimated_delivered: number;
  reason: string;
}

interface ActivityResponse {
  running: RunningItem[];
  recent: RecentItem[];
}

async function getRecentActivity(): Promise<RecentItem[]> {
  // Athena query: last 2 days of irrigation events
  const now = new Date();

  const dayTuples: string[] = [];
  for (let i = 0; i <= 2; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    dayTuples.push(`(year='${y}' AND month='${m}' AND day='${dd}')`);
  }
  const partitionPredicate = `(${dayTuples.join(" OR ")})`;

  // `zone` is the partition column carrying the 2-digit relay channel — the
  // JSON body has no relay_channel column in Glue.
  const sql = `SELECT timestamp, zone_id, zone, trigger_type, outcome, actual_runtime_min, gallons_estimated_delivered, reason FROM ${config.aws.athenaTable} WHERE ${partitionPredicate} ORDER BY timestamp DESC LIMIT 25`;

  const results = await runQuery(sql);

  return results.map((row: any) => ({
    timestamp: row.timestamp ?? "",
    zone_id: row.zone_id ?? "",
    relay_channel: row.zone != null ? parseInt(String(row.zone), 10) : 0,
    trigger_type: row.trigger_type ?? "",
    outcome: row.outcome ?? "",
    actual_runtime_min: row.actual_runtime_min != null ? Number(row.actual_runtime_min) : null,
    gallons_estimated_delivered:
      row.gallons_estimated_delivered != null ? Number(row.gallons_estimated_delivered) : 0,
    reason: row.reason ?? "",
  })) as RecentItem[];
}

export async function GET(_request: NextRequest) {
  try {
    await requireUser();

    const running: RunningItem[] = [];

    // Get all active schedules across all users
    const subs = await listUserSubs();
    const schedulesByChannel: Record<number, RunningItem> = {};

    for (const sub of subs) {
      const schedules = await getSchedules(sub);

      for (const sched of schedules) {
        if (sched.status === "ACTIVE" && sched.actual_start && sched.scheduled_end) {
          const now = new Date();
          const scheduledEnd = new Date(sched.scheduled_end);
          const remainingMin = Math.max(0, Math.round((scheduledEnd.getTime() - now.getTime()) / 60000));

          // Look up zone name
          let zoneName: string | null = null;
          try {
            const zone = await getZone(sub, sched.zone_id);
            zoneName = zone?.name || null;
          } catch {
            // Ignore zone lookup errors
          }

          schedulesByChannel[sched.relay_channel] = {
            zone_id: sched.zone_id,
            zone_name: zoneName,
            relay_channel: sched.relay_channel,
            actual_start: sched.actual_start,
            scheduled_end: sched.scheduled_end,
            remaining_min: remainingMin,
          };
        }
      }
    }

    // Get all relay states
    const relayStates = await getAllRelayStates();

    // Add active schedules to running list
    running.push(...Object.values(schedulesByChannel));

    // Add raw relay ON states not covered by active schedules
    for (let ch = 1; ch <= 16; ch++) {
      if (relayStates[ch] === "ON" && !schedulesByChannel[ch]) {
        running.push({
          zone_id: "",
          zone_name: null,
          relay_channel: ch,
          actual_start: new Date().toISOString(),
          scheduled_end: new Date().toISOString(),
          remaining_min: 0,
          raw: true,
        });
      }
    }

    // Sort running by remaining_min descending
    running.sort((a, b) => b.remaining_min - a.remaining_min);

    // Get recent activity (cached for 30s). An Athena hiccup must not take
    // down the DynamoDB-backed "running" list — degrade to empty.
    let recent: RecentItem[] = [];
    try {
      recent = await cached("activity-recent", 30000, getRecentActivity);
    } catch (err) {
      console.error("[Activity] recent query failed:", err);
    }

    return NextResponse.json({ running, recent } as ActivityResponse, { status: 200 });
  } catch (error) {
    console.error("[Activity] Error:", error);
    if (error instanceof Error && error.message.includes("No ID token")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "Failed to get activity";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET /api/history
// Query irrigation history from Athena
// Query params: zone=<id>&days=<count>

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { runQuery } from "@/lib/athena";
import { config } from "@/lib/config";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();

    const { searchParams } = new URL(request.url);
    const zoneParam = searchParams.get("zone");
    const daysParam = searchParams.get("days");

    // Validate zone as 1-16 integer (relay channel partition)
    let zoneId: number | null = null;
    if (zoneParam) {
      zoneId = parseInt(zoneParam, 10);
      if (isNaN(zoneId) || zoneId < 1 || zoneId > 16) {
        return NextResponse.json(
          { error: "Zone must be an integer between 1 and 16" },
          { status: 400 }
        );
      }
    }

    // Validate days as 1-365 integer
    const days = daysParam ? parseInt(daysParam, 10) : 7;
    if (isNaN(days) || days < 1 || days > 365) {
      return NextResponse.json(
        { error: "Days must be between 1 and 365" },
        { status: 400 }
      );
    }

    // Build Athena query with partition pruning
    const now = new Date();

    // One explicit (year, month, day) tuple per day in the range — values are
    // quoted, zero-padded strings matching the partition columns exactly, and
    // the whole disjunction is parenthesized so the zone predicate ANDs cleanly.
    const dayTuples: string[] = [];
    for (let i = 0; i <= days; i++) {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - i);
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(d.getUTCDate()).padStart(2, "0");
      dayTuples.push(`(year='${y}' AND month='${m}' AND day='${dd}')`);
    }
    const partitionPredicate = `(${dayTuples.join(" OR ")})`;

    let sql = `SELECT * FROM ${config.aws.athenaTable} WHERE ${partitionPredicate}`;

    if (zoneId !== null) {
      const zoneStr = String(zoneId).padStart(2, "0");
      sql += ` AND zone='${zoneStr}'`;
    }

    sql += ` ORDER BY timestamp DESC LIMIT 100`;

    const results = await runQuery(sql);

    return NextResponse.json(results, { status: 200 });
  } catch (error) {
    console.error("[History] Error:", error);
    const message = error instanceof Error ? error.message : "Failed to get history";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

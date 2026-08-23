// Forecast vs. actual accuracy aggregation
// Compares Tomorrow.io forecast snapshots to Weather Underground actuals

import { runQuery } from "@/lib/athena";
import { getWUDailySummaries } from "@/weather/wunderground";
import { resolveWUCredentials } from "@/weather";
import { cached } from "@/lib/weather-cache";
import { config } from "@/lib/config";

export interface DayAccuracy {
  date: string; // YYYY-MM-DD local
  pull_time: string | null; // ISO timestamp of the forecast snapshot pulled_at
  predicted_rain_in: number | null;
  predicted_prob_max: number | null;
  predicted_high_f: number | null;
  predicted_wind_max: number | null;
  actual_rain_in: number | null;
  actual_high_f: number | null;
  actual_wind_max: number | null;
}

export interface RainAccuracyHits {
  rain_called_right: number; // both predicted and fell, or both didn't
  misses: number; // fell but not predicted
  false_alarms: number; // predicted but didn't fall
  comparable_days: number; // days with both predicted and actual rain data
}

export interface ForecastAccuracyResult {
  source: "wunderground" | "none";
  days: number;
  days_data: DayAccuracy[];
  hits?: RainAccuracyHits;
}

/**
 * Select a day-ahead forecast pull using this logic:
 * 1. Find pull closest to (D 00:00 local minus 24h) within ±6h tolerance
 * 2. Else earliest pull with ≥12 forecast hours inside D
 * 3. Else null
 *
 * Returns the selected pull's pulled_at timestamp and rows for that single pull
 */
export function selectDayAheadPull(
  snapshotRows: Array<Record<string, unknown>>,
  localDateStr: string,
  timezone: string
): { pulled_at: string; rows: Array<Record<string, unknown>> } | null {
  // Target pull time: D 00:00 local minus 24h
  const [year, month, day] = localDateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  d.setDate(d.getDate() - 1);

  // Find UTC time for (D-1) 00:00 local by testing candidate times
  let targetPullTime = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0)).getTime();
  const expectedDateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  for (let hourOffset = 0; hourOffset <= 40; hourOffset++) {
    const candidate = new Date(targetPullTime + hourOffset * 60 * 60 * 1000);
    const formatted = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
    }).format(candidate);

    // Format is "YYYY-MM-DD, HH" with comma and space
    if (formatted.startsWith(expectedDateStr + ", ") && formatted.endsWith(", 00")) {
      targetPullTime = candidate.getTime();
      break;
    }
  }

  // Group rows by pulled_at
  const pullsByTime = new Map<string, Array<Record<string, unknown>>>();
  for (const row of snapshotRows) {
    const pulledAt = String(row.pulled_at || "");
    if (!pulledAt) continue;

    if (!pullsByTime.has(pulledAt)) {
      pullsByTime.set(pulledAt, []);
    }
    pullsByTime.get(pulledAt)!.push(row);
  }

  // Strategy 1: Find pull closest to 24h before D 00:00, within ±6h
  let closestDistance = Infinity;
  let closestPull: { pulled_at: string; rows: Array<Record<string, unknown>> } | null = null;

  for (const [pulledAtStr, rows] of pullsByTime.entries()) {
    const pullTime = new Date(pulledAtStr).getTime();
    const distance = Math.abs(pullTime - targetPullTime);
    const sixHoursMs = 6 * 60 * 60 * 1000;

    if (distance <= sixHoursMs && distance < closestDistance) {
      closestDistance = distance;
      closestPull = { pulled_at: pulledAtStr, rows };
    }
  }

  if (closestPull) {
    return closestPull;
  }

  // Strategy 2: Find earliest pull with ≥12 forecast hours inside D local date
  for (const [pulledAtStr, rows] of pullsByTime.entries()) {
    // Count rows with forecast_time inside D local date
    let countInDay = 0;
    for (const row of rows) {
      const forecastTimeStr = String(row.forecast_time || "");
      if (!forecastTimeStr) continue;

      const forecastTime = new Date(forecastTimeStr);
      const forecastLocalDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(forecastTime);

      if (forecastLocalDate === localDateStr) {
        countInDay++;
      }
    }

    if (countInDay >= 12) {
      // Pick the earliest pull so far
      if (!closestPull || new Date(pulledAtStr) < new Date(closestPull.pulled_at)) {
        closestPull = { pulled_at: pulledAtStr, rows };
      }
    }
  }

  return closestPull;
}

/**
 * PURE function: Aggregate forecast snapshots and actuals by calendar day
 * snapshotRows are Athena rows with string values that need coercion to numbers
 */
export function aggregateAccuracy(
  snapshotRows: Array<Record<string, unknown>>,
  wuDays: Array<{
    date_local: string;
    precip_total_in: number;
    temp_high_f: number | null;
    wind_high_mph: number | null;
  }>,
  days: number,
  timezone: string
): { days: DayAccuracy[]; hits?: RainAccuracyHits } {
  // Build a map of WU actuals by date for quick lookup
  const actualsByDate = new Map<
    string,
    { precip_in: number; temp_high_f: number | null; wind_max_mph: number | null }
  >();
  for (const day of wuDays) {
    actualsByDate.set(day.date_local, {
      precip_in: day.precip_total_in,
      temp_high_f: day.temp_high_f,
      wind_max_mph: day.wind_high_mph,
    });
  }

  // Generate date range: last `days` days in local timezone
  const result: DayAccuracy[] = [];
  const now = new Date();

  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);

    // Get local date YYYY-MM-DD
    const localDateStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);

    // Find the best pull for this day using selectDayAheadPull
    const selectedPull = selectDayAheadPull(snapshotRows, localDateStr, timezone);
    let selectedPullTime: string | null = selectedPull?.pulled_at ?? null;

    // Aggregate forecasts from the selected pull for this day
    let predictedRain: number | null = null;
    let predictedProbMax: number | null = null;
    let predictedHighF: number | null = null;
    let predictedWindMax: number | null = null;

    if (selectedPull) {
      let rainSum = 0;
      let hasRain = false;
      let probMax = 0;
      let tempMax = -Infinity;
      let windMax = 0;

      for (const row of selectedPull.rows) {
        const forecastTimeStr = String(row.forecast_time || "");
        if (!forecastTimeStr) continue;

        const forecastTime = new Date(forecastTimeStr);
        const forecastLocalDate = new Intl.DateTimeFormat("en-CA", {
          timeZone: timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(forecastTime);

        if (forecastLocalDate === localDateStr) {
          // Coerce string values to numbers
          const precipIn = Number(row.precip_in) || 0;
          const precipProb = Number(row.precip_prob) || 0;
          const tempF = Number(row.temp_f) || -Infinity;
          const windMph = Number(row.wind_mph) || 0;

          rainSum += precipIn;
          hasRain = true;
          probMax = Math.max(probMax, precipProb);
          tempMax = Math.max(tempMax, tempF);
          windMax = Math.max(windMax, windMph);
        }
      }

      if (hasRain) {
        predictedRain = rainSum;
        predictedProbMax = probMax;
        predictedHighF = tempMax > -Infinity ? tempMax : null;
        predictedWindMax = windMax;
      }
    }

    // Join actuals by date
    const actual = actualsByDate.get(localDateStr);

    result.push({
      date: localDateStr,
      pull_time: selectedPullTime,
      predicted_rain_in: predictedRain,
      predicted_prob_max: predictedProbMax,
      predicted_high_f: predictedHighF,
      predicted_wind_max: predictedWindMax,
      actual_rain_in: actual?.precip_in ?? null,
      actual_high_f: actual?.temp_high_f ?? null,
      actual_wind_max: actual?.wind_max_mph ?? null,
    });
  }

  // Reverse so newest is last (index 0 = oldest in the range)
  result.reverse();

  // Calculate accuracy stats (only when WU data is available)
  const hasActuals = result.some((d) => d.actual_rain_in !== null);
  let hits: RainAccuracyHits | undefined;

  if (hasActuals) {
    let rainCalledRight = 0;
    let misses = 0;
    let falseAlarms = 0;
    let comparableDays = 0;

    for (const day of result) {
      const hasPredicted = day.predicted_rain_in !== null;
      const hasActual = day.actual_rain_in !== null;

      if (hasPredicted && hasActual) {
        comparableDays++;

        const rainPredicted = (day.predicted_rain_in ?? 0) >= 0.1;
        const rainFell = (day.actual_rain_in ?? 0) >= 0.1;

        if (rainPredicted && rainFell) {
          rainCalledRight++;
        } else if (!rainPredicted && !rainFell) {
          rainCalledRight++;
        } else if (rainFell && !rainPredicted) {
          misses++;
        } else if (rainPredicted && !rainFell) {
          falseAlarms++;
        }
      }
    }

    if (comparableDays > 0) {
      hits = {
        rain_called_right: rainCalledRight,
        misses,
        false_alarms: falseAlarms,
        comparable_days: comparableDays,
      };
    }
  }

  return { days: result, hits };
}

/**
 * IO wrapper: Fetch forecast snapshots from Athena and actuals from WU (if configured)
 * Returns cached result with 30-minute TTL
 */
export async function getForecastAccuracy(
  days: number = 7
): Promise<ForecastAccuracyResult> {
  const cacheKey = `forecast-accuracy-${days}`;
  const ttlMs = 30 * 60 * 1000; // 30 minutes

  return cached(cacheKey, ttlMs, async () => {
    try {
      // Build partition predicate for last days+2 UTC days
      const dayTuples: string[] = [];
      const now = new Date();

      for (let i = 0; i <= days + 2; i++) {
        const d = new Date(now);
        d.setUTCDate(d.getUTCDate() - i);
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, "0");
        const dd = String(d.getUTCDate()).padStart(2, "0");
        dayTuples.push(`(year='${y}' AND month='${m}' AND day='${dd}')`);
      }
      const partitionPredicate = `(${dayTuples.join(" OR ")})`;

      const sql = `
        SELECT pulled_at, forecast_time, lead_hours, temp_f, wind_mph, precip_prob, precip_in
        FROM forecast_snapshots
        WHERE ${partitionPredicate}
        ORDER BY pulled_at DESC, forecast_time ASC
        LIMIT ${days * 80 * 30}
      `;

      const snapshotRows = await runQuery(sql);

      // Fetch WU actuals if configured
      let wuDays: Array<{
        date_local: string;
        precip_total_in: number;
        temp_high_f: number | null;
        wind_high_mph: number | null;
      }> = [];
      let source: "wunderground" | "none" = "none";

      try {
        const creds = await resolveWUCredentials();
        if (creds) {
          wuDays = await getWUDailySummaries(creds.stationId, creds.apiKey);
          source = "wunderground";
        }
      } catch (error) {
        console.error("[ForecastAccuracy] Failed to fetch WU actuals:", error);
        // Gracefully degrade: actuals just come back empty, forecast still shows
      }

      // Aggregate
      const { days: daysData, hits } = aggregateAccuracy(
        snapshotRows,
        wuDays,
        days,
        config.location.timezone
      );

      return {
        source,
        days,
        days_data: daysData,
        ...(hits && { hits }),
      };
    } catch (error) {
      console.error("[ForecastAccuracy] Error:", error);
      throw error;
    }
  });
}

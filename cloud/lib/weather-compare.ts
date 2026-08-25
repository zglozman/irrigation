// Hourly weather comparison: forecast vs. actual observations
// Compares Tomorrow.io forecast snapshots to Weather Underground hourly actuals

import { runQuery } from "@/lib/athena";
import { getWUHourlyHistory, getWUTodayObservations } from "@/weather/wunderground";
import { resolveWUCredentials } from "@/weather";
import { cached } from "@/lib/weather-cache";
import { config } from "@/lib/config";
import { selectDayAheadPull } from "@/lib/forecast-accuracy";

export interface HourlyComparison {
  time: string; // ISO string, hour start
  day_local: string; // YYYY-MM-DD in local timezone
  f_temp: number | null; // forecast temp
  f_wind: number | null; // forecast wind
  f_precip_in: number | null; // forecast precip
  f_prob: number | null; // forecast rain probability
  a_temp: number | null; // actual temp
  a_wind: number | null; // actual wind
  a_precip_in: number | null; // actual precip (hourly delta)
  a_humidity: number | null; // actual humidity
}

export interface ComparisonStats {
  temp: {
    mae: number | null;
    bias: number | null;
    hours_compared: number;
  };
  wind: {
    mae: number | null;
    bias: number | null;
    gate_agreement_pct: number | null;
  };
  rain: {
    forecast_total_in: number;
    actual_total_in: number;
    by_day: Array<{ day: string; f: number; a: number }>;
  };
}

export interface TodayObservation {
  time_local: string;
  temp_f: number | null;
  wind_mph: number | null;
  precip_accum_in: number;
  humidity: number | null;
}

export interface WeatherComparisonResult {
  source: "wunderground" | "none";
  days: number;
  hours: HourlyComparison[];
  stats: ComparisonStats;
  today_fine: TodayObservation[];
  station_id: string | null;
}

/**
 * Build hourly time series: both forecast and actual for each hour
 * - Forecast: extracted from day-ahead pull using selectDayAheadPull
 * - Actual: bucketed from observations (averages within hour, precip delta)
 */
export function buildHourlySeries(
  snapshotRows: Array<Record<string, unknown>>,
  actualRows: Array<{
    time_utc: string;
    time_local: string;
    temp_f: number | null;
    wind_mph: number | null;
    wind_high_mph: number | null;
    precip_accum_in: number;
    humidity: number | null;
  }>,
  days: number,
  timezone: string
): HourlyComparison[] {
  const hours: HourlyComparison[] = [];
  const now = new Date();

  // For each local day in the range
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);

    const localDateStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);

    // Select the day-ahead pull for this day
    const selectedPull = selectDayAheadPull(snapshotRows, localDateStr, timezone);

    // Build forecast map: hour_utc -> { temp, wind, precip, prob }
    const forecastByHour = new Map<string, { temp: number | null; wind: number | null; precip: number | null; prob: number | null }>();

    if (selectedPull) {
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
          // Round down to hour boundary in UTC
          const hourUtc = new Date(forecastTime);
          hourUtc.setUTCMinutes(0, 0, 0);
          const hourKey = hourUtc.toISOString();

          if (!forecastByHour.has(hourKey)) {
            forecastByHour.set(hourKey, { temp: null, wind: null, precip: null, prob: null });
          }
          const entry = forecastByHour.get(hourKey)!;

          const tempF = Number(row.temp_f) || null;
          const windMph = Number(row.wind_mph) || null;
          const precipIn = Number(row.precip_in) || 0;
          const precipProb = Number(row.precip_prob) || 0;

          if (entry.temp === null && tempF !== null) entry.temp = tempF;
          if (entry.wind === null && windMph !== null) entry.wind = windMph;
          entry.precip = (entry.precip || 0) + precipIn;
          if (entry.prob === null) entry.prob = precipProb;
          if (precipProb > (entry.prob || 0)) entry.prob = precipProb;
        }
      }
    }

    // Build actual observations map: hour_utc -> { temps[], winds[], humidity[], accum_at_end }
    const actualByHour = new Map<
      string,
      {
        temps: number[];
        winds: number[];
        wind_highs: number[];
        humidity_list: number[];
        accum_at_start: number;
        accum_at_end: number;
      }
    >();

    let lastAccum = 0;
    for (const obs of actualRows) {
      const obsTime = new Date(obs.time_utc);
      const obsLocalDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(obsTime);

      if (obsLocalDate !== localDateStr) continue;

      // Round down to hour boundary in UTC
      const hourUtc = new Date(obsTime);
      hourUtc.setUTCMinutes(0, 0, 0);
      const hourKey = hourUtc.toISOString();

      if (!actualByHour.has(hourKey)) {
        actualByHour.set(hourKey, {
          temps: [],
          winds: [],
          wind_highs: [],
          humidity_list: [],
          accum_at_start: lastAccum,
          accum_at_end: obs.precip_accum_in,
        });
      }
      const entry = actualByHour.get(hourKey)!;

      if (obs.temp_f !== null) entry.temps.push(obs.temp_f);
      if (obs.wind_mph !== null) entry.winds.push(obs.wind_mph);
      if (obs.wind_high_mph !== null) entry.wind_highs.push(obs.wind_high_mph);
      if (obs.humidity !== null) entry.humidity_list.push(obs.humidity);

      lastAccum = obs.precip_accum_in;
      entry.accum_at_end = obs.precip_accum_in;
    }

    // Merge forecast and actual for each hour of the day
    // Generate all hour keys for this local day (00:00..23:00 local)
    const dayStartUtc = new Date(Date.UTC(
      parseInt(localDateStr.split("-")[0], 10),
      parseInt(localDateStr.split("-")[1], 10) - 1,
      parseInt(localDateStr.split("-")[2], 10),
      0,
      0,
      0
    ));

    // Find UTC offset for the local date
    const midday = new Date(dayStartUtc);
    midday.setUTCHours(12);
    const middayFormatted = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
    }).format(midday);

    const midLocalHour = parseInt(middayFormatted.split(", ")[1], 10);
    const utcOffsetHours = 12 - midLocalHour;

    // Generate 24 hour keys for this local day
    for (let h = 0; h < 24; h++) {
      const hourUtc = new Date(dayStartUtc);
      hourUtc.setUTCHours((h + utcOffsetHours) % 24);
      if (h + utcOffsetHours >= 24) {
        hourUtc.setUTCDate(hourUtc.getUTCDate() + 1);
      }
      const hourKey = hourUtc.toISOString();

      const forecast = forecastByHour.get(hourKey);
      const actual = actualByHour.get(hourKey);

      const fTemp = forecast?.temp ?? null;
      const fWind = forecast?.wind ?? null;
      const fPrecip = forecast?.precip ?? null;
      const fProb = forecast?.prob ?? null;

      let aTemp: number | null = null;
      let aWind: number | null = null;
      let aHumidity: number | null = null;
      let aPrecip: number | null = null;

      if (actual) {
        if (actual.temps.length > 0) {
          aTemp = actual.temps.reduce((a, b) => a + b, 0) / actual.temps.length;
        }
        if (actual.winds.length > 0) {
          aWind = actual.winds.reduce((a, b) => a + b, 0) / actual.winds.length;
        }
        if (actual.humidity_list.length > 0) {
          aHumidity = actual.humidity_list.reduce((a, b) => a + b, 0) / actual.humidity_list.length;
        }
        // Precip: delta from start to end, clamped >= 0
        const delta = actual.accum_at_end - actual.accum_at_start;
        aPrecip = Math.max(0, delta);
      }

      hours.push({
        time: hourKey,
        day_local: localDateStr,
        f_temp: fTemp,
        f_wind: fWind,
        f_precip_in: fPrecip,
        f_prob: fProb,
        a_temp: aTemp,
        a_wind: aWind,
        a_precip_in: aPrecip,
        a_humidity: aHumidity,
      });
    }
  }

  // Reverse so oldest is first (matching forecast-accuracy pattern)
  hours.reverse();
  return hours;
}

/**
 * Compute accuracy statistics from hourly series
 * Only compares hours where both forecast and actual are non-null
 */
export function computeStats(hours: HourlyComparison[]): ComparisonStats {
  const tempPairs: Array<{ f: number; a: number }> = [];
  const windPairs: Array<{ f: number; a: number }> = [];
  const rainByDay = new Map<string, { f: number; a: number }>();

  for (const hour of hours) {
    if (hour.f_temp !== null && hour.a_temp !== null) {
      tempPairs.push({ f: hour.f_temp, a: hour.a_temp });
    }
    if (hour.f_wind !== null && hour.a_wind !== null) {
      windPairs.push({ f: hour.f_wind, a: hour.a_wind });
    }

    // Rain: sum by day
    if (!rainByDay.has(hour.day_local)) {
      rainByDay.set(hour.day_local, { f: 0, a: 0 });
    }
    const dayRain = rainByDay.get(hour.day_local)!;
    if (hour.f_precip_in !== null) {
      dayRain.f += hour.f_precip_in;
    }
    if (hour.a_precip_in !== null) {
      dayRain.a += hour.a_precip_in;
    }
  }

  // Temperature stats
  let tempMae: number | null = null;
  let tempBias: number | null = null;
  if (tempPairs.length > 0) {
    const errors = tempPairs.map(({ f, a }) => Math.abs(f - a));
    tempMae = errors.reduce((s, e) => s + e, 0) / errors.length;
    const biases = tempPairs.map(({ f, a }) => f - a);
    tempBias = biases.reduce((s, b) => s + b, 0) / biases.length;
  }

  // Wind stats
  let windMae: number | null = null;
  let windBias: number | null = null;
  let gateAgreement: number | null = null;
  if (windPairs.length > 0) {
    const errors = windPairs.map(({ f, a }) => Math.abs(f - a));
    windMae = errors.reduce((s, e) => s + e, 0) / errors.length;
    const biases = windPairs.map(({ f, a }) => f - a);
    windBias = biases.reduce((s, b) => s + b, 0) / biases.length;

    // Gate agreement: both sides agree on wind >= 10 mph
    const gateMatches = windPairs.filter(({ f, a }) => (f >= 10) === (a >= 10)).length;
    gateAgreement = (gateMatches / windPairs.length) * 100;
  }

  // Rain by day
  const rainByDayArray = Array.from(rainByDay.entries())
    .map(([day, { f, a }]) => ({ day, f, a }))
    .sort((a, b) => a.day.localeCompare(b.day));

  return {
    temp: {
      mae: tempMae,
      bias: tempBias,
      hours_compared: tempPairs.length,
    },
    wind: {
      mae: windMae,
      bias: windBias,
      gate_agreement_pct: gateAgreement,
    },
    rain: {
      forecast_total_in: Array.from(rainByDay.values()).reduce((s, { f }) => s + f, 0),
      actual_total_in: Array.from(rainByDay.values()).reduce((s, { a }) => s + a, 0),
      by_day: rainByDayArray,
    },
  };
}

/**
 * IO wrapper: Fetch forecast snapshots and WU actuals, build hourly series and stats
 * Returns cached result with 15-minute TTL
 */
export async function getWeatherComparison(days: number = 3): Promise<WeatherComparisonResult> {
  const cacheKey = `weather-compare-${days}`;
  const ttlMs = 15 * 60_000; // 15 minutes

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
      let actualRows: Array<{
        time_utc: string;
        time_local: string;
        temp_f: number | null;
        wind_mph: number | null;
        wind_high_mph: number | null;
        precip_accum_in: number;
        humidity: number | null;
      }> = [];
      let source: "wunderground" | "none" = "none";
      let stationId: string | null = null;
      let todayFine: TodayObservation[] = [];

      try {
        const creds = await resolveWUCredentials();
        if (creds) {
          stationId = creds.stationId;
          // Fetch hourly history for PAST days only (i >= 1) — today comes
          // from the fine-grained observations feed below; the history
          // endpoint lags hours behind for the current day, and mixing both
          // sources for the same day would interleave two accumulation
          // sequences and corrupt the hourly rain deltas.
          for (let i = 1; i < days; i++) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);

            const localDateStr = new Intl.DateTimeFormat("en-CA", {
              timeZone: config.location.timezone,
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).format(d);

            const dateYYYYMMDD = localDateStr.replace(/-/g, "");

            try {
              const dayRows = await getWUHourlyHistory(creds.stationId, creds.apiKey, dateYYYYMMDD);
              actualRows.push(...dayRows);
            } catch (error) {
              console.warn(`[WeatherCompare] Failed to fetch history for ${dateYYYYMMDD}:`, error);
            }
          }

          // Today's actuals: the fine-grained observations feed (~15-min).
          // These MUST join actualRows — this was the bug that kept the
          // page at "delivered 0.00in" through a downpour.
          const todayRows = await getWUTodayObservations(creds.stationId, creds.apiKey);
          actualRows.push(...todayRows);
          todayFine = todayRows.map((o) => ({
            time_local: o.time_local,
            temp_f: o.temp_f,
            wind_mph: o.wind_mph,
            precip_accum_in: o.precip_accum_in,
            humidity: o.humidity,
          }));

          // Bucketing derives hourly rain from accumulation deltas in row
          // order — keep the combined set chronological.
          actualRows.sort((a, b) => a.time_utc.localeCompare(b.time_utc));

          source = "wunderground";
        }
      } catch (error) {
        console.error("[WeatherCompare] Failed to fetch WU credentials:", error);
        // Gracefully degrade: actuals just come back empty
      }

      // Build hourly series
      const hours = buildHourlySeries(snapshotRows, actualRows, days, config.location.timezone);

      // Compute stats
      const stats = computeStats(hours);

      return {
        source,
        days,
        hours,
        stats,
        today_fine: todayFine,
        station_id: stationId,
      };
    } catch (error) {
      console.error("[WeatherCompare] Error:", error);
      throw error;
    }
  });
}

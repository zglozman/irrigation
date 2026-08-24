// Station weather history — daily aggregates and hourly detail from Athena
import { runQuery } from "@/lib/athena";
import { cached, cacheDelete } from "@/lib/weather-cache";

export interface DayRecord {
  date: string; // YYYY-MM-DD
  t_min: number; // degrees F
  t_max: number;
  t_avg: number;
  rain_in: number;
  wind_max: number; // mph
  hum_avg: number; // 0-100
}

export interface HourRecord {
  time_utc: string; // ISO format
  time_local: string; // YYYY-MM-DD HH:MM:SS
  temp_f: number;
  wind_mph: number;
  wind_high_mph: number;
  humidity: number;
  precip_accum_in: number;
  precip_hourly_in: number;
}

export interface MonthRecord {
  month: number; // 1-12
  rain_in: number;
  t_avg: number;
  t_max: number;
  t_min: number;
}

export interface YearStatistics {
  wettest_day: { date: string; rain_in: number } | null;
  hottest_day: { date: string; t_max: number } | null;
  coldest_morning: { date: string; t_min: number } | null;
  windiest_day: { date: string; wind_max: number } | null;
  longest_dry_spell: { start: string; end: string; days: number } | null;
  rain_total_in: number;
  rain_days: number; // days with >= 0.05 in
}

export interface YearHistory {
  year: number;
  days: DayRecord[];
  records: YearStatistics;
  monthly: MonthRecord[];
}

/**
 * PURE: Convert Athena day-aggregate rows (strings) to typed DayRecord array
 */
export function summarizeDays(rows: Array<Record<string, unknown>>, year: number): DayRecord[] {
  // Rows carry only month/day (year is the partition constraint) — build the
  // full YYYY-MM-DD here, zero-padded, so grid joins by date string work.
  return rows.map((row) => ({
    date: `${year}-${String(row.month).padStart(2, "0")}-${String(row.day).padStart(2, "0")}`,
    t_min: Number(row.t_min) || 0,
    t_max: Number(row.t_max) || 0,
    t_avg: Number(row.t_avg) || 0,
    rain_in: Number(row.rain_in) || 0,
    wind_max: Number(row.wind_max) || 0,
    hum_avg: Number(row.hum_avg) || 0,
  }));
}

/**
 * PURE: Compute year statistics from day records
 */
export function computeYearStats(days: DayRecord[]): YearStatistics {
  if (days.length === 0) {
    return {
      wettest_day: null,
      hottest_day: null,
      coldest_morning: null,
      windiest_day: null,
      longest_dry_spell: null,
      rain_total_in: 0,
      rain_days: 0,
    };
  }

  // Wettest day
  let wettestDay: DayRecord | null = null;
  for (const day of days) {
    if (!wettestDay || day.rain_in > wettestDay.rain_in) {
      wettestDay = day;
    }
  }

  // Hottest day
  let hottestDay: DayRecord | null = null;
  for (const day of days) {
    if (!hottestDay || day.t_max > hottestDay.t_max) {
      hottestDay = day;
    }
  }

  // Coldest morning
  let coldestDay: DayRecord | null = null;
  for (const day of days) {
    if (!coldestDay || day.t_min < coldestDay.t_min) {
      coldestDay = day;
    }
  }

  // Windiest day
  let windiestDay: DayRecord | null = null;
  for (const day of days) {
    if (!windiestDay || day.wind_max > windiestDay.wind_max) {
      windiestDay = day;
    }
  }

  // Longest dry spell (consecutive days with rain_in < 0.05)
  let longestSpell: { start: string; end: string; days: number } | null = null;
  let currentSpellStart: string | null = null;
  let currentSpellDays = 0;

  for (let i = 0; i <= days.length; i++) {
    const isDry = i < days.length && days[i].rain_in < 0.05;

    if (isDry) {
      if (currentSpellStart === null) {
        currentSpellStart = days[i].date;
        currentSpellDays = 1;
      } else {
        currentSpellDays++;
      }
    } else {
      // Spell ended
      if (currentSpellStart !== null && currentSpellDays >= 2) {
        const endDate = i > 0 ? days[i - 1].date : currentSpellStart;
        if (
          !longestSpell ||
          currentSpellDays > longestSpell.days
        ) {
          longestSpell = {
            start: currentSpellStart,
            end: endDate,
            days: currentSpellDays,
          };
        }
      }
      currentSpellStart = null;
      currentSpellDays = 0;
    }
  }

  // Rain totals
  let rainTotal = 0;
  let rainyDays = 0;
  for (const day of days) {
    rainTotal += day.rain_in;
    if (day.rain_in >= 0.05) rainyDays++;
  }

  return {
    wettest_day: wettestDay ? { date: wettestDay.date, rain_in: wettestDay.rain_in } : null,
    hottest_day: hottestDay ? { date: hottestDay.date, t_max: hottestDay.t_max } : null,
    coldest_morning: coldestDay ? { date: coldestDay.date, t_min: coldestDay.t_min } : null,
    windiest_day: windiestDay ? { date: windiestDay.date, wind_max: windiestDay.wind_max } : null,
    longest_dry_spell: longestSpell,
    rain_total_in: rainTotal,
    rain_days: rainyDays,
  };
}

/**
 * PURE: Roll up daily records to monthly summaries
 */
export function rollupMonthly(days: DayRecord[]): MonthRecord[] {
  const monthMap = new Map<number, DayRecord[]>();

  for (const day of days) {
    const [, month] = day.date.split("-");
    const monthNum = Number(month);
    if (!monthMap.has(monthNum)) {
      monthMap.set(monthNum, []);
    }
    monthMap.get(monthNum)!.push(day);
  }

  const monthly: MonthRecord[] = [];
  for (let m = 1; m <= 12; m++) {
    const monthDays = monthMap.get(m) || [];
    if (monthDays.length === 0) continue;

    let rainSum = 0;
    let tempSum = 0;
    let tempMax = -Infinity;
    let tempMin = Infinity;

    for (const day of monthDays) {
      rainSum += day.rain_in;
      tempSum += day.t_avg;
      tempMax = Math.max(tempMax, day.t_max);
      tempMin = Math.min(tempMin, day.t_min);
    }

    monthly.push({
      month: m,
      rain_in: rainSum,
      t_avg: tempSum / monthDays.length,
      t_max: tempMax === -Infinity ? 0 : tempMax,
      t_min: tempMin === Infinity ? 0 : tempMin,
    });
  }

  return monthly;
}

/**
 * IO: Fetch and aggregate one year of daily data from Athena
 * ONE query: GROUP BY month, day with aggregates
 * Caching: 24h for past years, 30 min for current year
 */
export async function getYearHistory(year: number): Promise<YearHistory> {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const isPastYear = year < currentYear;
  const ttlMs = isPastYear ? 24 * 60 * 60 * 1000 : 30 * 60 * 1000;

  const cacheKey = `station-year-${year}`;

  return cached(cacheKey, ttlMs, async () => {
    const sql = `
      SELECT
        month,
        day,
        CAST(MIN(CAST(temp_f AS DOUBLE)) AS BIGINT) as t_min,
        CAST(MAX(CAST(temp_f AS DOUBLE)) AS BIGINT) as t_max,
        CAST(AVG(CAST(temp_f AS DOUBLE)) AS BIGINT) as t_avg,
        CAST(SUM(CAST(precip_hourly_in AS DOUBLE)) AS DOUBLE) as rain_in,
        CAST(MAX(CAST(wind_high_mph AS DOUBLE)) AS BIGINT) as wind_max,
        CAST(AVG(CAST(humidity AS DOUBLE)) AS BIGINT) as hum_avg
      FROM station_observations
      WHERE year='${String(year).padStart(4, "0")}'
      GROUP BY month, day
      ORDER BY month, day
    `;

    const rows = await runQuery(sql);
    const days = summarizeDays(rows, year);

    // Fill in missing dates with null records for the grid to handle
    const filledDays: DayRecord[] = [];
    const dayMap = new Map(days.map((d) => [d.date, d]));

    // Determine date range for the year
    let startDate = new Date(year, 0, 1);
    let endDate = new Date(year, 11, 31);
    if (year === currentYear) {
      // For current year, only go up to yesterday
      endDate = new Date(now);
      endDate.setUTCDate(endDate.getUTCDate() - 1);
    }

    const current = new Date(startDate);
    while (current <= endDate) {
      const dateStr = current.toISOString().split("T")[0];
      filledDays.push(
        dayMap.get(dateStr) || {
          date: dateStr,
          t_min: 0,
          t_max: 0,
          t_avg: 0,
          rain_in: 0,
          wind_max: 0,
          hum_avg: 0,
        }
      );
      current.setUTCDate(current.getUTCDate() + 1);
    }

    // Stats over REAL days only — zero-filled gaps would otherwise fabricate
    // records (a missing day is not a 0°F morning or a dry day).
    const records = computeYearStats(days);
    const monthly = rollupMonthly(days);

    return {
      year,
      days: filledDays,
      records,
      monthly,
    };
  });
}

/**
 * IO: Fetch one day's hourly data
 * Caching: 24h for past dates, 30 min for today
 */
export async function getDayDetail(date: string): Promise<HourRecord[]> {
  const [year, month, day] = date.split("-");
  const dateObj = new Date(Number(year), Number(month) - 1, Number(day));
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const isPastDay = dateObj < today;
  const ttlMs = isPastDay ? 24 * 60 * 60 * 1000 : 30 * 60 * 1000;

  const cacheKey = `station-day-${date}`;

  return cached(cacheKey, ttlMs, async () => {
    const sql = `
      SELECT
        time_utc,
        time_local,
        CAST(temp_f AS BIGINT) as temp_f,
        CAST(wind_mph AS DOUBLE) as wind_mph,
        CAST(wind_high_mph AS DOUBLE) as wind_high_mph,
        CAST(humidity AS BIGINT) as humidity,
        CAST(precip_accum_in AS DOUBLE) as precip_accum_in,
        CAST(precip_hourly_in AS DOUBLE) as precip_hourly_in
      FROM station_observations
      WHERE year='${year}' AND month='${month}' AND day='${day}'
      ORDER BY time_local ASC
    `;

    const rows = await runQuery(sql);
    return rows.map((row) => ({
      time_utc: String(row.time_utc || ""),
      time_local: String(row.time_local || ""),
      temp_f: Number(row.temp_f) || 0,
      wind_mph: Number(row.wind_mph) || 0,
      wind_high_mph: Number(row.wind_high_mph) || 0,
      humidity: Number(row.humidity) || 0,
      precip_accum_in: Number(row.precip_accum_in) || 0,
      precip_hourly_in: Number(row.precip_hourly_in) || 0,
    })) as HourRecord[];
  });
}

/**
 * IO: Get distinct years available in the table
 * Caching: 6h
 */
export async function getAvailableYears(): Promise<number[]> {
  const cacheKey = "station-years";
  const ttlMs = 6 * 60 * 60 * 1000;

  return cached(cacheKey, ttlMs, async () => {
    const sql = `SELECT DISTINCT CAST(year AS BIGINT) as year FROM station_observations ORDER BY year DESC`;
    const rows = await runQuery(sql);
    return rows
      .map((row) => Number(row.year))
      .filter((y) => y >= 2020 && y <= 2100)
      .sort((a, b) => b - a);
  });
}

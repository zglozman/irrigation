// Timezone-aware local time utilities
// Uses Intl.DateTimeFormat to convert UTC dates to local time

import { config } from "./config";

/**
 * Convert a UTC Date to wall-clock time components in the given timezone
 */
function wallClockInTz(dateUtc: Date, timeZone: string): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(dateUtc);

  const g = (t: string): number => Number(p.find((x) => x.type === t)!.value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
}

/**
 * Get local hour component from a UTC date
 */
export function getLocalHour(date: Date, timeZone: string = config.location.timezone): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone,
  });
  return parseInt(formatter.format(date), 10);
}

/**
 * Get local date (YYYY-MM-DD) from a UTC date
 */
export function getLocalDateString(date: Date): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: config.location.timezone,
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value || "2000";
  const month = parts.find((p) => p.type === "month")?.value || "01";
  const day = parts.find((p) => p.type === "day")?.value || "01";
  return `${year}-${month}-${day}`;
}

/**
 * Get local time components from a UTC date
 */
export function getLocalTime(
  date: Date,
  timeZone: string = config.location.timezone
): {
  hour: number;
  minute: number;
  second: number;
  year: number;
  month: number;
  day: number;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone,
  });

  const parts = formatter.formatToParts(date);
  const result: any = {};

  for (const part of parts) {
    if (part.type === "year") result.year = parseInt(part.value, 10);
    if (part.type === "month") result.month = parseInt(part.value, 10);
    if (part.type === "day") result.day = parseInt(part.value, 10);
    if (part.type === "hour") result.hour = parseInt(part.value, 10);
    if (part.type === "minute") result.minute = parseInt(part.value, 10);
    if (part.type === "second") result.second = parseInt(part.value, 10);
  }

  return result;
}

/**
 * Construct a UTC Date representing a specific local time
 * Uses iterative algorithm to handle DST and date boundaries correctly
 * Example: constructLocalTime(2026, 8, 20, 4, 0, 0) returns 2026-08-20T08:00:00Z for EDT
 */
export function constructLocalTime(
  year: number,
  month: number,
  day: number,
  hh: number,
  mm: number,
  ss: number = 0,
  timeZone: string = config.location.timezone
): Date {
  const target = Date.UTC(year, month - 1, day, hh, mm, ss);
  let guess = target;

  // Iterate up to 3 times to converge on the correct UTC timestamp
  for (let i = 0; i < 3; i++) {
    const diff = target - wallClockInTz(new Date(guess), timeZone);
    if (diff === 0) break;
    guess += diff;
  }

  return new Date(guess);
}

/**
 * Get "today at HH:00:00" in local time, as a UTC Date
 * If that time has passed, returns tomorrow at that time
 */
export function getNextWindowStart(hour: number): Date {
  const now = new Date();
  const local = getLocalTime(now);

  let targetDate = constructLocalTime(local.year, local.month, local.day, hour, 0, 0);

  // If target time has already passed today, use tomorrow
  if (targetDate <= now) {
    targetDate = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000);
  }

  return targetDate;
}

/**
 * Get the start of the current week (Sunday at 00:00:00 local time)
 */
export function getWeekStart(date: Date = new Date(), timeZone: string = config.location.timezone): Date {
  const local = getLocalTime(date, timeZone);

  // Get day of week (0 = Sunday, 1 = Monday, etc.)
  const testDate = constructLocalTime(local.year, local.month, local.day, 0, 0, 0, timeZone);
  const dayOfWeek = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone,
  }).format(testDate);

  const daysMap: Record<string, number> = {
    "Sunday": 0,
    "Monday": 1,
    "Tuesday": 2,
    "Wednesday": 3,
    "Thursday": 4,
    "Friday": 5,
    "Saturday": 6,
  };

  const dayIndex = daysMap[dayOfWeek] ?? 0;
  const daysBack = dayIndex; // 0 for Sunday (already at week start), 1 for Monday, etc.

  const weekStartUtc = new Date(testDate.getTime() - daysBack * 24 * 60 * 60 * 1000);
  return constructLocalTime(
    getLocalTime(weekStartUtc, timeZone).year,
    getLocalTime(weekStartUtc, timeZone).month,
    getLocalTime(weekStartUtc, timeZone).day,
    0,
    0,
    0,
    timeZone
  );
}

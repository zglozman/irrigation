// Scheduling logic and gates (rain, wind, freeze)
// Returns human-readable decision reasons

export interface HourlyForecast {
  time: string; // ISO timestamp
  tempF: number;
  windMph: number;
  precipProb: number; // 0-1
  precipIn: number;
}

export interface SchedulingDecision {
  should_run: boolean;
  reason: string;
  gated_by?: "rain" | "wind" | "freeze" | "already_met" | "insufficient_flow";
}

/**
 * Rain skip gate: skip if high probability of significant rain within 48h
 * Condition: (prob_48h >= 60% AND amount_48h >= 0.1in) OR any single >= 0.25in within 24h
 */
export function rainSkipGate(forecast: HourlyForecast[]): SchedulingDecision {
  // Check 48-hour window
  const forecast48h = forecast.slice(0, 48); // Assume 48 hourly entries = 48 hours
  let totalPrecip48h = 0;
  let maxProb48h = 0;

  for (const f of forecast48h) {
    totalPrecip48h += f.precipIn;
    maxProb48h = Math.max(maxProb48h, f.precipProb);
  }

  // Check for single event >= 0.25in within 24h
  const forecast24h = forecast.slice(0, 24);
  let maxHourly24h = 0;
  for (const f of forecast24h) {
    maxHourly24h = Math.max(maxHourly24h, f.precipIn);
  }

  if (maxHourly24h >= 0.25) {
    return {
      should_run: false,
      reason: `Rain skip: significant rain event predicted (${maxHourly24h.toFixed(2)} in within 24h)`,
      gated_by: "rain",
    };
  }

  if (maxProb48h >= 0.6 && totalPrecip48h >= 0.1) {
    return {
      should_run: false,
      reason: `Rain skip: high probability of rain within 48h (${(maxProb48h * 100).toFixed(0)}% prob, ${totalPrecip48h.toFixed(2)} in total)`,
      gated_by: "rain",
    };
  }

  return { should_run: true, reason: "" };
}

/**
 * Wind gate: skip if forecast wind > 10 mph during irrigation window (04:00-08:00 local)
 */
export function windGate(forecast: HourlyForecast[], timezone: string): SchedulingDecision {
  // Select forecast entries whose LOCAL hour falls in 04:00-08:00
  const { getLocalHour } = require("@/lib/localtime");

  const windowForecast = forecast.filter((f) => {
    const hour = getLocalHour(new Date(f.time));
    return hour >= 4 && hour < 8;
  });

  if (windowForecast.length === 0) {
    // No forecast data for window, allow
    return { should_run: true, reason: "" };
  }

  let maxWind = 0;
  for (const f of windowForecast) {
    maxWind = Math.max(maxWind, f.windMph);
  }

  if (maxWind > 10) {
    return {
      should_run: false,
      reason: `Wind gate: forecast wind ${maxWind.toFixed(1)} mph exceeds 10 mph threshold during irrigation window (04:00-08:00 local)`,
      gated_by: "wind",
    };
  }

  return { should_run: true, reason: "" };
}

/**
 * Freeze gate: skip if forecast low < 36°F during irrigation window (04:00-08:00 local)
 */
export function freezeGate(forecast: HourlyForecast[], timezone: string): SchedulingDecision {
  const { getLocalHour } = require("@/lib/localtime");

  // Select forecast entries whose LOCAL hour falls in 04:00-08:00
  const windowForecast = forecast.filter((f) => {
    const hour = getLocalHour(new Date(f.time));
    return hour >= 4 && hour < 8;
  });

  if (windowForecast.length === 0) {
    // No forecast data for window, allow
    return { should_run: true, reason: "" };
  }

  let minTemp = 999;
  for (const f of windowForecast) {
    minTemp = Math.min(minTemp, f.tempF);
  }

  if (minTemp < 36) {
    return {
      should_run: false,
      reason: `Freeze gate: forecast low ${minTemp.toFixed(1)}°F is below 36°F during irrigation window (04:00-08:00 local)`,
      gated_by: "freeze",
    };
  }

  return { should_run: true, reason: "" };
}

/**
 * Irrigation window gate: only run 04:00-08:00 local time
 * Returns next available window start if outside current window
 */
export function irrigationWindowGate(nowLocal: Date, timezone: string): SchedulingDecision {
  const { getLocalHour } = require("@/lib/localtime");
  const hour = getLocalHour(nowLocal, timezone);

  // Irrigation window is 04:00 (4am) to 08:00 (8am) in local time
  if (hour >= 4 && hour < 8) {
    return { should_run: true, reason: "" };
  }

  // Outside window - calculate next window start
  const nextWindowHour = hour < 4 ? 4 : 4 + 24; // 4 AM next day if past 8 AM
  const hoursUntilWindow = (nextWindowHour % 24 - hour + 24) % 24;

  return {
    should_run: false,
    reason: `Outside irrigation window (04:00-08:00 local): next window in ${hoursUntilWindow} hours`,
    gated_by: "insufficient_flow", // Placeholder gate type
  };
}

/**
 * Combined scheduling decision: runs through all gates
 */
export function scheduleDecision(params: {
  remainingGal: number;
  forecast: HourlyForecast[];
  timezone: string;
  nowLocal: Date;
  supplyCapacityGph: number;
  requiredFlowGph: number;
}): SchedulingDecision {
  const {
    remainingGal,
    forecast,
    timezone,
    nowLocal,
    supplyCapacityGph,
    requiredFlowGph,
  } = params;

  // Check if target already met
  if (remainingGal <= 0) {
    return {
      should_run: false,
      reason: `Water target already met (remaining: ${remainingGal.toFixed(2)} gal)`,
      gated_by: "already_met",
    };
  }

  // Check irrigation window
  const windowDecision = irrigationWindowGate(nowLocal, timezone);
  if (!windowDecision.should_run) {
    return windowDecision;
  }

  // Check supply capacity
  if (requiredFlowGph > supplyCapacityGph) {
    return {
      should_run: false,
      reason: `Flow requirement (${requiredFlowGph.toFixed(1)} gph) exceeds supply capacity (${supplyCapacityGph} gph)`,
      gated_by: "insufficient_flow",
    };
  }

  // Check rain skip
  const rainDecision = rainSkipGate(forecast);
  if (!rainDecision.should_run) {
    return rainDecision;
  }

  // Check wind
  const windDecision = windGate(forecast, timezone);
  if (!windDecision.should_run) {
    return windDecision;
  }

  // Check freeze
  const freezeDecision = freezeGate(forecast, timezone);
  if (!freezeDecision.should_run) {
    return freezeDecision;
  }

  return {
    should_run: true,
    reason: `All gates passed: conditions favorable for irrigation`,
  };
}

/**
 * Zone sequencing: given a list of zones needing water, order them so concurrent
 * flow never exceeds supply capacity
 */
export interface ZoneToSchedule {
  zone_id: string;
  flow_gph: number;
  runtime_min: number;
}

export interface ScheduledZone extends ZoneToSchedule {
  start_time: Date; // When to turn ON
  end_time: Date; // When to turn OFF
  sequence_order: number;
}

export function sequenceZones(
  zones: ZoneToSchedule[],
  windowStartLocal: Date,
  supplyCapacityGph: number
): ScheduledZone[] {
  const scheduled: ScheduledZone[] = [];
  let currentTime = new Date(windowStartLocal);
  let concurrentFlow = 0;

  // Sort by flow rate (largest first) to pack efficiently
  const sorted = [...zones].sort((a, b) => b.flow_gph - a.flow_gph);

  for (const zone of sorted) {
    // If adding this zone exceeds capacity, move it to after current zones finish
    if (concurrentFlow + zone.flow_gph > supplyCapacityGph) {
      // Start after all previous zones finish
      currentTime = new Date(Math.max(...scheduled.map((z) => z.end_time.getTime())));
      concurrentFlow = 0;
    }

    const startTime = new Date(currentTime);
    const endTime = new Date(startTime.getTime() + zone.runtime_min * 60 * 1000);

    scheduled.push({
      ...zone,
      start_time: startTime,
      end_time: endTime,
      sequence_order: scheduled.length + 1,
    });

    concurrentFlow += zone.flow_gph;
  }

  return scheduled;
}

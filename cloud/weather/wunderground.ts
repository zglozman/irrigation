// Weather Underground Personal Weather Station (PWS) provider
// Implements RainfallProvider using 7-day daily summaries and current observations

import { RainfallProvider } from "./types";
import { config } from "@/lib/config";

const WU_API_BASE = "https://api.weather.com/v2/pws";

export interface WUValidationResult {
  ok: boolean;
  neighborhood?: string;
  obs_time?: string;
  precip_today_in?: number;
  temp_f?: number;
  error?: string;
}

class WundergroundProvider implements RainfallProvider {
  private stationId: string;
  private apiKey: string;

  constructor(stationId: string, apiKey: string) {
    this.stationId = stationId;
    this.apiKey = apiKey;
  }

  /**
   * Get rainfall accumulation since a given time
   * Fetches 7-day daily summaries and sums precipTotal for days >= sinceIso date
   */
  async getRainfallSince(sinceIso: string, _lat: number, _lon: number): Promise<number> {
    const sinceDate = new Date(sinceIso);
    // Extract UTC date components and create a normalized UTC date at midnight
    const sinceDateUtc = new Date(Date.UTC(sinceDate.getUTCFullYear(), sinceDate.getUTCMonth(), sinceDate.getUTCDate()));

    const url = `${WU_API_BASE}/dailysummary/7day?stationId=${encodeURIComponent(
      this.stationId
    )}&format=json&units=e&apiKey=${encodeURIComponent(this.apiKey)}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(url, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      // 204 is a 2xx (response.ok is true): station exists but has no data.
      if (response.status === 204) {
        return 0;
      }
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("Invalid Weather Underground API key");
        }
        throw new Error(
          `Weather Underground API error: ${response.status} ${response.statusText}`
        );
      }

      const data = (await response.json()) as {
        summaries?: Array<{
          stationID: string;
          obsTimeUtc: string;
          obsTimeLocal?: string;
          imperial: { precipTotal: number | null };
        }>;
      };

      if (!data.summaries || data.summaries.length === 0) {
        return 0;
      }

      // Summaries are per station-local day; compare local dates so a Sunday
      // summary stamped just past midnight UTC doesn't leak into Monday's week.
      const sinceLocalDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: config.location.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(sinceIso)); // YYYY-MM-DD

      let totalRainIn = 0;
      for (const summary of data.summaries) {
        const local = summary.obsTimeLocal || summary.obsTimeUtc;
        const summaryLocalDate = local.slice(0, 10); // YYYY-MM-DD prefix

        if (summaryLocalDate >= sinceLocalDate) {
          const precip = summary.imperial?.precipTotal || 0;
          totalRainIn += precip;
        }
      }

      // Warn if sinceIso is older than 7 days
      const nowDate = new Date();
      const nowDateUtc = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate()));
      const daysDiff = Math.floor((nowDateUtc.getTime() - sinceDateUtc.getTime()) / (1000 * 60 * 60 * 24));
      if (daysDiff > 7) {
        console.warn(
          `[WU] getRainfallSince requested ${daysDiff} days old; only 7 days available. Summed available days.`
        );
      }

      return totalRainIn;
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") {
        throw new Error("Weather Underground API timeout (10s)");
      }
      throw new Error(
        `Weather Underground rainfall fetch failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}

/**
 * Validate a Weather Underground station by fetching current observations
 * Returns status info if ok, or error details if not
 */
export async function validateWUStation(
  stationId: string,
  apiKey: string
): Promise<WUValidationResult> {
  const url = `${WU_API_BASE}/observations/current?stationId=${encodeURIComponent(
    stationId
  )}&format=json&units=e&apiKey=${encodeURIComponent(apiKey)}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    // 204 is a 2xx (response.ok is true): valid key, station silent.
    if (response.status === 204) {
      return { ok: false, error: "station not found or not reporting" };
    }
    if (!response.ok) {
      if (response.status === 401) {
        return { ok: false, error: "invalid api key" };
      }
      if (response.status === 404) {
        return { ok: false, error: "station not found or not reporting" };
      }
      return {
        ok: false,
        error: `API error: ${response.status} ${response.statusText}`,
      };
    }

    const data = (await response.json()) as {
      observations?: Array<{
        stationID: string;
        obsTimeUtc: string;
        neighborhood: string;
        imperial: {
          temp: number;
          precipRate: number;
          precipTotal: number;
        };
      }>;
    };

    const obs = data.observations?.[0];
    if (!obs) {
      return { ok: false, error: "station not found or not reporting" };
    }

    return {
      ok: true,
      neighborhood: obs.neighborhood,
      obs_time: obs.obsTimeUtc,
      precip_today_in: obs.imperial.precipTotal,
      temp_f: obs.imperial.temp,
    };
  } catch (error) {
    if (error instanceof TypeError && (error as any).name === "AbortError") {
      return { ok: false, error: "API timeout (10s)" };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function getWUDailySummaries(
  stationId: string,
  apiKey: string
): Promise<
  Array<{
    date_local: string; // YYYY-MM-DD from obsTimeLocal
    precip_total_in: number;
    temp_high_f: number | null;
    wind_high_mph: number | null;
  }>
> {
  const url = `${WU_API_BASE}/dailysummary/7day?stationId=${encodeURIComponent(
    stationId
  )}&format=json&units=e&apiKey=${encodeURIComponent(apiKey)}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    // 204 is a 2xx (response.ok is true): station exists but has no data.
    if (response.status === 204) {
      return [];
    }
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("Invalid Weather Underground API key");
      }
      throw new Error(
        `Weather Underground API error: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as {
      summaries?: Array<{
        stationID: string;
        obsTimeUtc: string;
        obsTimeLocal?: string;
        imperial: {
          precipTotal: number | null;
          tempHigh?: number | null;
          windspeedHigh?: number | null;
        };
      }>;
    };

    if (!data.summaries || data.summaries.length === 0) {
      return [];
    }

    return data.summaries.map((summary) => {
      const local = summary.obsTimeLocal || summary.obsTimeUtc;
      const dateLocal = local.slice(0, 10); // YYYY-MM-DD prefix

      return {
        date_local: dateLocal,
        precip_total_in: summary.imperial?.precipTotal ?? 0,
        temp_high_f: summary.imperial?.tempHigh ?? null,
        wind_high_mph: summary.imperial?.windspeedHigh ?? null,
      };
    });
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") {
      throw new Error("Weather Underground API timeout (10s)");
    }
    throw new Error(
      `Weather Underground daily summaries fetch failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

export function createWUProvider(stationId: string, apiKey: string): WundergroundProvider {
  return new WundergroundProvider(stationId, apiKey);
}

/**
 * Get hourly history for a past day (up to ~24 observations)
 * Returns observations with time, temperature, wind, precipitation, humidity
 */
export async function getWUHourlyHistory(
  stationId: string,
  apiKey: string,
  dateYYYYMMDD: string
): Promise<
  Array<{
    time_utc: string;
    time_local: string;
    temp_f: number | null;
    wind_mph: number | null;
    wind_high_mph: number | null;
    precip_accum_in: number;
    humidity: number | null;
  }>
> {
  const url = `https://api.weather.com/v2/pws/history/hourly?stationId=${encodeURIComponent(
    stationId
  )}&format=json&units=e&date=${encodeURIComponent(dateYYYYMMDD)}&apiKey=${encodeURIComponent(apiKey)}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    // 204 is a 2xx (response.ok is true): station exists but has no data for this date.
    if (response.status === 204) {
      return [];
    }
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("Invalid Weather Underground API key");
      }
      throw new Error(
        `Weather Underground API error: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as {
      observations?: Array<{
        obsTimeUtc: string;
        obsTimeLocal: string;
        humidityAvg?: number | null;
        imperial?: {
          tempAvg?: number | null;
          windspeedAvg?: number | null;
          windspeedHigh?: number | null;
          precipRate?: number | null;
          precipTotal?: number | null;
        };
      }>;
    };

    if (!data.observations || data.observations.length === 0) {
      return [];
    }

    return data.observations.map((obs) => {
      const imperial = obs.imperial || {};
      return {
        time_utc: obs.obsTimeUtc,
        time_local: obs.obsTimeLocal,
        temp_f: imperial.tempAvg ?? null,
        wind_mph: imperial.windspeedAvg ?? null,
        wind_high_mph: imperial.windspeedHigh ?? null,
        precip_accum_in: imperial.precipTotal ?? 0,
        humidity: obs.humidityAvg ?? null,
      };
    });
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") {
      throw new Error("Weather Underground API timeout (10s)");
    }
    throw new Error(
      `Weather Underground hourly history fetch failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Get today's fine-grained observations (15-min resolution, ~50-100 rows)
 * Returns same shape as hourly history
 */
export async function getWUTodayObservations(
  stationId: string,
  apiKey: string
): Promise<
  Array<{
    time_utc: string;
    time_local: string;
    temp_f: number | null;
    wind_mph: number | null;
    wind_high_mph: number | null;
    precip_accum_in: number;
    humidity: number | null;
  }>
> {
  const url = `https://api.weather.com/v2/pws/observations/all/1day?stationId=${encodeURIComponent(
    stationId
  )}&format=json&units=e&apiKey=${encodeURIComponent(apiKey)}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    // 204 is a 2xx (response.ok is true): station exists but has no data.
    if (response.status === 204) {
      return [];
    }
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("Invalid Weather Underground API key");
      }
      throw new Error(
        `Weather Underground API error: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as {
      observations?: Array<{
        obsTimeUtc: string;
        obsTimeLocal: string;
        humidityAvg?: number | null;
        imperial?: {
          tempAvg?: number | null;
          windspeedAvg?: number | null;
          windspeedHigh?: number | null;
          precipRate?: number | null;
          precipTotal?: number | null;
        };
      }>;
    };

    if (!data.observations || data.observations.length === 0) {
      return [];
    }

    return data.observations.map((obs) => {
      const imperial = obs.imperial || {};
      return {
        time_utc: obs.obsTimeUtc,
        time_local: obs.obsTimeLocal,
        temp_f: imperial.tempAvg ?? null,
        wind_mph: imperial.windspeedAvg ?? null,
        wind_high_mph: imperial.windspeedHigh ?? null,
        precip_accum_in: imperial.precipTotal ?? 0,
        humidity: obs.humidityAvg ?? null,
      };
    });
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") {
      throw new Error("Weather Underground API timeout (10s)");
    }
    throw new Error(
      `Weather Underground today observations fetch failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

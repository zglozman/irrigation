// Weather provider factory and selection
// Selects the appropriate providers based on configuration

import { ForecastProvider, RainfallProvider } from "./types";
import { createTomorrowIOProvider } from "./tomorrow-io";
import { createTempestProvider } from "./tempest";
import { createWUProvider } from "./wunderground";
import { scrapePublicWUKey, invalidateScrapedWUKey } from "./wu-scrape";
import { config } from "@/lib/config";
import { getWeatherSettings } from "@/lib/dynamo";
import { cached, cacheDelete } from "@/lib/weather-cache";

/**
 * Resolve WU credentials: a stored API key wins; with only a station id, the
 * public web key is scraped from the station's dashboard page (cached 24h).
 * Returns null when no station is configured.
 */
export async function resolveWUCredentials(): Promise<{
  stationId: string;
  apiKey: string;
  scraped: boolean;
} | null> {
  const settings = await cached("weather-settings", 5 * 60_000, () => getWeatherSettings());
  if (!settings?.wu_station_id) return null;

  if (settings.wu_api_key) {
    return { stationId: settings.wu_station_id, apiKey: settings.wu_api_key, scraped: false };
  }
  const apiKey = await scrapePublicWUKey(settings.wu_station_id);
  return { stationId: settings.wu_station_id, apiKey, scraped: true };
}

let forecastProvider: ForecastProvider | null = null;

/**
 * Get the forecast provider (always Tomorrow.io)
 */
export function getForecastProvider(): ForecastProvider {
  if (!forecastProvider) {
    forecastProvider = createTomorrowIOProvider();
  }
  return forecastProvider;
}

/**
 * Get the rainfall provider with priority:
 * 1. Weather Underground (if configured in DynamoDB)
 * 2. Tempest (if env configured)
 * 3. Tomorrow.io (fallback)
 */
export async function getRainfallProvider(): Promise<RainfallProvider> {
  let wu: Awaited<ReturnType<typeof resolveWUCredentials>> = null;
  try {
    wu = await resolveWUCredentials();
  } catch (error) {
    console.error("[Weather] WU key scrape failed, falling back:", error);
  }

  if (wu) {
    const { stationId, apiKey, scraped } = wu;
    return {
      // If the scraped web key rotates, WU starts returning 401 — invalidate
      // the cached key, re-scrape once, and retry before giving up.
      async getRainfallSince(sinceIso: string, lat: number, lon: number): Promise<number> {
        try {
          return await createWUProvider(stationId, apiKey).getRainfallSince(sinceIso, lat, lon);
        } catch (error) {
          const invalidKey =
            error instanceof Error && error.message.includes("Invalid Weather Underground API key");
          if (scraped && invalidKey) {
            invalidateScrapedWUKey();
            const freshKey = await scrapePublicWUKey(stationId);
            return await createWUProvider(stationId, freshKey).getRainfallSince(sinceIso, lat, lon);
          }
          throw error;
        }
      },
    };
  }

  // Fall back to Tempest if configured with device ID
  if (config.weather.tempestToken && config.weather.tempestDeviceId) {
    return createTempestProvider(
      config.weather.tempestDeviceId,
      config.weather.tempestToken
    ) as unknown as RainfallProvider;
  }

  // Fall back to Tomorrow.io
  return createTomorrowIOProvider() as unknown as RainfallProvider;
}

/**
 * Get the current rainfall source name for display
 */
export async function getRainfallSource(): Promise<"wunderground" | "tempest" | "tomorrow.io"> {
  const weatherSettings = await cached(
    "weather-settings",
    5 * 60_000,
    () => getWeatherSettings()
  );

  if (weatherSettings?.wu_station_id) {
    return "wunderground";
  }

  if (config.weather.tempestToken && config.weather.tempestDeviceId) {
    return "tempest";
  }

  return "tomorrow.io";
}

/**
 * Invalidate weather settings cache
 */
export function invalidateWeatherSettingsCache(): void {
  cacheDelete("weather-settings");
}

/**
 * Check if Tempest is configured
 */
export function isTempestConfigured(): boolean {
  return !!(config.weather.tempestToken && config.weather.tempestDeviceId);
}

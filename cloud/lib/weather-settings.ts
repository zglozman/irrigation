// Shared weather settings update logic for API routes and chat tools

import {
  putWeatherSettings,
  getWeatherSettings,
} from "@/lib/dynamo";
import {
  validateWUStation,
  WUValidationResult,
} from "@/weather/wunderground";
import { scrapePublicWUKey } from "@/weather/wu-scrape";
import { invalidateWeatherSettingsCache } from "@/weather";

export interface SetRainStationResult {
  success: boolean;
  error?: string;
  wu_station_id?: string;
  validation?: WUValidationResult;
}

/**
 * Shared helper to validate and save weather station settings
 * @param stationId - Station ID (will be uppercased), or empty string to remove
 * @param apiKey - API key, or empty string to remove
 * @returns Result object with success flag and validation details
 */
export async function setRainStation(
  stationId: string,
  apiKey: string
): Promise<SetRainStationResult> {
  const cleanStationId = (stationId || "").trim();
  const cleanApiKey = (apiKey || "").trim();

  // An API key without a station is meaningless
  if (!cleanStationId && cleanApiKey) {
    return {
      success: false,
      error: "A station ID is required (the API key alone is not enough)",
    };
  }

  // If removing settings
  if (!cleanStationId) {
    await putWeatherSettings({ wu_station_id: undefined, wu_api_key: undefined });
    invalidateWeatherSettingsCache();
    return {
      success: true,
    };
  }

  // No key given: scrape the public web key from the station's dashboard page
  let effectiveKey = cleanApiKey;
  if (!effectiveKey) {
    try {
      effectiveKey = await scrapePublicWUKey(cleanStationId.toUpperCase());
    } catch (error) {
      return {
        success: false,
        error: `Could not fetch the public web key: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      };
    }
  }

  // Validate before saving
  const validation = await validateWUStation(cleanStationId, effectiveKey);

  if (!validation.ok) {
    return {
      success: false,
      error: validation.error || "Station validation failed",
      validation,
    };
  }

  // Save settings — an empty key means "scraped public web key" mode, so the
  // key is re-scraped (and self-heals on rotation) rather than pinned.
  await putWeatherSettings({
    wu_station_id: cleanStationId.toUpperCase(),
    wu_api_key: cleanApiKey || undefined,
  });

  invalidateWeatherSettingsCache();

  return {
    success: true,
    wu_station_id: cleanStationId.toUpperCase(),
    validation,
  };
}

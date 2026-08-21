// Weather provider factory and selection
// Selects the appropriate providers based on configuration

import { ForecastProvider, RainfallProvider } from "./types";
import { createTomorrowIOProvider } from "./tomorrow-io";
import { createTempestProvider } from "./tempest";
import { config } from "@/lib/config";

let forecastProvider: ForecastProvider | null = null;
let rainfallProvider: RainfallProvider | null = null;

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
 * Get the rainfall provider (Tempest if configured, else Tomorrow.io)
 */
export function getRainfallProvider(): RainfallProvider {
  if (!rainfallProvider) {
    // Prefer Tempest if configured with device ID
    if (config.weather.tempestToken && config.weather.tempestDeviceId) {
      rainfallProvider = createTempestProvider(
        config.weather.tempestDeviceId,
        config.weather.tempestToken
      ) as unknown as RainfallProvider;
    } else {
      // Fall back to Tomorrow.io
      rainfallProvider = createTomorrowIOProvider() as unknown as RainfallProvider;
    }
  }
  return rainfallProvider;
}

/**
 * Check if Tempest is configured
 */
export function isTempestConfigured(): boolean {
  return !!(config.weather.tempestToken && config.weather.tempestDeviceId);
}

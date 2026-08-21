// Tomorrow.io weather provider
// Implements both ForecastProvider and RainfallProvider

import { ForecastProvider, RainfallProvider, HourlyForecast } from "./types";
import { config } from "@/lib/config";

const TOMORROW_API_URL = "https://api.tomorrow.io/v4/timelines";

class TomorrowIOProvider implements ForecastProvider, RainfallProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Get hourly forecast for the next 72 hours
   */
  async getForecast(lat: number, lon: number): Promise<HourlyForecast[]> {
    const params = new URLSearchParams({
      location: `${lat},${lon}`,
      fields: "temperature,windSpeed,precipitationProbability,rainAccumulation",
      units: "imperial",
      timesteps: "1h",
      startTime: "now",
      endTime: "nowPlus72h",
      apikey: this.apiKey,
    });

    const response = await fetch(`${TOMORROW_API_URL}?${params}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Tomorrow.io forecast API error: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      data?: {
        timelines?: Array<{
          intervals?: Array<{
            startTime: string;
            values: {
              temperature?: number;
              windSpeed?: number;
              precipitationProbability?: number;
              rainAccumulation?: number;
            };
          }>;
        }>;
      };
    };

    const intervals = data.data?.timelines?.[0]?.intervals || [];

    return intervals.map((interval) => ({
      time: interval.startTime,
      tempF: interval.values.temperature || 0,
      windMph: interval.values.windSpeed || 0,
      precipProb: (interval.values.precipitationProbability || 0) / 100,
      precipIn: interval.values.rainAccumulation || 0,
    }));
  }

  /**
   * Get rainfall accumulation since a given time
   * Using historical/recent timelines
   */
  async getRainfallSince(sinceIso: string, lat: number, lon: number): Promise<number> {
    const params = new URLSearchParams({
      location: `${lat},${lon}`,
      fields: "rainAccumulation",
      units: "imperial",
      timesteps: "1h",
      startTime: sinceIso,
      endTime: "now",
      apikey: this.apiKey,
    });

    const response = await fetch(`${TOMORROW_API_URL}?${params}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Tomorrow.io rainfall API error: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      data?: {
        timelines?: Array<{
          intervals?: Array<{
            values: {
              rainAccumulation?: number;
            };
          }>;
        }>;
      };
    };

    const intervals = data.data?.timelines?.[0]?.intervals || [];
    const totalRain = intervals.reduce((sum, interval) => sum + (interval.values.rainAccumulation || 0), 0);

    return totalRain;
  }
}

export function createTomorrowIOProvider(): TomorrowIOProvider {
  const apiKey = config.weather.tomorrowApiKey;
  if (!apiKey) {
    throw new Error("TOMORROW_API_KEY is required");
  }
  return new TomorrowIOProvider(apiKey);
}

// WeatherFlow Tempest weather station provider
// Implements RainfallProvider using device-observations endpoint

import { RainfallProvider } from "./types";
import { config } from "@/lib/config";

const TEMPEST_DEVICE_URL = "https://swd.weatherflow.com/swd/rest/observations/device";

class TempestProvider implements RainfallProvider {
  private deviceId: string;
  private token: string;

  constructor(deviceId: string, token: string) {
    this.deviceId = deviceId;
    this.token = token;
  }

  /**
   * Get rainfall accumulation since a given time
   * Uses the device-observations endpoint, summing rain at index 12 (in mm)
   * Index 12 is rain over the previous minute in millimeters
   */
  async getRainfallSince(sinceIso: string, _lat: number, _lon: number): Promise<number> {
    const sinceTime = Math.floor(new Date(sinceIso).getTime() / 1000); // Unix timestamp
    const nowTime = Math.floor(new Date().getTime() / 1000);

    const url = `${TEMPEST_DEVICE_URL}/${this.deviceId}?time_start=${sinceTime}&time_end=${nowTime}&token=${this.token}`;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        throw new Error(`Tempest API error: ${response.statusText}`);
      }

      const data = (await response.json()) as {
        obs: Array<Array<number>>;
      };

      // Sum rain accumulation (index 12) from obs arrays and convert mm to inches (÷25.4)
      let totalRainMm = 0;
      if (data.obs && Array.isArray(data.obs)) {
        for (const obs of data.obs) {
          if (Array.isArray(obs) && obs[12] !== undefined && obs[12] !== null) {
            totalRainMm += obs[12];
          }
        }
      }

      // Convert millimeters to inches
      return totalRainMm / 25.4;
    } catch (error) {
      throw new Error(
        `Tempest rainfall fetch failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

export function createTempestProvider(deviceId: string, token: string): TempestProvider {
  return new TempestProvider(deviceId, token);
}

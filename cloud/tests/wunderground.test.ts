import { describe, it, expect, beforeEach, vi } from "vitest";
import { createWUProvider, validateWUStation, getWUDailySummaries, getWUHourlyHistory, getWUTodayObservations } from "@/weather/wunderground";
import { invalidateWeatherSettingsCache } from "@/weather";
import * as dynamo from "@/lib/dynamo";
import { config } from "@/lib/config";

// Mock fetch
vi.stubGlobal("fetch", vi.fn());

vi.mock("@/lib/dynamo");

describe("Weather Underground Provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as any).mockClear();
  });

  describe("createWUProvider", () => {
    it("creates a provider with station ID and API key", () => {
      const provider = createWUProvider("KABCD1234", "test-key-123");
      expect(provider).toBeDefined();
      expect(provider.getRainfallSince).toBeDefined();
    });
  });

  describe("getRainfallSince", () => {
    it("sums precipTotal for days >= since date", async () => {
      const provider = createWUProvider("KABCD1234", "test-key-123");

      const mockResponse = {
        summaries: [
          {
            stationID: "KABCD1234",
            obsTimeUtc: "2026-08-20T00:00:00Z",
            imperial: { precipTotal: 0.15 },
          },
          {
            stationID: "KABCD1234",
            obsTimeUtc: "2026-08-21T00:00:00Z",
            imperial: { precipTotal: 0.45 },
          },
          {
            stationID: "KABCD1234",
            obsTimeUtc: "2026-08-22T00:00:00Z",
            imperial: { precipTotal: 0.25 },
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await provider.getRainfallSince(
        "2026-08-21T12:00:00Z",
        40.7,
        -74.0
      );

      // Should include 08-21 (0.45) and 08-22 (0.25), exclude 08-20 (0.15)
      expect(result).toBe(0.7);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("stationId=KABCD1234"),
        expect.any(Object)
      );
    });

    it("returns 0 on 204 (station silent) instead of choking on the empty body", async () => {
      const provider = createWUProvider("KABCD1234", "test-key-123");
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: async () => {
          throw new SyntaxError("Unexpected end of JSON input");
        },
      });
      expect(await provider.getRainfallSince("2026-08-21T12:00:00Z", 40.7, -74.0)).toBe(0);
    });

    it("compares station-local days so late-UTC Sunday rain stays out of Monday's week", async () => {
      const provider = createWUProvider("KABCD1234", "test-key-123");
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          summaries: [
            {
              stationID: "KABCD1234",
              // Sunday local, but already Monday in UTC
              obsTimeUtc: "2026-08-17T03:59:00Z",
              obsTimeLocal: "2026-08-16 23:59:00",
              imperial: { precipTotal: 1.0 },
            },
            {
              stationID: "KABCD1234",
              obsTimeUtc: "2026-08-17T20:00:00Z",
              obsTimeLocal: "2026-08-17 16:00:00",
              imperial: { precipTotal: 0.2 },
            },
          ],
        }),
      });
      // Week starts Monday 2026-08-17 00:00 local (04:00 UTC)
      const result = await provider.getRainfallSince("2026-08-17T04:00:00Z", 29.8, -82.3);
      expect(result).toBe(0.2);
    });

    it("treats null precipTotal as 0", async () => {
      const provider = createWUProvider("KABCD1234", "test-key-123");

      const mockResponse = {
        summaries: [
          {
            stationID: "KABCD1234",
            obsTimeUtc: "2026-08-21T00:00:00Z",
            imperial: { precipTotal: null },
          },
          {
            stationID: "KABCD1234",
            obsTimeUtc: "2026-08-22T00:00:00Z",
            imperial: { precipTotal: 0.5 },
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await provider.getRainfallSince(
        "2026-08-21T00:00:00Z",
        40.7,
        -74.0
      );

      expect(result).toBe(0.5);
    });

    it("throws on 401 Unauthorized", async () => {
      const provider = createWUProvider("KABCD1234", "bad-key");

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      });

      await expect(
        provider.getRainfallSince("2026-08-21T00:00:00Z", 40.7, -74.0)
      ).rejects.toThrow("Invalid Weather Underground API key");
    });

    it("logs warning when sinceIso is older than 7 days", async () => {
      const provider = createWUProvider("KABCD1234", "test-key-123");
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const mockResponse = {
        summaries: [
          {
            stationID: "KABCD1234",
            obsTimeUtc: "2026-08-16T00:00:00Z",
            imperial: { precipTotal: 0.1 },
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      // Request from 10 days ago
      await provider.getRainfallSince(
        "2026-08-12T00:00:00Z",
        40.7,
        -74.0
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("requested")
      );
      consoleSpy.mockRestore();
    });

    it("handles timeout via AbortController", async () => {
      const provider = createWUProvider("KABCD1234", "test-key-123");

      (global.fetch as any).mockImplementationOnce(async (_url: string, options: any) => {
        if (options.signal) {
          // Simulate timeout by aborting
          const error = new TypeError("The operation was aborted");
          (error as any).name = "AbortError";
          throw error;
        }
        return { ok: true, json: async () => ({ summaries: [] }) };
      });

      await expect(
        provider.getRainfallSince("2026-08-21T00:00:00Z", 40.7, -74.0)
      ).rejects.toThrow("timeout");
    });
  });

  describe("validateWUStation", () => {
    it("returns ok status with station info on success", async () => {
      const mockResponse = {
        observations: [
          {
            stationID: "KABCD1234",
            obsTimeUtc: "2026-08-22T14:30:00Z",
            neighborhood: "Downtown",
            imperial: {
              temp: 85.5,
              precipRate: 0.05,
              precipTotal: 0.35,
            },
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await validateWUStation("KABCD1234", "test-key-123");

      expect(result.ok).toBe(true);
      expect(result.neighborhood).toBe("Downtown");
      expect(result.temp_f).toBe(85.5);
      expect(result.precip_today_in).toBe(0.35);
      expect(result.obs_time).toBe("2026-08-22T14:30:00Z");
    });

    it("returns invalid api key error on 401", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      const result = await validateWUStation("KABCD1234", "bad-key");

      expect(result.ok).toBe(false);
      expect(result.error).toBe("invalid api key");
    });

    it("returns station not reporting error on 204", async () => {
      // Regression: 204 is a 2xx, so real fetch sets ok: true with an empty
      // body — the handler must catch it before attempting response.json().
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: async () => {
          throw new SyntaxError("Unexpected end of JSON input");
        },
      });

      const result = await validateWUStation("KABCD1234", "test-key-123");

      expect(result.ok).toBe(false);
      expect(result.error).toBe("station not found or not reporting");
    });

    it("returns station not reporting error on 404", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await validateWUStation("KABCD1234", "test-key-123");

      expect(result.ok).toBe(false);
      expect(result.error).toBe("station not found or not reporting");
    });

    it("returns station not reporting error when no observations", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ observations: [] }),
      });

      const result = await validateWUStation("KABCD1234", "test-key-123");

      expect(result.ok).toBe(false);
      expect(result.error).toBe("station not found or not reporting");
    });

    it("never throws", async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error("Network error"));

      const result = await validateWUStation("KABCD1234", "test-key-123");

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("getRainfallProvider priority", () => {
    it("selects WU when configured in DynamoDB", async () => {
      invalidateWeatherSettingsCache();

      vi.mocked(dynamo.getWeatherSettings).mockResolvedValueOnce({
        PK: "APP",
        SK: "SETTINGS#WEATHER",
        wu_station_id: "KABCD1234",
        wu_api_key: "test-key-123",
        updated_at: new Date().toISOString(),
      });

      const { getRainfallProvider } = await import("@/weather");
      const provider = await getRainfallProvider();
      expect(provider).toBeDefined();

      const mockResponse = {
        summaries: [
          {
            stationID: "KABCD1234",
            obsTimeUtc: "2026-08-22T00:00:00Z",
            imperial: { precipTotal: 0.5 },
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await provider.getRainfallSince(
        "2026-08-22T00:00:00Z",
        40.7,
        -74.0
      );

      expect(result).toBe(0.5);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("weather.com"),
        expect.any(Object)
      );
    });
  });

  describe("getWUDailySummaries", () => {
    it("returns array of daily summaries with parsed fields", async () => {
      const mockResponse = {
        summaries: [
          {
            stationID: "KABCD1234",
            obsTimeUtc: "2026-08-20T00:00:00Z",
            obsTimeLocal: "2026-08-19 18:00:00",
            imperial: { precipTotal: 0.15, tempHigh: 85.5, windspeedHigh: 12 },
          },
          {
            stationID: "KABCD1234",
            obsTimeUtc: "2026-08-21T00:00:00Z",
            obsTimeLocal: "2026-08-20 18:00:00",
            imperial: { precipTotal: 0.45, tempHigh: 88.2, windspeedHigh: 15 },
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await getWUDailySummaries("KABCD1234", "test-key-123");

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        date_local: "2026-08-19",
        precip_total_in: 0.15,
        temp_high_f: 85.5,
        wind_high_mph: 12,
      });
      expect(result[1]).toEqual({
        date_local: "2026-08-20",
        precip_total_in: 0.45,
        temp_high_f: 88.2,
        wind_high_mph: 15,
      });
    });

    it("treats null tempHigh and windspeedHigh as null", async () => {
      const mockResponse = {
        summaries: [
          {
            stationID: "KABCD1234",
            obsTimeUtc: "2026-08-21T00:00:00Z",
            obsTimeLocal: "2026-08-20 18:00:00",
            imperial: { precipTotal: 0.25, tempHigh: null, windspeedHigh: null },
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await getWUDailySummaries("KABCD1234", "test-key-123");

      expect(result[0]).toEqual({
        date_local: "2026-08-20",
        precip_total_in: 0.25,
        temp_high_f: null,
        wind_high_mph: null,
      });
    });

    it("treats null precipTotal as 0", async () => {
      const mockResponse = {
        summaries: [
          {
            stationID: "KABCD1234",
            obsTimeUtc: "2026-08-21T00:00:00Z",
            obsTimeLocal: "2026-08-20 18:00:00",
            imperial: { precipTotal: null, tempHigh: 75, windspeedHigh: 8 },
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await getWUDailySummaries("KABCD1234", "test-key-123");

      expect(result[0].precip_total_in).toBe(0);
    });

    it("returns empty array on 204", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: async () => {
          throw new SyntaxError("Unexpected end of JSON input");
        },
      });

      const result = await getWUDailySummaries("KABCD1234", "test-key-123");

      expect(result).toEqual([]);
    });

    it("throws on 401", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      });

      await expect(getWUDailySummaries("KABCD1234", "bad-key")).rejects.toThrow(
        "Invalid Weather Underground API key"
      );
    });

    it("throws on other non-ok status", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      await expect(getWUDailySummaries("KABCD1234", "test-key-123")).rejects.toThrow(
        "Weather Underground API error: 500"
      );
    });

    it("throws on timeout (AbortError)", async () => {
      (global.fetch as any).mockImplementationOnce(async (_url: string, options: any) => {
        if (options.signal) {
          const error = new TypeError("The operation was aborted");
          (error as any).name = "AbortError";
          throw error;
        }
        return { ok: true, json: async () => ({ summaries: [] }) };
      });

      await expect(getWUDailySummaries("KABCD1234", "test-key-123")).rejects.toThrow(
        "timeout"
      );
    });

    it("returns empty array when no summaries in response", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ summaries: [] }),
      });

      const result = await getWUDailySummaries("KABCD1234", "test-key-123");

      expect(result).toEqual([]);
    });

    it("returns empty array when response has no summaries key", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const result = await getWUDailySummaries("KABCD1234", "test-key-123");

      expect(result).toEqual([]);
    });

    it("uses obsTimeLocal for date extraction when available, falls back to obsTimeUtc", async () => {
      const mockResponse = {
        summaries: [
          {
            stationID: "KABCD1234",
            obsTimeUtc: "2026-08-21T06:00:00Z",
            obsTimeLocal: "2026-08-20 23:00:00",
            imperial: { precipTotal: 0.1, tempHigh: 80, windspeedHigh: 10 },
          },
          {
            stationID: "KABCD1234",
            obsTimeUtc: "2026-08-22T00:00:00Z",
            // No obsTimeLocal
            imperial: { precipTotal: 0.2, tempHigh: 85, windspeedHigh: 12 },
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await getWUDailySummaries("KABCD1234", "test-key-123");

      expect(result[0].date_local).toBe("2026-08-20");
      expect(result[1].date_local).toBe("2026-08-22");
    });
  });

  describe("getWUHourlyHistory", () => {
    it("parses hourly history with nulls passed through", async () => {
      const mockResponse = {
        observations: [
          {
            obsTimeUtc: "2026-08-22T14:00:00Z",
            obsTimeLocal: "2026-08-22 08:00:00",
            humidityAvg: 45,
            imperial: {
              tempAvg: 80,
              windspeedAvg: 8,
              windspeedHigh: 12,
              precipRate: null,
              precipTotal: 0.0,
            },
          },
          {
            obsTimeUtc: "2026-08-22T15:00:00Z",
            obsTimeLocal: "2026-08-22 09:00:00",
            humidityAvg: 44,
            imperial: {
              tempAvg: null, // Null value
              windspeedAvg: 9,
              windspeedHigh: 11,
              precipRate: 0.05,
              precipTotal: 0.05,
            },
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await getWUHourlyHistory("KABCD1234", "test-key-123", "20260822");

      expect(result).toHaveLength(2);
      expect(result[0].temp_f).toBe(80);
      expect(result[0].humidity).toBe(45);
      expect(result[1].temp_f).toBeNull(); // Null passed through
      expect(result[1].wind_mph).toBe(9);
    });

    it("handles 204 (no data) response", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        status: 204,
      });

      const result = await getWUHourlyHistory("KABCD1234", "test-key-123", "20260822");

      expect(result).toEqual([]);
    });

    it("throws on 401 (invalid key)", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      });

      await expect(getWUHourlyHistory("KABCD1234", "bad-key", "20260822")).rejects.toThrow(
        "Invalid Weather Underground API key"
      );
    });

    it("returns precip_accum_in (precipTotal)", async () => {
      const mockResponse = {
        observations: [
          {
            obsTimeUtc: "2026-08-22T14:00:00Z",
            obsTimeLocal: "2026-08-22 08:00:00",
            humidityAvg: 45,
            imperial: {
              tempAvg: 80,
              windspeedAvg: 8,
              windspeedHigh: 12,
              precipRate: null,
              precipTotal: 0.15,
            },
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await getWUHourlyHistory("KABCD1234", "test-key-123", "20260822");

      expect(result[0].precip_accum_in).toBe(0.15);
    });
  });

  describe("getWUTodayObservations", () => {
    it("parses fine-grained today observations", async () => {
      const mockResponse = {
        observations: [
          {
            obsTimeUtc: "2026-08-22T14:00:00Z",
            obsTimeLocal: "2026-08-22 08:00:00",
            humidityAvg: 50,
            imperial: {
              tempAvg: 75,
              windspeedAvg: 5,
              windspeedHigh: 8,
              precipTotal: 0.0,
            },
          },
          {
            obsTimeUtc: "2026-08-22T14:15:00Z",
            obsTimeLocal: "2026-08-22 08:15:00",
            humidityAvg: 48,
            imperial: {
              tempAvg: 76,
              windspeedAvg: 6,
              windspeedHigh: 9,
              precipTotal: 0.02,
            },
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await getWUTodayObservations("KABCD1234", "test-key-123");

      expect(result).toHaveLength(2);
      expect(result[0].temp_f).toBe(75);
      expect(result[1].precip_accum_in).toBe(0.02);
    });

    it("handles missing imperial field", async () => {
      const mockResponse = {
        observations: [
          {
            obsTimeUtc: "2026-08-22T14:00:00Z",
            obsTimeLocal: "2026-08-22 08:00:00",
            // No imperial field
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await getWUTodayObservations("KABCD1234", "test-key-123");

      expect(result).toHaveLength(1);
      expect(result[0].temp_f).toBeNull();
      expect(result[0].humidity).toBeNull();
      expect(result[0].precip_accum_in).toBe(0); // Default to 0
    });

    it("handles 204 response", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        status: 204,
      });

      const result = await getWUTodayObservations("KABCD1234", "test-key-123");

      expect(result).toEqual([]);
    });
  });

  describe("getRainfallSource", () => {
    it("returns 'wunderground' when WU is configured", async () => {
      invalidateWeatherSettingsCache();

      vi.mocked(dynamo.getWeatherSettings).mockResolvedValueOnce({
        PK: "APP",
        SK: "SETTINGS#WEATHER",
        wu_station_id: "KABCD1234",
        wu_api_key: "test-key-123",
        updated_at: new Date().toISOString(),
      });

      const { getRainfallSource } = await import("@/weather");
      const source = await getRainfallSource();
      expect(source).toBe("wunderground");
    });
  });

  describe("invalidateWeatherSettingsCache", () => {
    it("clears the cache so next call re-fetches", async () => {
      vi.resetModules();
      invalidateWeatherSettingsCache();

      vi.mocked(dynamo.getWeatherSettings).mockResolvedValueOnce({
        PK: "APP",
        SK: "SETTINGS#WEATHER",
        wu_station_id: "KABCD1234",
        wu_api_key: "test-key-123",
        updated_at: new Date().toISOString(),
      });

      const { getRainfallSource, invalidateWeatherSettingsCache: invalidateCache } = await import("@/weather");

      await getRainfallSource();
      expect(vi.mocked(dynamo.getWeatherSettings)).toHaveBeenCalledTimes(1);

      await getRainfallSource();
      expect(vi.mocked(dynamo.getWeatherSettings)).toHaveBeenCalledTimes(1);

      invalidateCache();

      vi.mocked(dynamo.getWeatherSettings).mockResolvedValueOnce(null);
      await getRainfallSource();
      expect(vi.mocked(dynamo.getWeatherSettings)).toHaveBeenCalledTimes(2);
    });
  });
});

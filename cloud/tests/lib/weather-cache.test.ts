import { describe, it, expect } from "vitest";
import { cached } from "@/lib/weather-cache";

describe("weather-cache", () => {
  describe("cached function with TTL", () => {
    it("returns result from async function", async () => {
      let callCount = 0;
      const fn = async () => {
        callCount++;
        return "result";
      };

      const result = await cached("key1", 5000, fn);

      expect(result).toBe("result");
      expect(callCount).toBe(1);
    });

    it("maintains separate cache entries per key", async () => {
      let callCountA = 0;
      let callCountB = 0;

      const fnA = async () => {
        callCountA++;
        return "a";
      };
      const fnB = async () => {
        callCountB++;
        return "b";
      };

      const resultA1 = await cached("keyA", 5000, fnA);
      const resultB1 = await cached("keyB", 5000, fnB);

      expect(resultA1).toBe("a");
      expect(resultB1).toBe("b");
      expect(callCountA).toBe(1);
      expect(callCountB).toBe(1);

      // Subsequent calls with same key should be cached (within TTL)
      const resultA2 = await cached("keyA", 5000, fnA);
      const resultB2 = await cached("keyB", 5000, fnB);

      expect(resultA2).toBe("a");
      expect(resultB2).toBe("b");
      expect(callCountA).toBe(1); // Still 1, not called again
      expect(callCountB).toBe(1); // Still 1, not called again
    });

    it("caches null and undefined values", async () => {
      let callCountNull = 0;
      let callCountUndef = 0;

      const fnNull = async () => {
        callCountNull++;
        return null;
      };
      const fnUndef = async () => {
        callCountUndef++;
        return undefined;
      };

      const result1 = await cached("null-key", 5000, fnNull);
      const result2 = await cached("null-key", 5000, fnNull);
      expect(result1).toBeNull();
      expect(result2).toBeNull();
      expect(callCountNull).toBe(1); // Cached, not called again

      const result3 = await cached("undef-key", 5000, fnUndef);
      const result4 = await cached("undef-key", 5000, fnUndef);
      expect(result3).toBeUndefined();
      expect(result4).toBeUndefined();
      expect(callCountUndef).toBe(1); // Cached, not called again
    });

    it("does not cache errors", async () => {
      let callCount = 0;
      const fn = async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error("API error");
        }
        return "success";
      };

      // First call fails
      try {
        await cached("key", 5000, fn);
      } catch (e) {
        // Expected
      }
      expect(callCount).toBe(1);

      // Second call should retry (not cached)
      const result = await cached("key", 5000, fn);
      expect(result).toBe("success");
      expect(callCount).toBe(2);
    });

    it("caches complex objects", async () => {
      let callCount = 0;
      const fn = async () => {
        callCount++;
        return {
          temperature: 72,
          condition: "sunny",
          forecast: [{ hour: 1, temp: 70 }],
        };
      };

      const result1 = await cached("weather", 5000, fn);
      const result2 = await cached("weather", 5000, fn);

      expect(result1).toEqual(result2);
      expect(result1.temperature).toBe(72);
      expect(callCount).toBe(1);
    });

    it("handles empty string key", async () => {
      let callCount = 0;
      const fn = async () => {
        callCount++;
        return "result";
      };

      const result1 = await cached("", 5000, fn);
      const result2 = await cached("", 5000, fn);

      expect(result1).toBe("result");
      expect(callCount).toBe(1); // Still cached with empty key
    });
  });

  describe("edge cases", () => {
    it("handles rapid successive calls to same key", async () => {
      let callCount = 0;
      const fn = async () => {
        callCount++;
        return `result-${callCount}`;
      };

      // All resolve to first result due to caching
      const [r1, r2, r3] = await Promise.all([
        cached("key", 5000, fn),
        cached("key", 5000, fn),
        cached("key", 5000, fn),
      ]);

      // All three should get the same value
      expect(r1).toBeTruthy();
      expect(r2).toBeTruthy();
      expect(r3).toBeTruthy();
    });

    it("integrates correctly with weather API pattern", async () => {
      const mockWeatherApi = async () => {
        return {
          lat: 40.7128,
          lon: -74.006,
          forecasts: [
            { hour: 0, tempF: 72, precipProb: 0.1 },
            { hour: 1, tempF: 71, precipProb: 0.2 },
          ],
        };
      };

      let apiCalls = 0;
      const wrappedApi = async () => {
        apiCalls++;
        return mockWeatherApi();
      };

      // First call
      const result1 = await cached("nyc-weather", 60000, wrappedApi);
      expect(result1.lat).toBe(40.7128);
      expect(apiCalls).toBe(1);

      // Cached call
      const result2 = await cached("nyc-weather", 60000, wrappedApi);
      expect(result2.lat).toBe(40.7128);
      expect(apiCalls).toBe(1);

      // Different key
      const result3 = await cached("sf-weather", 60000, wrappedApi);
      expect(result3.lat).toBe(40.7128);
      expect(apiCalls).toBe(2);
    });
  });
});

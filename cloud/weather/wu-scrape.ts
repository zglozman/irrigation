// Scrape Weather Underground's public web API key from a station dashboard
// page, so users can pull their station's data without registering for a key.
// The page embeds the key its own frontend uses; we harvest it, probe each
// candidate against the API, and cache the working one for a day.

import { cached, cacheDelete } from "@/lib/weather-cache";

const SCRAPE_CACHE_KEY = "wu-public-key";
const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function fetchWithTimeout(url: string, ms: number, headers?: Record<string, string>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch the station's dashboard page and return the working public API key.
 * Candidates are probed against observations/current — 200 and 204 both prove
 * the key is valid (204 = valid key, station currently silent).
 */
export async function scrapePublicWUKey(stationId: string): Promise<string> {
  return cached(SCRAPE_CACHE_KEY, 24 * 60 * 60 * 1000, async () => {
    const pageUrl = `https://www.wunderground.com/dashboard/pws/${encodeURIComponent(stationId)}`;
    const res = await fetchWithTimeout(pageUrl, 15000, { "User-Agent": BROWSER_UA });
    if (!res.ok) {
      throw new Error(`Could not load the station page (HTTP ${res.status})`);
    }
    const html = await res.text();

    const candidates = [
      ...new Set(
        [...html.matchAll(/apiKey[=":\\&;qu]{1,8}([0-9a-f]{32})/gi)].map((m) => m[1].toLowerCase())
      ),
    ];
    if (candidates.length === 0) {
      throw new Error("No API key found in the station page — the page layout may have changed");
    }

    for (const key of candidates) {
      try {
        const probe = await fetchWithTimeout(
          `https://api.weather.com/v2/pws/observations/current?stationId=${encodeURIComponent(
            stationId
          )}&format=json&units=e&apiKey=${encodeURIComponent(key)}`,
          10000
        );
        if (probe.status === 200 || probe.status === 204) {
          return key;
        }
      } catch {
        // try the next candidate
      }
    }

    throw new Error("Found API key candidates in the page, but none were accepted by the API");
  });
}

export function invalidateScrapedWUKey(): void {
  cacheDelete(SCRAPE_CACHE_KEY);
}

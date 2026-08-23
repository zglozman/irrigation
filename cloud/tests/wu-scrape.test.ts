import { describe, it, expect, beforeEach, vi } from "vitest";
import { scrapePublicWUKey, invalidateScrapedWUKey } from "@/weather/wu-scrape";

vi.stubGlobal("fetch", vi.fn());

const PAGE_WITH_KEYS = `
<html><script>
  var a = "https://api.weather.com/v2/pws/observations/current?apiKey=5c241d89f91274015a577e3e17d43370&units=e";
  var b = {"apiKey":"e1f10a1e78da46f5b10a1e78da96f525"};
</script></html>`;

describe("scrapePublicWUKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateScrapedWUKey();
  });

  it("extracts candidates and returns the first key the API accepts", async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => PAGE_WITH_KEYS })
      // probe candidate 1 → rejected
      .mockResolvedValueOnce({ ok: false, status: 401 })
      // probe candidate 2 → accepted
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const key = await scrapePublicWUKey("KFLGAINE21");
    expect(key).toBe("e1f10a1e78da46f5b10a1e78da96f525");
    expect((global.fetch as any).mock.calls[0][0]).toContain("/dashboard/pws/KFLGAINE21");
  });

  it("accepts a 204 probe (valid key, silent station)", async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => PAGE_WITH_KEYS })
      .mockResolvedValueOnce({ ok: true, status: 204 });

    const key = await scrapePublicWUKey("KFLGAINE21");
    expect(key).toBe("5c241d89f91274015a577e3e17d43370");
  });

  it("caches the working key across calls", async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => PAGE_WITH_KEYS })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    await scrapePublicWUKey("KFLGAINE21");
    await scrapePublicWUKey("KFLGAINE21");
    expect((global.fetch as any).mock.calls.length).toBe(2); // page + one probe, no re-scrape
  });

  it("re-scrapes after invalidation", async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => PAGE_WITH_KEYS })
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => PAGE_WITH_KEYS })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    await scrapePublicWUKey("KFLGAINE21");
    invalidateScrapedWUKey();
    await scrapePublicWUKey("KFLGAINE21");
    expect((global.fetch as any).mock.calls.length).toBe(4);
  });

  it("throws a clear error when the page has no keys", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "<html>nothing here</html>",
    });
    await expect(scrapePublicWUKey("KFLGAINE21")).rejects.toThrow("No API key found");
  });

  it("throws when no candidate is accepted by the API", async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => PAGE_WITH_KEYS })
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(scrapePublicWUKey("KFLGAINE21")).rejects.toThrow("none were accepted");
  });

  it("throws when the page itself fails to load", async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(scrapePublicWUKey("KFLGAINE21")).rejects.toThrow("HTTP 503");
  });
});

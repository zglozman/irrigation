import { describe, it, expect } from "vitest";
import { requestOrigin, buildAuthorizeUrl } from "@/lib/oauth";

describe("requestOrigin", () => {
  it("uses http for localhost", () => {
    expect(requestOrigin("localhost:3001")).toBe("http://localhost:3001");
  });

  it("uses http for 127.0.0.1", () => {
    expect(requestOrigin("127.0.0.1:3001")).toBe("http://127.0.0.1:3001");
  });

  it("uses https for real hosts", () => {
    expect(requestOrigin("app.sprout-me.com")).toBe("https://app.sprout-me.com");
  });
});

describe("buildAuthorizeUrl", () => {
  it("targets the Cognito hosted authorize endpoint with Google as IdP", () => {
    const url = new URL(buildAuthorizeUrl("https://app.sprout-me.com"));
    expect(url.pathname).toBe("/oauth2/authorize");
    expect(url.searchParams.get("identity_provider")).toBe("Google");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.sprout-me.com/api/auth/callback"
    );
  });

  // Regression: the linked-retry marker must ride `state` — Cognito echoes
  // state back but drops unknown query params on the redirect_uri, and the
  // redirect_uri itself must exactly match a registered callback URL.
  it("carries the retry marker in state, never in redirect_uri", () => {
    const url = new URL(buildAuthorizeUrl("http://localhost:3001", "linked-retry"));
    expect(url.searchParams.get("state")).toBe("linked-retry");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3001/api/auth/callback"
    );
  });

  it("omits state when not retrying", () => {
    const url = new URL(buildAuthorizeUrl("https://app.sprout-me.com"));
    expect(url.searchParams.has("state")).toBe(false);
  });
});

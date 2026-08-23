// Helpers for the Cognito hosted OAuth flow (Google sign-in).

import { config } from "@/lib/config";

export function requestOrigin(host: string): string {
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  return `${proto}://${host}`;
}

// The redirect_uri must exactly match one registered on the app client, so
// any per-request info (like the linked-retry marker) rides `state` instead.
export function buildAuthorizeUrl(origin: string, state?: string): string {
  const url = new URL(`https://${config.cognito.domain}/oauth2/authorize`);
  url.searchParams.set("client_id", config.cognito.clientId || "");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("redirect_uri", `${origin}/api/auth/callback`);
  url.searchParams.set("identity_provider", "Google");
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

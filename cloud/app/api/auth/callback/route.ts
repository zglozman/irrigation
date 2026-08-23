// GET /api/auth/callback — completes the Cognito hosted OAuth flow (Google
// sign-in). Exchanges the authorization code for tokens and sets the same
// session cookies password login uses.
//
// Two special error paths surfaced by the PreSignUp trigger:
//  - SPROUT_LINKED_RETRY: first-ever Google sign-in for an invited user — the
//    trigger just LINKED the Google identity to their account and aborted the
//    duplicate signup. Retry the authorize flow once (marked via `state`);
//    the second pass signs in as the linked user.
//  - SPROUT_NOT_INVITED: the Google account's email has no invitation.

import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { setAuthCookies } from "@/lib/auth";
import { requestOrigin, buildAuthorizeUrl } from "@/lib/oauth";

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const origin = requestOrigin(request.headers.get("host") || "app.sprout-me.com");

  const errorDescription = url.searchParams.get("error_description") || "";
  const code = url.searchParams.get("code");
  const alreadyRetried = url.searchParams.get("state") === "linked-retry";

  if (errorDescription.includes("SPROUT_LINKED_RETRY") && !alreadyRetried) {
    return NextResponse.redirect(buildAuthorizeUrl(origin, "linked-retry"), { status: 302 });
  }

  if (errorDescription.includes("SPROUT_NOT_INVITED")) {
    return NextResponse.redirect(`${origin}/login?error=not-invited`, { status: 302 });
  }

  if (url.searchParams.get("error") || !code) {
    console.error(
      "[OAuth callback] error:",
      url.searchParams.get("error") || "missing code",
      errorDescription
    );
    return NextResponse.redirect(`${origin}/login?error=google-failed`, { status: 302 });
  }

  try {
    const basic = Buffer.from(`${config.cognito.clientId}:${config.cognito.clientSecret}`).toString("base64");
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.cognito.clientId || "",
      code,
      redirect_uri: `${origin}/api/auth/callback`,
    });

    const tokenRes = await fetch(`https://${config.cognito.domain}/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      body: body.toString(),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      console.error("[OAuth callback] token exchange failed:", tokenRes.status, text.slice(0, 200));
      return NextResponse.redirect(`${origin}/login?error=google-failed`, { status: 302 });
    }

    const tokens = (await tokenRes.json()) as { id_token?: string; refresh_token?: string };

    if (!tokens.id_token || !tokens.refresh_token) {
      console.error("[OAuth callback] token response missing id_token/refresh_token");
      return NextResponse.redirect(`${origin}/login?error=google-failed`, { status: 302 });
    }

    await setAuthCookies(tokens.id_token, tokens.refresh_token);
    return NextResponse.redirect(`${origin}/`, { status: 302 });
  } catch (err) {
    console.error("[OAuth callback] error:", err);
    return NextResponse.redirect(`${origin}/login?error=google-failed`, { status: 302 });
  }
}

// GET /api/auth/google — kick off Google sign-in via the Cognito hosted
// OAuth flow. Redirects to Cognito's authorize endpoint with Google as the
// identity provider; Cognito redirects back to /api/auth/callback.

import { NextRequest, NextResponse } from "next/server";
import { requestOrigin, buildAuthorizeUrl } from "@/lib/oauth";

export async function GET(request: NextRequest) {
  const origin = requestOrigin(request.headers.get("host") || "app.sprout-me.com");
  return NextResponse.redirect(buildAuthorizeUrl(origin), { status: 302 });
}

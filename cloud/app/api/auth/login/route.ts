// POST /api/auth/login
// Email + password login against Cognito

import { NextRequest, NextResponse } from "next/server";
import { initiateLogin, setAuthCookies } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    const result = await initiateLogin(email, password);

    // If NEW_PASSWORD_REQUIRED, return challenge info
    if (result.challenge === "NEW_PASSWORD_REQUIRED") {
      return NextResponse.json({
        challenge: "NEW_PASSWORD_REQUIRED",
        session: result.session,
        challengeUsername: result.challengeUsername,
        userAttributes: result.userAttributes,
      });
    }

    // Successful login: set cookies and redirect
    if (result.idToken && result.refreshToken) {
      await setAuthCookies(result.idToken, result.refreshToken);

      return NextResponse.json(
        { success: true, message: "Logged in successfully" },
        { status: 200 }
      );
    }

    return NextResponse.json(
      { error: "Login failed: no tokens returned" },
      { status: 500 }
    );
  } catch (error) {
    console.error("[Auth] Login error:", error);
    const message = error instanceof Error ? error.message : "Login failed";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

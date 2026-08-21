// POST /api/auth/challenge
// Respond to NEW_PASSWORD_REQUIRED challenge

import { NextRequest, NextResponse } from "next/server";
import { respondToNewPasswordChallenge, setAuthCookies } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { challengeUsername, newPassword, session } = body;

    if (!challengeUsername || !newPassword || !session) {
      return NextResponse.json(
        { error: "Challenge username, new password, and session are required" },
        { status: 400 }
      );
    }

    const tokens = await respondToNewPasswordChallenge(challengeUsername, newPassword, session);

    // Set cookies
    await setAuthCookies(tokens.idToken, tokens.refreshToken);

    return NextResponse.json(
      { success: true, message: "Password updated and logged in" },
      { status: 200 }
    );
  } catch (error) {
    console.error("[Auth] Challenge error:", error);
    const message = error instanceof Error ? error.message : "Challenge failed";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

// Cognito authentication
// Server-side auth utilities for Next.js API routes and pages

import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  AdminCreateUserCommand,
  RespondToAuthChallengeCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { cookies } from "next/headers";
import crypto from "crypto";
import { config } from "./config";

let cognotoClient: CognitoIdentityProviderClient | null = null;
let jwtVerifier: any = null;

function getCognitoClient(): CognitoIdentityProviderClient {
  if (!cognotoClient) {
    cognotoClient = new CognitoIdentityProviderClient({ region: config.aws.region });
  }
  return cognotoClient;
}

function getJwtVerifier() {
  if (!jwtVerifier) {
    if (!config.cognito.userPoolId) {
      throw new Error("COGNITO_USER_POOL_ID is required");
    }
    jwtVerifier = CognitoJwtVerifier.create({
      userPoolId: config.cognito.userPoolId,
      clientId: config.cognito.clientId || "",
      tokenUse: "id",
    } as any);
  }
  return jwtVerifier;
}

/**
 * Calculate SECRET_HASH for Cognito USER_PASSWORD_AUTH
 * HMAC-SHA256 of (username + clientId) keyed by client secret
 */
function calculateSecretHash(username: string, clientId: string, clientSecret: string): string {
  return crypto
    .createHmac("sha256", clientSecret)
    .update(username + clientId)
    .digest("base64");
}

export interface AuthUser {
  sub: string;
  email: string;
}

/**
 * Initiate login with email and password
 * Returns tokens or a NEW_PASSWORD_REQUIRED challenge
 */
export async function initiateLogin(
  email: string,
  password: string
): Promise<{
  idToken?: string;
  accessToken?: string;
  refreshToken?: string;
  challenge?: "NEW_PASSWORD_REQUIRED";
  session?: string;
  challengeUsername?: string;
  userAttributes?: Record<string, string>;
}> {
  const client = getCognitoClient();
  const secretHash = calculateSecretHash(
    email,
    config.cognito.clientId || "",
    config.cognito.clientSecret || ""
  );

  const result = await client.send(
    new InitiateAuthCommand({
      ClientId: config.cognito.clientId,
      AuthFlow: "USER_PASSWORD_AUTH",
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
        SECRET_HASH: secretHash,
      },
    })
  );

  if (result.ChallengeName === "NEW_PASSWORD_REQUIRED") {
    // Capture USER_ID_FOR_SRP from ChallengeParameters, fall back to USERNAME
    const challengeUsername =
      result.ChallengeParameters?.USER_ID_FOR_SRP || email;

    return {
      challenge: "NEW_PASSWORD_REQUIRED",
      session: result.Session,
      challengeUsername,
      userAttributes: result.ChallengeParameters,
    };
  }

  return {
    idToken: result.AuthenticationResult?.IdToken,
    accessToken: result.AuthenticationResult?.AccessToken,
    refreshToken: result.AuthenticationResult?.RefreshToken,
  };
}

/**
 * Respond to NEW_PASSWORD_REQUIRED challenge
 * Uses challengeUsername for both USERNAME and SECRET_HASH calculation
 */
export async function respondToNewPasswordChallenge(
  challengeUsername: string,
  newPassword: string,
  session: string
): Promise<{
  idToken: string;
  accessToken: string;
  refreshToken: string;
}> {
  const client = getCognitoClient();
  const secretHash = calculateSecretHash(
    challengeUsername,
    config.cognito.clientId || "",
    config.cognito.clientSecret || ""
  );

  const result = await client.send(
    new RespondToAuthChallengeCommand({
      ClientId: config.cognito.clientId,
      ChallengeName: "NEW_PASSWORD_REQUIRED",
      Session: session,
      ChallengeResponses: {
        USERNAME: challengeUsername,
        NEW_PASSWORD: newPassword,
        SECRET_HASH: secretHash,
      },
    })
  );

  const tokens = result.AuthenticationResult;
  if (!tokens?.IdToken || !tokens?.AccessToken || !tokens?.RefreshToken) {
    throw new Error("Failed to get tokens from challenge response");
  }

  return {
    idToken: tokens.IdToken,
    accessToken: tokens.AccessToken,
    refreshToken: tokens.RefreshToken,
  };
}

/**
 * Verify JWT ID token and extract user info
 */
export async function verifyIdToken(token: string): Promise<AuthUser> {
  const verifier = getJwtVerifier();
  const claims = await verifier.verify(token);

  return {
    sub: claims.sub as string,
    email: claims.email as string,
  };
}

/**
 * Set auth cookies (httpOnly, Secure, SameSite)
 */
export async function setAuthCookies(idToken: string, refreshToken: string): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set("idToken", idToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 3600, // 1 hour
    path: "/",
  });

  cookieStore.set("refreshToken", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 3600, // 7 days
    path: "/",
  });
}

/**
 * Get user from ID token cookie
 */
export async function requireUser(): Promise<AuthUser> {
  const cookieStore = await cookies();
  const idToken = cookieStore.get("idToken")?.value;

  if (!idToken) {
    throw new Error("No ID token found");
  }

  try {
    return await verifyIdToken(idToken);
  } catch (error) {
    throw new Error("Invalid or expired token");
  }
}

/**
 * Clear auth cookies
 */
export async function clearAuthCookies(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete("idToken");
  cookieStore.delete("refreshToken");
}

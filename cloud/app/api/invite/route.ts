// POST /api/invite
// Invite a new user to the system

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { config } from "@/lib/config";

export async function POST(request: NextRequest) {
  try {
    // Require auth - anyone authenticated can invite
    await requireUser();

    const body = await request.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    // Create Cognito user
    const cognitoClient = new CognitoIdentityProviderClient({
      region: config.aws.region,
    });

    const result = await cognitoClient.send(
      new AdminCreateUserCommand({
        UserPoolId: config.cognito.userPoolId,
        Username: email,
        DesiredDeliveryMediums: ["EMAIL"], // Let Cognito generate and email the temporary password
      })
    );

    // In a production system, you would send the invite email here
    // For now, we'll just return the user was created
    // The user can request a password reset via forgot-password flow

    return NextResponse.json(
      {
        success: true,
        message: `User invited: ${email}. They will receive an invite email shortly.`,
        userId: result.User?.Username,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[Invite] Error:", error);

    // Check if user already exists
    if (error instanceof Error && error.message.includes("already exists")) {
      return NextResponse.json(
        { error: "User with this email already exists" },
        { status: 409 }
      );
    }

    const message = error instanceof Error ? error.message : "Failed to invite user";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

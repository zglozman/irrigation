// Cognito PreSignUp trigger: invite-only enforcement for federated sign-ins.
//
// When someone signs in with Google, Cognito would normally auto-create a new
// user. This trigger intercepts that:
//   - If a NATIVE (invited) user with the same verified email exists, the
//     Google identity is LINKED to that user — same sub, same data — and the
//     signup is aborted with a marker error the app recognizes and retries;
//     the retried sign-in then resolves to the linked native user.
//   - If no invited user matches, the signup is rejected outright.
//
// Native sign-ups (AdminCreateUser invites) pass through untouched.

import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminLinkProviderForUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const client = new CognitoIdentityProviderClient({});

export async function handler(event) {
  const { triggerSource, userPoolId, userName, request } = event;

  // Only external-provider signups are gated; invited native users pass.
  if (triggerSource !== "PreSignUp_ExternalProvider") {
    return event;
  }

  const email = (request.userAttributes?.email || "").toLowerCase().trim();
  if (!email) {
    throw new Error("SPROUT_NOT_INVITED: no email from identity provider");
  }

  // Find an existing NATIVE user with this email.
  const list = await client.send(
    new ListUsersCommand({
      UserPoolId: userPoolId,
      Filter: `email = "${email.replace(/"/g, "")}"`,
      Limit: 10,
    })
  );

  const nativeUser = (list.Users || []).find(
    (u) => !(u.Username || "").startsWith("google_") && !(u.Username || "").includes("Google_")
  );

  if (!nativeUser) {
    // Not invited — block the sign-in entirely.
    throw new Error("SPROUT_NOT_INVITED: this system is invite-only");
  }

  // userName for an external-provider signup looks like "google_1234567890".
  const [providerName, ...idParts] = userName.split("_");
  const providerUserId = idParts.join("_");
  if (providerName.toLowerCase() !== "google" || !providerUserId) {
    throw new Error("SPROUT_NOT_INVITED: unsupported identity provider");
  }

  await client.send(
    new AdminLinkProviderForUserCommand({
      UserPoolId: userPoolId,
      DestinationUser: {
        ProviderName: "Cognito",
        ProviderAttributeValue: nativeUser.Username,
      },
      SourceUser: {
        ProviderName: "Google",
        ProviderAttributeName: "Cognito_Subject",
        ProviderAttributeValue: providerUserId,
      },
    })
  );

  // Linking succeeded — abort THIS signup (which would create a duplicate
  // external user). The app sees this marker and silently retries the
  // sign-in, which now resolves to the linked native user.
  throw new Error("SPROUT_LINKED_RETRY: account linked, retry sign-in");
}

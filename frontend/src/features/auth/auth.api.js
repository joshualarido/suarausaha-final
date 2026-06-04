import { apiRequest } from "@/lib/api-client";

export async function getCurrentUser() {
  return apiRequest("/api/v1/me");
}

export async function updateCurrentUserProfile(name) {
  return apiRequest("/api/v1/me", {
    method: "PATCH",
    body: { name },
  });
}

export async function startGoogleSignIn(callbackPath = "/onboarding/business") {
  const callbackURL = `${window.location.origin}${callbackPath}`;
  const payload = await apiRequest("/api/auth/sign-in/social?provider=google", {
    method: "POST",
    body: {
      provider: "google",
      callbackURL,
    },
    notifyOnSuccess: false,
  });

  const redirectUrl =
    (payload && typeof payload === "object" && "url" in payload && typeof payload.url === "string" && payload.url) ||
    null;

  if (!redirectUrl) {
    throw new Error("No redirect URL returned by auth endpoint.");
  }

  window.location.href = redirectUrl;
}

export async function signOutUser() {
  await apiRequest("/api/auth/sign-out", {
    method: "POST",
    body: {},
    notifyOnSuccess: false,
  });
}

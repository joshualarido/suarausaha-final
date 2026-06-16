import { apiRequest, getApiBaseUrl } from "@/lib/api-client";

function trimTrailingSlash(value) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function resolveFrontendOrigin() {
  const configuredOrigin = import.meta.env.VITE_FRONTEND_ORIGIN;
  if (configuredOrigin?.trim()) {
    return trimTrailingSlash(configuredOrigin.trim());
  }

  const currentOrigin = window.location.origin;
  return currentOrigin === getApiBaseUrl() ? "" : currentOrigin;
}

function resolveCallbackURL(callbackPath) {
  const frontendOrigin = resolveFrontendOrigin();
  if (!frontendOrigin) {
    throw new Error("Alamat web aplikasi belum dikonfigurasi.");
  }

  const next = `${frontendOrigin}${callbackPath}`;
  return `${getApiBaseUrl()}/api/auth/session-handoff/start?next=${encodeURIComponent(next)}`;
}

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
  const callbackURL = resolveCallbackURL(callbackPath);
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

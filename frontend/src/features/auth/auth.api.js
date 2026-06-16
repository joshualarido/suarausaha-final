import { apiRequest, getApiBaseUrl } from "@/lib/api-client";
import { resolveGoogleAuthUrls } from "./auth-url";

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
  return resolveGoogleAuthUrls({
    apiBaseUrl: getApiBaseUrl(),
    authApiBaseUrl: import.meta.env.VITE_AUTH_API_BASE_URL,
    frontendOrigin,
    callbackPath,
  }).callbackURL;
}

function resolveGoogleSignInPath(callbackPath) {
  const frontendOrigin = resolveFrontendOrigin();
  return resolveGoogleAuthUrls({
    apiBaseUrl: getApiBaseUrl(),
    authApiBaseUrl: import.meta.env.VITE_AUTH_API_BASE_URL,
    frontendOrigin,
    callbackPath,
  }).signInPath;
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
  const payload = await apiRequest(resolveGoogleSignInPath(callbackPath), {
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

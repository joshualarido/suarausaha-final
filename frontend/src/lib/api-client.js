const DEFAULT_API_BASE_URL = "http://localhost:3000";

function trimTrailingSlash(value) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

const API_BASE_URL = trimTrailingSlash(import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL);

function toUrl(path) {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  return `${API_BASE_URL}${path}`;
}

export class ApiClientError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.payload = payload;
  }
}

export async function apiRequest(path, options = {}) {
  const { method = "GET", body, headers = {}, ...rest } = options;
  const requestHeaders = new Headers(headers);
  const requestInit = {
    method,
    credentials: "include",
    headers: requestHeaders,
    ...rest,
  };

  if (body !== undefined) {
    const isStringBody = typeof body === "string";
    requestInit.body = isStringBody ? body : JSON.stringify(body);

    if (!isStringBody && !requestHeaders.has("Content-Type")) {
      requestHeaders.set("Content-Type", "application/json");
    }
  }

  const response = await fetch(toUrl(path), requestInit);
  const contentType = response.headers.get("content-type") ?? "";

  let payload = null;
  if (contentType.includes("application/json")) {
    payload = await response.json();
  } else {
    const textPayload = await response.text();
    payload = textPayload || null;
  }

  if (!response.ok) {
    const message =
      (payload &&
        typeof payload === "object" &&
        payload.error &&
        typeof payload.error === "object" &&
        payload.error.message) ||
      `Request failed with status ${response.status}`;

    throw new ApiClientError(message, response.status, payload);
  }

  return payload;
}

export function getApiBaseUrl() {
  return API_BASE_URL;
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

export async function getBusinessProfile() {
  return apiRequest("/api/v1/business");
}

export async function createBusinessProfile(name) {
  return apiRequest("/api/v1/business", {
    method: "POST",
    body: { name },
  });
}

export async function updateBusinessProfile(name) {
  return apiRequest("/api/v1/business", {
    method: "PATCH",
    body: { name },
  });
}

export async function previewOpeningBalance(openingBalance) {
  return apiRequest("/api/v1/opening-balance/preview", {
    method: "POST",
    body: openingBalance,
  });
}

export async function confirmOpeningBalance(openingBalance) {
  return apiRequest("/api/v1/opening-balance/confirm", {
    method: "POST",
    body: openingBalance,
  });
}

export async function getPaymentAccounts() {
  return apiRequest("/api/v1/payment-accounts");
}

export async function parseChatMessage(message) {
  return apiRequest("/api/v1/chat/parse", {
    method: "POST",
    body: { message },
  });
}

export async function getChatThread() {
  return apiRequest("/api/v1/chat/thread");
}

export async function clarifyChatMessage(clarificationId, answer) {
  return apiRequest("/api/v1/chat/clarify", {
    method: "POST",
    body: { clarificationId, answer },
  });
}

export async function confirmConfirmation(confirmationRequestId) {
  return apiRequest(`/api/v1/confirmations/${confirmationRequestId}/confirm`, {
    method: "POST",
    body: {},
  });
}

export async function cancelConfirmation(confirmationRequestId) {
  return apiRequest(`/api/v1/confirmations/${confirmationRequestId}/cancel`, {
    method: "POST",
    body: {},
  });
}

export async function editConfirmation(confirmationRequestId, patch) {
  return apiRequest(`/api/v1/confirmations/${confirmationRequestId}`, {
    method: "PATCH",
    body: patch,
  });
}

export async function updatePaymentAccountName(paymentAccountId, name) {
  return apiRequest(`/api/v1/payment-accounts/${paymentAccountId}`, {
    method: "PATCH",
    body: { name },
  });
}

export async function createPaymentAccount(name) {
  return apiRequest("/api/v1/payment-accounts", {
    method: "POST",
    body: { name },
  });
}

export async function removePaymentAccount(paymentAccountId) {
  return apiRequest(`/api/v1/payment-accounts/${paymentAccountId}`, {
    method: "DELETE",
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
  });
}

export async function debugResetOnboarding() {
  return apiRequest("/api/v1/debug/reset-onboarding", {
    method: "POST",
    body: {},
  });
}

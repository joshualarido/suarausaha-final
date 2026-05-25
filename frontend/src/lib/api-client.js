const DEFAULT_API_BASE_URL = "http://localhost:3000";
export const APP_NOTIFICATION_EVENT = "suarausaha:notification";

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

function emitAppNotification(notification) {
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent(APP_NOTIFICATION_EVENT, {
      detail: notification,
    }),
  );
}

function extractSuccessMessageFromPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const data = "data" in payload ? payload.data : null;
  if (data && typeof data === "object" && typeof data.message === "string" && data.message.trim()) {
    return data.message.trim();
  }

  const topLevelMessage =
    "message" in payload && typeof payload.message === "string" ? payload.message.trim() : "";
  return topLevelMessage;
}

function defaultSuccessMessage(method) {
  if (method === "POST") return "Proses berhasil disimpan.";
  if (method === "PATCH") return "Perubahan berhasil disimpan.";
  if (method === "DELETE") return "Data berhasil dihapus.";
  return "Proses berhasil.";
}

export async function apiRequest(path, options = {}) {
  const { method = "GET", body, headers = {}, notifyOnSuccess, successMessage, ...rest } = options;
  const methodUpper = method.toUpperCase();
  const requestHeaders = new Headers(headers);
  const requestInit = {
    method: methodUpper,
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

  const shouldNotifySuccess = typeof notifyOnSuccess === "function"
    ? Boolean(notifyOnSuccess(payload))
    : typeof notifyOnSuccess === "boolean"
      ? notifyOnSuccess
      : false;

  if (shouldNotifySuccess) {
    const resolvedSuccessMessage = typeof successMessage === "function" ? successMessage(payload) : successMessage;
    const message = resolvedSuccessMessage || extractSuccessMessageFromPayload(payload) || defaultSuccessMessage(methodUpper);
    emitAppNotification({
      title: "Proses selesai",
      description: message,
      durationMs: 7000,
    });
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
    notifyOnSuccess: false,
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

export async function getMenuItems() {
  return apiRequest("/api/v1/menu-items");
}

export async function parseChatMessage(message) {
  return apiRequest("/api/v1/chat/parse", {
    method: "POST",
    body: { message },
    notifyOnSuccess: (payload) => payload?.data?.status === "saved_fast",
    successMessage: (payload) => payload?.data?.message || "Transaksi langsung disimpan.",
  });
}

export async function undoLatestTransactionViaChat() {
  return parseChatMessage("undo transaksi terakhir");
}

export async function getChatThread() {
  return apiRequest("/api/v1/chat/thread");
}

export async function clearChatThread() {
  return apiRequest("/api/v1/chat/thread", {
    method: "DELETE",
  });
}

export async function clarifyChatMessage(clarificationId, answer) {
  return apiRequest("/api/v1/chat/clarify", {
    method: "POST",
    body: { clarificationId, answer },
    notifyOnSuccess: (payload) => payload?.data?.status === "saved_fast",
    successMessage: (payload) => payload?.data?.message || "Transaksi langsung disimpan.",
  });
}

export async function confirmConfirmation(confirmationRequestId) {
  return apiRequest(`/api/v1/confirmations/${confirmationRequestId}/confirm`, {
    method: "POST",
    body: {},
    notifyOnSuccess: true,
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
    notifyOnSuccess: false,
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

export async function setDefaultPaymentAccount(paymentAccountId) {
  return apiRequest(`/api/v1/payment-accounts/${paymentAccountId}/default`, {
    method: "PATCH",
    body: {},
  });
}

export async function createMenuItem(menuItem) {
  return apiRequest("/api/v1/menu-items", {
    method: "POST",
    body: menuItem,
  });
}

export async function updateMenuItem(menuItemId, menuItem) {
  return apiRequest(`/api/v1/menu-items/${menuItemId}`, {
    method: "PATCH",
    body: menuItem,
  });
}

export async function removeMenuItem(menuItemId) {
  return apiRequest(`/api/v1/menu-items/${menuItemId}`, {
    method: "DELETE",
  });
}

function buildQueryString(query = {}) {
  const params = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    params.set(key, String(value));
  });

  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

export async function getTransactions(query = {}) {
  return apiRequest(`/api/v1/transactions${buildQueryString(query)}`);
}

export async function getInventorySummary() {
  return apiRequest("/api/v1/inventory-summary");
}

export async function getAssetSummary() {
  return apiRequest("/api/v1/asset-summary");
}

export async function getLiabilitiesSummary() {
  return apiRequest("/api/v1/liabilities");
}

export async function getReceivablesSummary() {
  return apiRequest("/api/v1/receivables");
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

export async function debugResetOnboarding() {
  return apiRequest("/api/v1/debug/reset-onboarding", {
    method: "POST",
    body: {},
    notifyOnSuccess: false,
  });
}

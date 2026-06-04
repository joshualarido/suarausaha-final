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

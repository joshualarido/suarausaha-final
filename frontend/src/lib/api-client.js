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

function formatIdr(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  return `Rp${amount.toLocaleString("id-ID")}`;
}

function compactParts(parts) {
  return parts.filter((part) => typeof part === "string" && part.trim()).map((part) => part.trim());
}

function actionLabelForIntent(intent) {
  const labels = {
    sales_income: "Penjualan",
    general_expense: "Biaya usaha",
    inventory_purchase_value: "Pembelian stok",
    asset_record_or_purchase: "Aset usaha",
    liability_created: "Utang baru",
    liability_payment: "Pembayaran utang",
    receivable_created: "Piutang baru",
    receivable_payment: "Pembayaran piutang",
    owner_capital_contribution: "Modal pemilik",
    owner_withdrawal: "Ambil uang usaha",
    account_transfer: "Transfer antar akun",
    reversal: "Pembalikan transaksi",
  };

  return labels[intent] ?? "";
}

function notificationFromProposedAction(proposedAction) {
  if (!proposedAction || typeof proposedAction !== "object") return null;

  return {
    kind: "transaction",
    title: "Transaksi disimpan",
    actionLabel: actionLabelForIntent(proposedAction.intent),
    amount: proposedAction.amount,
    date: proposedAction.date,
    paymentAccountName: proposedAction.paymentAccountName,
    destinationPaymentAccountName: proposedAction.destinationPaymentAccountName,
    affectedObject: proposedAction.affectedObject,
    description: proposedAction.description,
  };
}

function notificationFromNeracaData(data) {
  if (!data || typeof data !== "object" || !data.reportDate) return null;

  const equation = data.equation && typeof data.equation === "object" ? data.equation : null;
  const totalAktiva = data.totalAktiva ?? equation?.totalAktiva;
  const totalPasiva = data.totalPasiva ?? equation?.totalPasiva;
  const reconciliationStatus = data.reconciliationStatus ?? equation?.reconciliationStatus;
  if (totalAktiva === undefined || totalPasiva === undefined) return null;

  return {
    kind: "neraca_report",
    title: "Laporan disimpan",
    reportDate: data.reportDate,
    totalAktiva,
    totalPasiva,
    reconciliationStatus,
  };
}

function extractProcessNotification(payload) {
  const data = payload && typeof payload === "object" && "data" in payload ? payload.data : null;
  if (!data || typeof data !== "object") return null;

  if (data.notification && typeof data.notification === "object") {
    return data.notification;
  }

  return notificationFromProposedAction(data.proposedAction) ?? notificationFromNeracaData(data);
}

function formatProcessNotification(notification, fallbackMessage) {
  if (!notification || typeof notification !== "object") return null;

  if (notification.kind === "transaction") {
    const amount = formatIdr(notification.amount);
    const parts = compactParts([
      notification.actionLabel,
      amount,
      notification.destinationPaymentAccountName
        ? `${notification.paymentAccountName ?? "Akun asal"} ke ${notification.destinationPaymentAccountName}`
        : notification.paymentAccountName,
      notification.affectedObject,
      notification.date,
    ]);

    return {
      title: typeof notification.title === "string" && notification.title.trim()
        ? notification.title.trim()
        : "Transaksi disimpan",
      description: parts.length > 0 ? parts.join(" - ") : fallbackMessage,
    };
  }

  if (notification.kind === "neraca_report") {
    const parts = compactParts([
      notification.reportDate ? `Per ${notification.reportDate}` : "",
      formatIdr(notification.totalAktiva) ? `Aktiva ${formatIdr(notification.totalAktiva)}` : "",
      formatIdr(notification.totalPasiva) ? `Pasiva ${formatIdr(notification.totalPasiva)}` : "",
      notification.reconciliationStatus,
    ]);

    return {
      title: typeof notification.title === "string" && notification.title.trim()
        ? notification.title.trim()
        : "Laporan disimpan",
      description: parts.length > 0 ? parts.join(" - ") : fallbackMessage,
    };
  }

  return null;
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
    const processNotification = formatProcessNotification(extractProcessNotification(payload), message);
    emitAppNotification({
      title: processNotification?.title ?? "Proses selesai",
      description: processNotification?.description ?? message,
      durationMs: 7000,
    });
  }

  return payload;
}

export function getApiBaseUrl() {
  return API_BASE_URL;
}

import type { ParseIntentInput, ParseIntentResult, ProposedAction } from "./parser.types.js";

const PARSER_MODEL = "deterministic-ambiguity";
const PARSER_VERSION = "ambiguity-gate-v1";
const INVENTORY_OR_EXPENSE_OPTIONS = [
  { label: "Stok / Persediaan", value: "inventory_purchase_value" },
  { label: "Biaya langsung", value: "general_expense" },
];
const INVENTORY_OR_EXPENSE_QUESTION = "Ini mau dicatat sebagai stok/persediaan atau sebagai biaya langsung?";

function normalizeInput(message: string): string {
  return message.trim().toLowerCase().replace(/\s+/g, " ");
}

function formatIdr(amount: number): string {
  return `Rp${amount.toLocaleString("id-ID")}`;
}

function parseAmount(message: string): number | null {
  const normalized = normalizeInput(message).replace(/rp\s*/g, "");
  const match = normalized.match(/(\d+(?:[.,]\d+)?)\s*(ribu|rb|juta|jt)?/);

  if (!match) return null;

  const numberValue = Number(match[1].replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(numberValue) || numberValue <= 0) return null;

  const unit = match[2] ?? "";
  if (unit === "juta" || unit === "jt") return Math.round(numberValue * 1_000_000);
  if (unit === "ribu" || unit === "rb") return Math.round(numberValue * 1_000);
  return Math.round(numberValue);
}

function parseIndonesianDate(message: string): string | null {
  const normalized = normalizeInput(message);
  const months: Record<string, string> = {
    januari: "01",
    februari: "02",
    maret: "03",
    april: "04",
    mei: "05",
    juni: "06",
    juli: "07",
    agustus: "08",
    september: "09",
    oktober: "10",
    november: "11",
    desember: "12",
  };
  const match = normalized.match(/\b(?:tanggal\s*)?(\d{1,2})\s+(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s+(\d{4})\b/);
  if (!match) return null;

  const day = Number(match[1]);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  return `${match[3]}-${months[match[2]]}-${String(day).padStart(2, "0")}`;
}

function baseDescription(message: string): string {
  const trimmed = message.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function parsePaymentHint(message: string): "cash" | "non_cash" | null {
  const normalized = normalizeInput(message);
  if (/\b(tunai|kas|cash)\b/.test(normalized)) return "cash";
  if (/\b(transfer|qris|debit|bank|ewallet|e-wallet)\b/.test(normalized)) return "non_cash";
  return null;
}

function resolvePaymentAccount(input: ParseIntentInput) {
  const paymentHint = parsePaymentHint(input.message);
  if (paymentHint) {
    const matchedByHint = input.paymentAccounts.filter((account) => account.type === paymentHint);
    if (matchedByHint.length === 1) return matchedByHint[0];
  }

  return (
    input.paymentAccounts.find((account) => account.id === input.defaultPaymentAccountId) ??
    input.paymentAccounts.find((account) => account.isDefault) ??
    input.paymentAccounts[0] ??
    null
  );
}

export function isAmbiguousInventoryOrExpensePurchase(message: string): boolean {
  const normalized = normalizeInput(message);
  const hasPurchaseVerb = /\b(beli|bayar|belanja)\b/.test(normalized);
  const hasAmbiguousObject = /\b(bahan|bahan masak|bahan baku|barang|stok|persediaan)\b/.test(normalized);
  return hasPurchaseVerb && hasAmbiguousObject;
}

export function createInventoryOrExpenseClarification(input: ParseIntentInput): ParseIntentResult | null {
  if (!isAmbiguousInventoryOrExpensePurchase(input.message)) return null;

  const amount = parseAmount(input.message);
  return {
    status: "needs_clarification",
    proposedAction: null,
    missingFields: ["intent"],
    validationErrors: [],
    question: INVENTORY_OR_EXPENSE_QUESTION,
    options: INVENTORY_OR_EXPENSE_OPTIONS,
    confidence: 0.72,
    parserModel: PARSER_MODEL,
    parserVersion: PARSER_VERSION,
    structuredPayload: {
      rawInputText: input.message,
      amount,
      date: parseIndonesianDate(input.message) ?? input.today,
      detectedIntent: "ambiguous_purchase",
      ambiguityType: "inventory_or_direct_expense",
    },
  };
}

export function resolveInventoryOrExpenseClarification(input: ParseIntentInput): ParseIntentResult | null {
  const previousPayload = input.clarification?.previousPayload;
  const answer = input.clarification?.answer;
  if (!previousPayload || previousPayload.ambiguityType !== "inventory_or_direct_expense") return null;
  if (answer !== "inventory_purchase_value" && answer !== "general_expense") return null;

  const amount =
    typeof previousPayload.amount === "number" && Number.isInteger(previousPayload.amount) && previousPayload.amount > 0
      ? previousPayload.amount
      : parseAmount(input.message);

  if (!amount) {
    return {
      status: "needs_clarification",
      proposedAction: null,
      missingFields: ["amount"],
      validationErrors: [],
      question: "Berapa nominal transaksinya?",
      options: [],
      confidence: 0.7,
      parserModel: PARSER_MODEL,
      parserVersion: PARSER_VERSION,
      structuredPayload: previousPayload,
    };
  }

  const account = resolvePaymentAccount(input);
  const accountName = account?.name ?? input.defaultPaymentAccountName ?? "Kas";
  const isInventory = answer === "inventory_purchase_value";
  const actionBase = {
    intent: answer,
    amount,
    date: typeof previousPayload.date === "string" ? previousPayload.date : parseIndonesianDate(input.message) ?? input.today,
    paymentAccountId: account?.id ?? input.defaultPaymentAccountId,
    paymentAccountName: account?.name ?? input.defaultPaymentAccountName,
    description: baseDescription(input.message),
    affectedObject: isInventory ? "Persediaan" : null,
  } satisfies Omit<ProposedAction, "expectedEffects" | "warning">;

  const proposedAction: ProposedAction = {
    ...actionBase,
    expectedEffects: [
      `${accountName} berkurang ${formatIdr(amount)}`,
      isInventory ? `Nilai persediaan bertambah ${formatIdr(amount)}` : `Biaya bertambah ${formatIdr(amount)}`,
    ],
    warning: "Transaksi ini dibuat dari jawaban klarifikasi. Periksa lagi sebelum disimpan.",
  };

  return {
    status: "parsed",
    proposedAction,
    missingFields: [],
    validationErrors: [],
    confidence: 0.9,
    parserModel: PARSER_MODEL,
    parserVersion: PARSER_VERSION,
    structuredPayload: proposedAction,
    requiresConfirmationReason: "clarified_ambiguity",
  };
}

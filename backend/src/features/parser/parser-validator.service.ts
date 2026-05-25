import type { GeminiParserDraft } from "./gemini-parser.types.js";
import { supportedIntentSchema } from "./gemini-parser.types.js";
import { intentOptions } from "./intent-catalog.js";
import type { ParseIntentInput, ParseIntentResult, ProposedAction } from "./parser.types.js";
import { proposedActionSchema } from "./parser.types.js";

const PARSER_VERSION = "gemini-engine-v1";
const LOW_CONFIDENCE_THRESHOLD = 0.5;

function formatIdr(amount: number): string {
  return `Rp${amount.toLocaleString("id-ID")}`;
}

function compactUnique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function resolvePaymentAccount(input: ParseIntentInput, draft: GeminiParserDraft) {
  if (draft.paymentAccountId) {
    const matchedById = input.paymentAccounts.find((account) => account.id === draft.paymentAccountId);
    if (matchedById) return matchedById;
  }

  if (draft.paymentAccountName) {
    const matchedByName = input.paymentAccounts.filter(
      (account) => normalize(account.name) === normalize(draft.paymentAccountName ?? ""),
    );
    if (matchedByName.length === 1) return matchedByName[0];
    if (matchedByName.length > 1) return "ambiguous" as const;
  }

  const defaultAccount =
    input.paymentAccounts.find((account) => account.id === input.defaultPaymentAccountId) ??
    input.paymentAccounts.find((account) => account.isDefault) ??
    input.paymentAccounts[0] ??
    null;

  return defaultAccount;
}

function effectsFor(action: Omit<ProposedAction, "expectedEffects" | "warning">): string[] {
  const accountName = action.paymentAccountName ?? "Kas";
  const amount = formatIdr(action.amount);

  switch (action.intent) {
    case "sales_income":
      return [`${accountName} bertambah ${amount}`, `Pendapatan bertambah ${amount}`];
    case "owner_capital_contribution":
      return [`${accountName} bertambah ${amount}`, `Modal pemilik bertambah ${amount}`];
    case "inventory_purchase_value":
      return [`${accountName} berkurang ${amount}`, `Nilai persediaan bertambah ${amount}`];
    case "asset_record_or_purchase":
      return [`Aset usaha bertambah ${amount}`, `${accountName} dapat berkurang ${amount} jika ini pembelian tunai`];
    case "liability_created":
      return [`Utang bertambah ${amount}`, `Aktiva atau biaya terkait bertambah ${amount}`];
    case "liability_payment":
      return [`${accountName} berkurang ${amount}`, `Utang berkurang ${amount}`];
    case "receivable_created":
      return [`Piutang bertambah ${amount}`, `Pendapatan bertambah ${amount}`];
    case "receivable_payment":
      return [`${accountName} bertambah ${amount}`, `Piutang berkurang ${amount}`];
    case "owner_withdrawal":
      return [`${accountName} berkurang ${amount}`, `Prive bertambah ${amount}`];
    case "reversal":
      return [`Transaksi terkait akan dibalik sebesar ${amount}`];
    case "general_expense":
    default:
      return [`${accountName} berkurang ${amount}`, `Biaya bertambah ${amount}`];
  }
}

function clarificationResult(input: {
  draft: GeminiParserDraft;
  parserModel: string;
  missingFields: string[];
  validationErrors?: string[];
  question: string;
  options?: Array<{ label: string; value: string }>;
}): ParseIntentResult {
  return {
    status: "needs_clarification",
    proposedAction: null,
    missingFields: compactUnique(input.missingFields),
    validationErrors: input.validationErrors ?? [],
    question: input.question,
    options: input.options ?? [],
    confidence: input.draft.confidence,
    parserModel: input.parserModel,
    parserVersion: PARSER_VERSION,
    structuredPayload: input.draft as unknown as Record<string, unknown>,
  };
}

export function validateParserDraft(
  input: ParseIntentInput,
  draft: GeminiParserDraft,
  parserModel: string,
): ParseIntentResult {
  if (draft.multipleEvents) {
    return clarificationResult({
      draft,
      parserModel,
      missingFields: ["single_event"],
      question: "Tolong tulis satu transaksi dulu ya, supaya konfirmasinya jelas.",
    });
  }

  if (draft.confidence < LOW_CONFIDENCE_THRESHOLD) {
    return clarificationResult({
      draft,
      parserModel,
      missingFields: compactUnique(["intent", ...draft.missingFields]),
      question: draft.clarificationQuestion ?? "Transaksi ini paling cocok dicatat sebagai apa?",
      options: intentOptions,
    });
  }

  const missingFields = [...draft.missingFields];
  const validationErrors: string[] = [];

  if (!draft.detectedIntent || !supportedIntentSchema.safeParse(draft.detectedIntent).success) {
    missingFields.push("intent");
    validationErrors.push("Intent is not supported.");
  }
  if (draft.amount === null || draft.amount === undefined) missingFields.push("amount");
  if (!draft.description?.trim()) missingFields.push("description");

  if (draft.amount !== null && draft.amount !== undefined) {
    if (!Number.isInteger(draft.amount) || draft.amount <= 0) {
      missingFields.push("amount");
      validationErrors.push("Amount must be a positive integer.");
    }
  }

  const date = draft.date?.trim() || input.today;
  if (!isValidDate(date)) {
    missingFields.push("date");
    validationErrors.push("Date must use YYYY-MM-DD format.");
  }

  const account = resolvePaymentAccount(input, draft);
  if (account === "ambiguous") {
    missingFields.push("paymentAccountId");
  }

  const compactMissingFields = compactUnique(missingFields);
  if (compactMissingFields.length > 0 || account === "ambiguous") {
    const intentIsMissing = compactMissingFields.includes("intent");
    return clarificationResult({
      draft,
      parserModel,
      missingFields: compactMissingFields,
      validationErrors,
      question:
        draft.clarificationQuestion ??
        (intentIsMissing ? "Transaksi ini paling cocok dicatat sebagai apa?" : "Ada detail transaksi yang masih kurang. Bisa lengkapi?"),
      options: intentIsMissing ? intentOptions : [],
    });
  }

  const actionBase = {
    intent: draft.detectedIntent!,
    amount: draft.amount!,
    date,
    paymentAccountId: account?.id ?? null,
    paymentAccountName: account?.name ?? null,
    description: draft.description!.trim(),
    affectedObject: draft.affectedObject?.trim() || null,
  };

  const warning =
    draft.assumptions.length > 0
      ? `Asumsi parser: ${draft.assumptions.join("; ")}. Periksa lagi sebelum konfirmasi.`
      : null;

  const proposedAction = proposedActionSchema.parse({
    ...actionBase,
    expectedEffects: effectsFor(actionBase),
    warning,
  });

  return {
    status: "parsed",
    proposedAction,
    missingFields: [],
    validationErrors: [],
    confidence: draft.confidence,
    parserModel,
    parserVersion: PARSER_VERSION,
    structuredPayload: proposedAction,
  };
}

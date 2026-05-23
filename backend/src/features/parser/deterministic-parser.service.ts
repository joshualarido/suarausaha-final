import type { IntentParser, ParseIntentInput, ParseIntentResult, ProposedAction } from "./parser.types.js";

const PARSER_MODEL = "deterministic-output";
const PARSER_VERSION = "phase-2-v1";

function formatIdr(amount: number): string {
  return `Rp${amount.toLocaleString("id-ID")}`;
}

function normalizeInput(message: string): string {
  return message.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseAmount(message: string): number | null {
  const normalized = normalizeInput(message).replace(/rp\s*/g, "");
  const match = normalized.match(/(\d+(?:[.,]\d+)?)\s*(ribu|rb|juta|jt)?/);

  if (!match) {
    return null;
  }

  const rawNumber = match[1];
  const unit = match[2] ?? "";
  const numberValue = Number(rawNumber.replace(/\./g, "").replace(",", "."));

  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return null;
  }

  if (unit === "juta" || unit === "jt") {
    return Math.round(numberValue * 1_000_000);
  }

  if (unit === "ribu" || unit === "rb") {
    return Math.round(numberValue * 1_000);
  }

  return Math.round(numberValue);
}

function baseDescription(message: string): string {
  const trimmed = message.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function createDeterministicProposedAction(
  input: ParseIntentInput,
  intent: ProposedAction["intent"],
  amount: number,
): ProposedAction {
  const accountName = input.defaultPaymentAccountName ?? "Kas";
  const incoming = intent === "sales_income" || intent === "owner_capital_contribution";
  const inventory = intent === "inventory_purchase_value";
  const expense = intent === "general_expense";

  const expectedEffects = incoming
    ? [`${accountName} bertambah ${formatIdr(amount)}`, `Pendapatan bertambah ${formatIdr(amount)}`]
    : [
        `${accountName} berkurang ${formatIdr(amount)}`,
        inventory ? `Nilai persediaan bertambah ${formatIdr(amount)}` : `Biaya bertambah ${formatIdr(amount)}`,
      ];

  return {
    intent,
    amount,
    date: input.today,
    paymentAccountId: input.defaultPaymentAccountId,
    paymentAccountName: input.defaultPaymentAccountName,
    description: baseDescription(input.message),
    affectedObject: inventory ? "Persediaan" : null,
    expectedEffects,
    warning: inventory || expense ? "Saldo akun pembayaran akan diperiksa lagi saat konfirmasi." : null,
  };
}

function classifyIntent(message: string): ProposedAction["intent"] | "ambiguous_purchase" | null {
  const normalized = normalizeInput(message);

  if (/\b(jual|penjualan|terima uang|pemasukan)\b/.test(normalized)) {
    return "sales_income";
  }

  if (/\b(stok|persediaan|bahan)\b/.test(normalized) && /\b(beli|bayar|belanja)\b/.test(normalized)) {
    return "ambiguous_purchase";
  }

  if (/\b(listrik|sewa|internet|biaya|beban)\b/.test(normalized) && /\b(bayar|beli|belanja)\b/.test(normalized)) {
    return "general_expense";
  }

  return null;
}

export function createDeterministicIntentParser(): IntentParser {
  return {
    async parse(input: ParseIntentInput): Promise<ParseIntentResult> {
      const amount = parseAmount(input.message);
      const intent = classifyIntent(input.message);

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
          structuredPayload: {
            rawInputText: input.message,
            detectedIntent: intent,
          },
        };
      }

      if (intent === "ambiguous_purchase") {
        return {
          status: "needs_clarification",
          proposedAction: null,
          missingFields: ["intent"],
          validationErrors: [],
          question: "Ini mau dicatat sebagai stok/persediaan atau sebagai biaya langsung?",
          options: [
            { label: "Stok / Persediaan", value: "inventory_purchase_value" },
            { label: "Biaya langsung", value: "general_expense" },
          ],
          confidence: 0.72,
          parserModel: PARSER_MODEL,
          parserVersion: PARSER_VERSION,
          structuredPayload: {
            rawInputText: input.message,
            amount,
            detectedIntent: "ambiguous_purchase",
          },
        };
      }

      if (!intent) {
        return {
          status: "needs_clarification",
          proposedAction: null,
          missingFields: ["intent"],
          validationErrors: [],
          question: "Transaksi ini mau dicatat sebagai apa?",
          options: [
            { label: "Pemasukan penjualan", value: "sales_income" },
            { label: "Biaya usaha", value: "general_expense" },
          ],
          confidence: 0.5,
          parserModel: PARSER_MODEL,
          parserVersion: PARSER_VERSION,
          structuredPayload: {
            rawInputText: input.message,
            amount,
          },
        };
      }

      const proposedAction = createDeterministicProposedAction(input, intent, amount);

      return {
        status: "parsed",
        proposedAction,
        missingFields: [],
        validationErrors: [],
        confidence: 0.91,
        parserModel: PARSER_MODEL,
        parserVersion: PARSER_VERSION,
        structuredPayload: proposedAction,
      };
    },
  };
}

export const deterministicIntentParser = createDeterministicIntentParser();

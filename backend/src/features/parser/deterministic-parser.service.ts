import type {
  IntentParser,
  ParseIntentInput,
  ParseIntentResult,
  ParserMenuItemContext,
  ProposedAction,
} from "./parser.types.js";

const PARSER_MODEL = "deterministic-output";
const PARSER_VERSION = "phase-2-v1";

function formatIdr(amount: number): string {
  return `Rp${amount.toLocaleString("id-ID")}`;
}

function normalizeInput(message: string): string {
  return message.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeSearchText(value: string): string {
  return normalizeInput(value).replace(/[^\p{L}\p{N}\s]/gu, "");
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

function parseQuantityBeforeMenuItem(message: string, menuItem: ParserMenuItemContext): number | null {
  const normalizedMessage = normalizeSearchText(message);
  const candidates = [menuItem.name, ...menuItem.aliases].map(normalizeSearchText).filter(Boolean);

  for (const candidate of candidates) {
    const index = normalizedMessage.indexOf(candidate);
    if (index < 0) continue;

    const beforeCandidate = normalizedMessage.slice(0, index).trim();
    const quantityMatch = beforeCandidate.match(/(\d+)\s*$/);

    if (!quantityMatch) {
      return null;
    }

    const quantity = Number(quantityMatch[1]);
    return Number.isInteger(quantity) && quantity > 0 ? quantity : null;
  }

  return null;
}

function findMatchingMenuItems(message: string, menuItems: ParserMenuItemContext[]): ParserMenuItemContext[] {
  const normalizedMessage = normalizeSearchText(message);

  return menuItems.filter((item) => {
    const candidates = [item.name, ...item.aliases].map(normalizeSearchText).filter(Boolean);
    return candidates.some((candidate) => normalizedMessage.includes(candidate));
  });
}

function baseDescription(message: string): string {
  const trimmed = message.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function createDeterministicProposedAction(
  input: ParseIntentInput,
  intent: ProposedAction["intent"],
  amount: number,
  context?: {
    affectedObject?: string | null;
    warning?: string | null;
  },
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
    affectedObject: context?.affectedObject ?? (inventory ? "Persediaan" : null),
    expectedEffects,
    warning: context?.warning ?? (inventory || expense ? "Saldo akun pembayaran akan diperiksa lagi saat konfirmasi." : null),
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
      const intent = classifyIntent(input.message);
      const matchingMenuItems = intent === "sales_income" ? findMatchingMenuItems(input.message, input.menuItems) : [];

      if (matchingMenuItems.length > 1) {
        return {
          status: "needs_clarification",
          proposedAction: null,
          missingFields: ["menu_item"],
          validationErrors: [],
          question: "Menu mana yang dimaksud?",
          options: matchingMenuItems.map((item) => ({ label: item.name, value: item.id })),
          confidence: 0.68,
          parserModel: PARSER_MODEL,
          parserVersion: PARSER_VERSION,
          structuredPayload: {
            rawInputText: input.message,
            detectedIntent: intent,
            menuMatches: matchingMenuItems.map((item) => ({ id: item.id, name: item.name })),
          },
        };
      }

      if (matchingMenuItems.length === 1) {
        const [menuItem] = matchingMenuItems;
        const quantity = parseQuantityBeforeMenuItem(input.message, menuItem);

        if (!quantity || menuItem.defaultPrice === null) {
          return {
            status: "needs_clarification",
            proposedAction: null,
            missingFields: ["amount"],
            validationErrors: [],
            question: "Berapa nominal transaksinya?",
            options: [],
            confidence: 0.74,
            parserModel: PARSER_MODEL,
            parserVersion: PARSER_VERSION,
            structuredPayload: {
              rawInputText: input.message,
              detectedIntent: intent,
              menuMatch: {
                id: menuItem.id,
                name: menuItem.name,
              },
            },
          };
        }

        const amountFromMenu = quantity * menuItem.defaultPrice;
        const proposedAction = createDeterministicProposedAction(input, "sales_income", amountFromMenu, {
          affectedObject: menuItem.name,
          warning: `Nominal dihitung dari ${quantity} x harga menu ${menuItem.name}. Periksa lagi sebelum konfirmasi.`,
        });

        return {
          status: "parsed",
          proposedAction,
          missingFields: [],
          validationErrors: [],
          confidence: 0.9,
          parserModel: PARSER_MODEL,
          parserVersion: PARSER_VERSION,
          structuredPayload: proposedAction,
        };
      }

      const amount = parseAmount(input.message);

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

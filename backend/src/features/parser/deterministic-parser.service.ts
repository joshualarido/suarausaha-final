import type {
  IntentParser,
  ParseIntentInput,
  ParseIntentResult,
  ParserMenuItemContext,
  ProposedAction,
} from "./parser.types.js";
import { createInventoryOrExpenseClarification } from "./ambiguity.service.js";

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
  const candidates = [menuItem.name, ...menuItem.aliases].map(normalizeSearchText).filter(Boolean);
  const quantityUnitPattern = "(porsi|pcs|pc|buah|gelas|botol|bungkus|paket|cup)";

  for (const candidate of candidates) {
    const matchedSegment = splitOrderSegments(message).find((segment) => segment.includes(candidate));
    if (!matchedSegment) continue;

    const index = matchedSegment.indexOf(candidate);
    if (index < 0) continue;

    const beforeCandidate = matchedSegment.slice(0, index).trim();
    const quantityMatch = beforeCandidate.match(/(\d+)\s*$/);
    if (quantityMatch) {
      const quantity = Number(quantityMatch[1]);
      return Number.isInteger(quantity) && quantity > 0 && quantity <= 99 ? quantity : null;
    }

    const afterCandidate = matchedSegment.slice(index + candidate.length).trim();
    const afterQuantityMatch = afterCandidate.match(
      new RegExp(`^(?:[^\\d,]+\\s+){0,3}?(\\d+)(?:\\s*${quantityUnitPattern}\\b)?`),
    );
    if (afterQuantityMatch) {
      const quantity = Number(afterQuantityMatch[1]);
      return Number.isInteger(quantity) && quantity > 0 && quantity <= 99 ? quantity : null;
    }
  }

  return null;
}

function splitOrderSegments(message: string): string[] {
  const normalizedMessage = normalizeInput(message).replace(/[^\p{L}\p{N},\s]/gu, " ");
  return normalizedMessage
    .replace(/\b(?:dan|and|plus|tambah)\b/g, ",")
    .split(",")
    .map((segment) => normalizeSearchText(segment))
    .filter(Boolean);
}

function parsePaymentHint(message: string): "cash" | "non_cash" | null {
  const normalized = normalizeInput(message);
  if (/\b(tunai|kas|cash)\b/.test(normalized)) return "cash";
  if (/\b(transfer|qris|debit|bank|ewallet|e-wallet)\b/.test(normalized)) return "non_cash";
  return null;
}

function resolveDeterministicPaymentAccount(input: ParseIntentInput) {
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

function findPaymentAccountByText(input: ParseIntentInput, value: string) {
  const normalizedValue = normalizeSearchText(value);
  if (!normalizedValue) return null;

  const matches = input.paymentAccounts.filter((account) => {
    const normalizedName = normalizeSearchText(account.name);
    const normalizedId = normalizeSearchText(account.id);
    return normalizedValue === normalizedName || normalizedValue === normalizedId || normalizedValue.includes(normalizedName);
  });

  return matches.length === 1 ? matches[0] : null;
}

function parseAccountTransfer(input: ParseIntentInput, amount: number): ParseIntentResult | null {
  const normalized = normalizeInput(input.message);
  const isTransfer =
    /\b(pindah|transfer|mutasi|geser)\b/.test(normalized) && /\bdari\b/.test(normalized) && /\b(ke|menuju)\b/.test(normalized);
  if (!isTransfer) return null;

  const accountMatch = input.message.match(/\bdari\s+(.+?)\s+(?:ke|menuju)\s+(.+)$/i);
  const sourceText = accountMatch?.[1]?.trim() ?? "";
  const destinationText = accountMatch?.[2]?.trim() ?? "";
  const sourceAccount = findPaymentAccountByText(input, sourceText);
  const destinationAccount = findPaymentAccountByText(input, destinationText);

  if (!sourceAccount || !destinationAccount) {
    return {
      status: "needs_clarification",
      proposedAction: null,
      missingFields: [
        ...(!sourceAccount ? ["paymentAccountId"] : []),
        ...(!destinationAccount ? ["destinationPaymentAccountId"] : []),
      ],
      validationErrors: [],
      question: "Transfernya dari akun mana ke akun mana?",
      options: input.paymentAccounts.map((account) => ({ label: account.name, value: account.id })),
      confidence: 0.72,
      parserModel: PARSER_MODEL,
      parserVersion: PARSER_VERSION,
      structuredPayload: {
        rawInputText: input.message,
        detectedIntent: "account_transfer",
        sourceText,
        destinationText,
      },
    };
  }

  const formattedAmount = formatIdr(amount);
  const proposedAction: ProposedAction = {
    intent: "account_transfer",
    amount,
    date: input.today,
    paymentAccountId: sourceAccount.id,
    paymentAccountName: sourceAccount.name,
    destinationPaymentAccountId: destinationAccount.id,
    destinationPaymentAccountName: destinationAccount.name,
    description: baseDescription(input.message),
    affectedObject: destinationAccount.name,
    expectedEffects: [`${sourceAccount.name} berkurang ${formattedAmount}`, `${destinationAccount.name} bertambah ${formattedAmount}`],
    warning: "Saldo akun asal akan diperiksa lagi sebelum disimpan.",
  };

  return {
    status: "parsed",
    proposedAction,
    missingFields: [],
    validationErrors: [],
    confidence: 0.88,
    parserModel: PARSER_MODEL,
    parserVersion: PARSER_VERSION,
    structuredPayload: proposedAction,
  };
}

function findMatchingMenuItems(message: string, menuItems: ParserMenuItemContext[]): ParserMenuItemContext[] {
  const normalizedMessage = normalizeSearchText(message);

  const matches = menuItems.filter((item) => {
    const candidates = [item.name, ...item.aliases].map(normalizeSearchText).filter(Boolean);
    return candidates.some((candidate) => normalizedMessage.includes(candidate));
  });

  return removeGenericMenuMatches(message, matches);
}

function getMatchedMenuTerms(message: string, menuItem: ParserMenuItemContext): string[] {
  const normalizedMessage = normalizeSearchText(message);
  return [menuItem.name, ...menuItem.aliases]
    .map(normalizeSearchText)
    .filter((term) => term && normalizedMessage.includes(term));
}

function removeGenericMenuMatches(message: string, menuItems: ParserMenuItemContext[]): ParserMenuItemContext[] {
  const matchDetails = menuItems.map((item) => {
    const terms = getMatchedMenuTerms(message, item);
    const bestTerm = terms.sort((a, b) => b.length - a.length)[0] ?? "";
    return { item, bestTerm };
  });

  return matchDetails
    .filter(({ bestTerm }, index) => {
      if (!bestTerm) return true;
      return !matchDetails.some(
        (other, otherIndex) => otherIndex !== index && other.bestTerm.length > bestTerm.length && other.bestTerm.includes(bestTerm),
      );
    })
    .map(({ item }) => item);
}

function hasSharedBestMenuTerm(message: string, menuItems: ParserMenuItemContext[]): boolean {
  const bestTerms = menuItems
    .map((item) => {
      const terms = getMatchedMenuTerms(message, item);
      return terms.sort((a, b) => b.length - a.length)[0] ?? "";
    })
    .filter(Boolean);

  return new Set(bestTerms).size !== bestTerms.length;
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
  const account = resolveDeterministicPaymentAccount(input);
  const accountName = account?.name ?? input.defaultPaymentAccountName ?? "Kas";
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
    paymentAccountId: account?.id ?? input.defaultPaymentAccountId,
    paymentAccountName: account?.name ?? input.defaultPaymentAccountName,
    description: baseDescription(input.message),
    affectedObject: context?.affectedObject ?? (inventory ? "Persediaan" : null),
    expectedEffects,
    warning: context?.warning ?? (inventory || expense ? "Saldo akun pembayaran akan diperiksa lagi sebelum disimpan." : null),
  };
}

function buildSalesOrderAction(input: ParseIntentInput, menuItems: ParserMenuItemContext[]): ProposedAction {
  const account = resolveDeterministicPaymentAccount(input);
  const accountName = account?.name ?? input.defaultPaymentAccountName ?? "Kas";
  const lines = menuItems.map((menuItem) => {
    const quantity = parseQuantityBeforeMenuItem(input.message, menuItem) ?? 1;
    const unitPrice = menuItem.defaultPrice!;
    return {
      productId: menuItem.id,
      productName: menuItem.name,
      spokenLabel: menuItem.name.toLowerCase(),
      quantity,
      unitPrice,
      subtotal: quantity * unitPrice,
      matchStatus: "matched" as const,
    };
  });
  const amount = lines.reduce((sum, line) => sum + line.subtotal, 0);

  return {
    intent: "sales_income",
    amount,
    date: input.today,
    paymentAccountId: account?.id ?? input.defaultPaymentAccountId,
    paymentAccountName: account?.name ?? input.defaultPaymentAccountName,
    description: `Jual ${lines.map((line) => `${line.quantity} ${line.productName}`).join(", ")}`,
    affectedObject: lines.map((line) => line.productName).join(", "),
    expectedEffects: [`${accountName} bertambah ${formatIdr(amount)}`, `Pendapatan bertambah ${formatIdr(amount)}`],
    warning: "Nominal dihitung dari jumlah item dan harga menu. Periksa lagi sebelum disimpan.",
    salesOrder: {
      status: "draft",
      totalAmount: amount,
      lines,
    },
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
      if (amount !== null) {
        const transferResult = parseAccountTransfer(input, amount);
        if (transferResult) return transferResult;
      }

      const ambiguityResult = createInventoryOrExpenseClarification(input);
      if (ambiguityResult) return ambiguityResult;

      const intent = classifyIntent(input.message);
      const matchingMenuItems = intent === "sales_income" ? findMatchingMenuItems(input.message, input.menuItems) : [];

      if (intent === "sales_income" && input.menuItems.length === 0) {
        return {
          status: "needs_clarification",
          proposedAction: null,
          missingFields: ["menu_item_dependency"],
          validationErrors: [],
          question: "Menu jualan belum ada. Buat menu dulu di Katalog, lalu catat penjualan lagi.",
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

      if (intent === "sales_income" && matchingMenuItems.length === 0) {
        return {
          status: "needs_clarification",
          proposedAction: null,
          missingFields: ["menu_item_dependency"],
          validationErrors: [],
          question: "Menu yang dijual belum ada di katalog. Buat menu dulu di Katalog, lalu catat penjualan lagi.",
          options: [],
          confidence: 0.72,
          parserModel: PARSER_MODEL,
          parserVersion: PARSER_VERSION,
          structuredPayload: {
            rawInputText: input.message,
            detectedIntent: intent,
          },
        };
      }

      if (matchingMenuItems.length > 1) {
        const hasMissingPrice = matchingMenuItems.some((item) => item.defaultPrice === null);
        if (!hasMissingPrice && !hasSharedBestMenuTerm(input.message, matchingMenuItems)) {
          const proposedAction = buildSalesOrderAction(input, matchingMenuItems);

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

        return {
          status: "needs_clarification",
          proposedAction: null,
          missingFields: hasMissingPrice ? ["amount"] : ["menu_item"],
          validationErrors: [],
          question: hasMissingPrice
            ? "Ada menu yang belum punya harga. Isi harga menu dulu di Katalog, lalu catat penjualan lagi."
            : "Menu mana yang dimaksud?",
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
        const parsedQuantity = parseQuantityBeforeMenuItem(input.message, menuItem);
        const quantity = parsedQuantity ?? 1;

        if (menuItem.defaultPrice === null) {
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
          warning:
            parsedQuantity === null
              ? `Nominal diasumsikan 1 x harga menu ${menuItem.name}. Periksa lagi sebelum disimpan.`
              : `Nominal dihitung dari ${quantity} x harga menu ${menuItem.name}. Periksa lagi sebelum disimpan.`,
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

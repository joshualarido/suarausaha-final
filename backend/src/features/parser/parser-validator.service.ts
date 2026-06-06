import type { GeminiParserDraft } from "./gemini-parser.types.js";
import { supportedIntentSchema } from "./gemini-parser.types.js";
import { intentOptions } from "./intent-catalog.js";
import type { ParseIntentInput, ParseIntentResult, ProposedAction } from "./parser.types.js";
import { proposedActionSchema } from "./parser.types.js";
import { createInventoryOrExpenseClarification } from "./ambiguity.service.js";

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

function normalizeSearchText(value: string): string {
  return normalize(value).replace(/[^\p{L}\p{N}\s]/gu, "");
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parsePaymentHint(message: string): "cash" | "non_cash" | null {
  const normalized = normalize(message);
  if (/\b(tunai|kas|cash)\b/.test(normalized)) return "cash";
  if (/\b(transfer|qris|debit|bank|ewallet|e-wallet|kartu kredit|kredit)\b/.test(normalized)) return "non_cash";
  return null;
}

function resolvePaymentAccount(input: ParseIntentInput, draft: GeminiParserDraft) {
  const clarificationAnswer = input.clarification?.answer.trim();
  if (clarificationAnswer) {
    const matchedByClarification =
      input.paymentAccounts.find((account) => account.id === clarificationAnswer) ??
      input.paymentAccounts.find((account) => normalize(account.name) === normalize(clarificationAnswer));
    if (matchedByClarification) return matchedByClarification;
    if (clarificationAnswer === "non_cash") return "unknown" as const;
  }

  if (draft.paymentAccountId) {
    const matchedById = input.paymentAccounts.find((account) => account.id === draft.paymentAccountId);
    if (matchedById) return matchedById;
    return "unknown" as const;
  }

  if (draft.paymentAccountName) {
    const matchedByName = input.paymentAccounts.filter(
      (account) => normalize(account.name) === normalize(draft.paymentAccountName ?? ""),
    );
    if (matchedByName.length === 1) return matchedByName[0];
    if (matchedByName.length > 1) return "ambiguous" as const;
    return "unknown" as const;
  }

  const paymentHint = parsePaymentHint(input.message);
  if (paymentHint) {
    const matchedByHint = input.paymentAccounts.filter((account) => account.type === paymentHint);
    if (matchedByHint.length === 1) return matchedByHint[0];
    if (matchedByHint.length > 1) return "ambiguous" as const;
    if (paymentHint === "non_cash") return "unknown" as const;
  }

  return null;
}

function resolveDestinationPaymentAccount(input: ParseIntentInput, draft: GeminiParserDraft) {
  if (draft.destinationPaymentAccountId) {
    const matchedById = input.paymentAccounts.find((account) => account.id === draft.destinationPaymentAccountId);
    if (matchedById) return matchedById;
    return "unknown" as const;
  }

  if (draft.destinationPaymentAccountName) {
    const matchedByName = input.paymentAccounts.filter(
      (account) => normalize(account.name) === normalize(draft.destinationPaymentAccountName ?? ""),
    );
    if (matchedByName.length === 1) return matchedByName[0];
    if (matchedByName.length > 1) return "ambiguous" as const;
    return "unknown" as const;
  }

  return null;
}

function moneyMovementIntent(intent: ProposedAction["intent"] | null): boolean {
  return intent !== null && intent !== "receivable_created" && intent !== "reversal";
}

function outgoingPaymentIntent(intent: ProposedAction["intent"] | null): boolean {
  return (
    intent === "general_expense" ||
    intent === "inventory_purchase_value" ||
    intent === "asset_record_or_purchase" ||
    intent === "liability_payment" ||
    intent === "owner_withdrawal" ||
    intent === "account_transfer"
  );
}

function buildPaymentAccountOptions(input: ParseIntentInput): Array<{ label: string; value: string }> {
  const options = input.paymentAccounts.map((account) => ({
    label: account.name,
    value: account.id,
  }));

  if (!input.paymentAccounts.some((account) => account.type === "non_cash")) {
    options.push({ label: "Bank / QRIS / E-wallet", value: "non_cash" });
  }

  return options;
}

function unknownPaymentAccountName(input: ParseIntentInput, draft: GeminiParserDraft): string {
  const fromDraft = draft.paymentAccountName?.trim();
  if (fromDraft) return fromDraft;

  const normalized = normalize(input.message);
  if (/\bkartu kredit\b/.test(normalized)) return "Kartu Kredit";
  if (/\bqris\b/.test(normalized)) return "QRIS";
  if (/\bbank\b/.test(normalized)) return "Bank";
  if (/\b(e-wallet|ewallet)\b/.test(normalized)) return "E-wallet";
  if (/\bkredit\b/.test(normalized)) return "Kartu Kredit";
  return "Bank / QRIS / E-wallet";
}

function findMenuMatches(input: ParseIntentInput, draft: GeminiParserDraft) {
  const menuItems = input.menuItems;
  const searchTerms = compactUnique([draft.affectedObject, draft.description, input.message]).map(normalize);

  return menuItems.filter((item) => {
    const menuTerms = compactUnique([item.name, ...item.aliases]).map(normalize);
    return searchTerms.some((searchTerm) =>
      menuTerms.some((menuTerm) => menuTerm.includes(searchTerm) || searchTerm.includes(menuTerm)),
    );
  });
}

function parseQuantityBeforeMenuItem(message: string, menuItem: ParseIntentInput["menuItems"][number]): number | null {
  const normalizedMessage = normalizeSearchText(message);
  const candidates = compactUnique([menuItem.name, ...menuItem.aliases]).map(normalizeSearchText).filter(Boolean);

  for (const candidate of candidates) {
    const index = normalizedMessage.indexOf(candidate);
    if (index < 0) continue;

    const beforeCandidate = normalizedMessage.slice(0, index).trim();
    const quantityMatch = beforeCandidate.match(/(\d+)\s*$/);
    if (!quantityMatch) return null;

    const quantity = Number(quantityMatch[1]);
    if (Number.isInteger(quantity) && quantity > 0) return quantity;
    return null;
  }

  return null;
}

function findLiabilityMatches(input: ParseIntentInput, target: string) {
  const normalizedTarget = normalize(target);
  const openLiabilities = input.openLiabilities ?? [];

  return openLiabilities.filter(
    (item) =>
      item.id === target ||
      normalize(item.lenderName).includes(normalizedTarget) ||
      normalize(item.description ?? "").includes(normalizedTarget),
  );
}

function findReceivableMatches(input: ParseIntentInput, target: string) {
  const normalizedTarget = normalize(target);
  const openReceivables = input.openReceivables ?? [];

  return openReceivables.filter(
    (item) =>
      item.id === target ||
      normalize(item.customerName).includes(normalizedTarget) ||
      normalize(item.description ?? "").includes(normalizedTarget),
  );
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
      return [`${accountName} berkurang ${amount}`, `Utang ${action.affectedObject ?? ""}`.trim() + ` berkurang ${amount}`];
    case "receivable_created":
      return [`Piutang bertambah ${amount}`, `Pendapatan bertambah ${amount}`];
    case "receivable_payment":
      return [`${accountName} bertambah ${amount}`, `Piutang ${action.affectedObject ?? ""}`.trim() + ` berkurang ${amount}`];
    case "owner_withdrawal":
      return [`${accountName} berkurang ${amount}`, `Prive bertambah ${amount}`];
    case "account_transfer":
      return [`${accountName} berkurang ${amount}`, `${action.destinationPaymentAccountName ?? "Akun tujuan"} bertambah ${amount}`];
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
  const ambiguityResult = createInventoryOrExpenseClarification(input);
  if (ambiguityResult) return ambiguityResult;

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
  let inferredAmount: number | null = null;
  let inferredSalesQuantity: number | null = null;
  let inferredSalesMenuName: string | null = null;

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

  const normalizedIntent = supportedIntentSchema.safeParse(draft.detectedIntent).success ? draft.detectedIntent : null;
  const account = resolvePaymentAccount(input, draft);
  const destinationAccount = normalizedIntent === "account_transfer" ? resolveDestinationPaymentAccount(input, draft) : null;
  if (account === "ambiguous") {
    missingFields.push("paymentAccountId");
  }
  if (destinationAccount === "ambiguous") {
    missingFields.push("destinationPaymentAccountId");
  }
  let normalizedAffectedObject = draft.affectedObject?.trim() || null;

  if (account === "unknown" && moneyMovementIntent(normalizedIntent)) {
    const accountName = unknownPaymentAccountName(input, draft);
    return clarificationResult({
      draft,
      parserModel,
      missingFields: compactUnique([...missingFields, "paymentAccountDependency"]),
      validationErrors,
      question: `Akun pembayaran ${accountName} belum dibuat. Buat akun itu dulu, lalu catat transaksi lagi.`,
    });
  }

  if (normalizedIntent === "account_transfer") {
    if (destinationAccount === "unknown") {
      const accountName = draft.destinationPaymentAccountName?.trim() || "akun tujuan";
      return clarificationResult({
        draft,
        parserModel,
        missingFields: compactUnique([...missingFields, "destinationPaymentAccountDependency"]),
        validationErrors,
        question: `Akun tujuan ${accountName} belum dibuat. Buat akun itu dulu, lalu catat transfer lagi.`,
      });
    }

    if (!destinationAccount) {
      missingFields.push("destinationPaymentAccountId");
    }

    if (account && account !== "unknown" && account !== "ambiguous" && destinationAccount && destinationAccount !== "ambiguous") {
      if (account.id === destinationAccount.id) {
        missingFields.push("destinationPaymentAccountId");
        validationErrors.push("Source and destination payment accounts must be different.");
      }
    }
  }

  if (normalizedIntent === "sales_income") {
    if (input.menuItems.length === 0) {
      return clarificationResult({
        draft,
        parserModel,
        missingFields: compactUnique([...missingFields, "menu_item_dependency"]),
        validationErrors,
        question: "Menu jualan belum ada. Buat menu dulu di Katalog, lalu catat penjualan lagi.",
      });
    }

    const matchedMenus = findMenuMatches(input, draft);
    if (matchedMenus.length === 0) {
      const targetLabel = draft.affectedObject?.trim();
      return clarificationResult({
        draft,
        parserModel,
        missingFields: compactUnique([...missingFields, "menu_item_dependency"]),
        validationErrors,
        question: targetLabel
          ? `Menu ${targetLabel} belum ada di katalog. Buat menu dulu, lalu catat penjualan lagi.`
          : "Menu yang dijual belum ada di katalog. Buat menu dulu di Katalog, lalu catat penjualan lagi.",
      });
    }

    if (matchedMenus.length > 1) {
      return clarificationResult({
        draft,
        parserModel,
        missingFields: compactUnique([...missingFields, "menu_item"]),
        validationErrors,
        question: "Ada beberapa menu yang mirip. Pilih menu yang dimaksud dulu.",
        options: matchedMenus.map((item) => ({
          label: item.name,
          value: item.id,
        })),
      });
    }

    const [matchedMenu] = matchedMenus;
    normalizedAffectedObject = matchedMenu.name;
    inferredSalesMenuName = matchedMenu.name;

    if ((draft.amount === null || draft.amount === undefined) && matchedMenu.defaultPrice !== null) {
      inferredSalesQuantity = parseQuantityBeforeMenuItem(input.message, matchedMenu) ?? 1;
      inferredAmount = inferredSalesQuantity * matchedMenu.defaultPrice;
    }
  }

  if (inferredAmount !== null) {
    for (let index = missingFields.length - 1; index >= 0; index -= 1) {
      if (missingFields[index] === "amount") {
        missingFields.splice(index, 1);
      }
    }
  }

  if (normalizedIntent === "liability_payment") {
    const target = draft.affectedObject?.trim();
    const openLiabilities = input.openLiabilities ?? [];

    if (openLiabilities.length === 0) {
      return clarificationResult({
        draft,
        parserModel,
        missingFields: compactUnique([...missingFields, "liability_dependency"]),
        validationErrors,
        question: "Belum ada data utang aktif. Buat data utang dulu, baru catat pembayaran.",
      });
    }

    if (!target) {
      missingFields.push("affectedObject");
    } else {
      const matches = findLiabilityMatches(input, target);
      if (matches.length === 0) {
        return clarificationResult({
          draft,
          parserModel,
          missingFields: compactUnique([...missingFields, "liability_dependency"]),
          validationErrors,
          question: `Utang ${target} belum ada. Buat data utang dulu, baru catat pembayaran.`,
        });
      }

      if (matches.length > 1) {
        return clarificationResult({
          draft,
          parserModel,
          missingFields: compactUnique([...missingFields, "affectedObject"]),
          validationErrors,
          question: "Ada lebih dari satu utang yang mirip. Sebutkan nama utangnya lebih spesifik.",
        });
      }

      normalizedAffectedObject = matches[0].lenderName;
    }
  }

  if (normalizedIntent === "receivable_payment") {
    const target = draft.affectedObject?.trim();
    const openReceivables = input.openReceivables ?? [];

    if (openReceivables.length === 0) {
      return clarificationResult({
        draft,
        parserModel,
        missingFields: compactUnique([...missingFields, "receivable_dependency"]),
        validationErrors,
        question: "Belum ada data piutang aktif. Buat data piutang dulu, baru catat pembayarannya.",
      });
    }

    if (!target) {
      missingFields.push("affectedObject");
    } else {
      const matches = findReceivableMatches(input, target);
      if (matches.length === 0) {
        return clarificationResult({
          draft,
          parserModel,
          missingFields: compactUnique([...missingFields, "receivable_dependency"]),
          validationErrors,
          question: `Piutang ${target} belum ada. Buat data piutang dulu, baru catat pembayarannya.`,
        });
      }

      if (matches.length > 1) {
        const customerNames = compactUnique(matches.map((match) => normalize(match.customerName)));
        if (customerNames.length > 1) {
          return clarificationResult({
            draft,
            parserModel,
            missingFields: compactUnique([...missingFields, "affectedObject"]),
            validationErrors,
            question: "Ada lebih dari satu piutang yang mirip. Sebutkan nama pelanggan lebih spesifik.",
          });
        }
      }

      normalizedAffectedObject = matches[0].customerName;
    }
  }

  if (!account && moneyMovementIntent(normalizedIntent)) {
    missingFields.push("paymentAccountId");
  }

  const compactMissingFields = compactUnique(missingFields);
  if (compactMissingFields.length > 0 || account === "ambiguous") {
    const intentIsMissing = compactMissingFields.includes("intent");
    const paymentAccountIsMissing = compactMissingFields.includes("paymentAccountId");
    const destinationPaymentAccountIsMissing = compactMissingFields.includes("destinationPaymentAccountId");
    return clarificationResult({
      draft,
      parserModel,
      missingFields: compactMissingFields,
      validationErrors,
      question:
        destinationPaymentAccountIsMissing && normalizedIntent === "account_transfer"
          ? "Uang ini dipindahkan ke akun mana?"
          : 
        paymentAccountIsMissing && moneyMovementIntent(normalizedIntent)
          ? outgoingPaymentIntent(normalizedIntent)
            ? "Bayarnya pakai akun yang mana?"
            : "Uangnya masuk ke akun yang mana?"
          : draft.clarificationQuestion ??
            (intentIsMissing ? "Transaksi ini paling cocok dicatat sebagai apa?" : "Ada detail transaksi yang masih kurang. Bisa lengkapi?"),
      options:
        (paymentAccountIsMissing || destinationPaymentAccountIsMissing) && moneyMovementIntent(normalizedIntent)
          ? buildPaymentAccountOptions(input)
          : intentIsMissing
            ? intentOptions
            : [],
    });
  }

  const resolvedAccount = account && account !== "unknown" ? account : null;
  const resolvedDestinationAccount =
    destinationAccount && destinationAccount !== "unknown" && destinationAccount !== "ambiguous" ? destinationAccount : null;
  const actionBase = {
    intent: draft.detectedIntent!,
    amount: inferredAmount ?? draft.amount!,
    date,
    paymentAccountId: resolvedAccount?.id ?? null,
    paymentAccountName: resolvedAccount?.name ?? null,
    destinationPaymentAccountId: resolvedDestinationAccount?.id ?? null,
    destinationPaymentAccountName: resolvedDestinationAccount?.name ?? null,
    description: draft.description!.trim(),
    affectedObject: normalizedAffectedObject,
  };

  const assumptionNotes = [...draft.assumptions];
  if (inferredAmount !== null && inferredSalesQuantity !== null && inferredSalesMenuName) {
    if (inferredSalesQuantity === 1) {
      assumptionNotes.push(`Nominal diasumsikan 1 x harga menu ${inferredSalesMenuName}`);
    } else {
      assumptionNotes.push(`Nominal dihitung dari ${inferredSalesQuantity} x harga menu ${inferredSalesMenuName}`);
    }
  }

  const warning =
    actionBase.intent === "account_transfer"
      ? "Saldo akun asal akan diperiksa lagi sebelum disimpan."
      : actionBase.intent === "receivable_payment"
      ? "Ini tidak menambah pendapatan lagi."
      : assumptionNotes.length > 0
      ? `Asumsi parser: ${assumptionNotes.join("; ")}. Periksa lagi sebelum disimpan.`
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

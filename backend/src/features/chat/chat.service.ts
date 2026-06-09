import { randomUUID } from "node:crypto";
import { db, type ParsedCommandRow } from "../../lib/database.js";
import { runFinancialWrite, type FinancialWriteTx } from "../../lib/financial-write.js";
import {
  cancelPendingConfirmationsInTransaction,
  createConfirmationRequest,
  createNeracaConfirmationRequest,
  listPendingIntentConfirmations,
  toConfirmationResponse,
} from "../confirmations/confirmation.service.js";
import { previewNeraca, type NeracaSnapshotData } from "../neraca/neraca.service.js";
import { listActiveMenuItemsByBusinessId } from "../menu-items/menu-item.service.js";
import { listPaymentAccountsByBusinessId } from "../payment-accounts/payment-account.service.js";
import { parserEngine } from "../parser/parser-engine.service.js";
import type { ParseIntentInput, ParseIntentResult, ProposedAction } from "../parser/parser.types.js";
import { parseProposedActionJson } from "../transactions/transaction-dto.mapper.js";
import { createInventoryOrExpenseClarification, resolveInventoryOrExpenseClarification } from "../parser/ambiguity.service.js";
import {
  AmbiguousFinancialTargetError,
  createBaseTransactionInTransaction,
  FinancialTargetNotFoundError,
  FinancialTargetOverpaymentError,
  InsufficientPaymentAccountBalanceError,
  InvalidPaymentAccountOwnershipError,
  MissingAffectedObjectError,
  MissingPaymentAccountForTransactionError,
  NoReversibleTransactionError,
  reverseLatestTransactionForBusiness,
  type TransactionType,
  UnsafeReversalError,
} from "../transactions/transaction.service.js";
import { appendChatMessage } from "./chat-message.service.js";

export interface ParseChatMessageInput {
  businessId: string;
  userId: string;
  message: string;
}

export interface ClarifyChatMessageInput {
  businessId: string;
  userId: string;
  clarificationId: string;
  answer: string;
}

export type ChatParseResponse =
  | {
      status: "requires_confirmation";
      confirmationRequestId: string;
      proposedAction?: ProposedAction;
      proposedNeracaReport?: NeracaSnapshotData;
      confirmation: ReturnType<typeof toConfirmationResponse>;
    }
  | {
      status: "saved_fast";
      transactionId: string;
      message: string;
      proposedAction: ProposedAction;
      captureMode: "auto_fast";
    }
  | {
      status: "requires_clarification";
      clarificationId: string;
      question: string;
      options: Array<{ label: string; value: string }>;
      missingFields: string[];
    }
  | {
      status: "cancelled_pending_confirmation";
      message: string;
    };

const AUTO_WRITE_INTENTS = new Set<ProposedAction["intent"]>([
  "general_expense",
  "owner_capital_contribution",
  "owner_withdrawal",
]);
const AUTO_WRITE_MIN_CONFIDENCE = 0.8;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeInput(message: string): string {
  return message.trim().replace(/\s+/g, " ");
}

function formatIdr(amount: number): string {
  return `Rp${amount.toLocaleString("id-ID")}`;
}

function normalizeSearchText(value: string): string {
  return normalizeInput(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "");
}

function isCancelCommand(message: string): boolean {
  const normalized = normalizeInput(message).toLowerCase();
  return normalized === "batalkan" || normalized === "batal" || normalized === "cancel";
}

function isUndoIntentCommand(message: string): boolean {
  const normalized = normalizeInput(message).toLowerCase();
  return (
    /\b(undo|reverse|balik)\b/.test(normalized) ||
    /\b(batalkan|batalin|batal)\s+transaksi\b/.test(normalized) ||
    /\bsalah\s+catat\b/.test(normalized)
  );
}

function isNeracaIntentCommand(message: string): boolean {
  const normalized = normalizeInput(message).toLowerCase();
  return /\b(neraca|laporan\s+neraca|laporan\s+posisi)\b/.test(normalized) && /\b(buat|generate|tampilkan|lihat|cetak)\b/.test(normalized);
}

function isSalesCorrectionCommand(message: string): boolean {
  const normalized = normalizeInput(message).toLowerCase();
  return /\b(eh|bukan|jadinya|jadi|ganti|ubah|tambah|hapus|kurangin|kurangi|aja)\b/.test(normalized);
}

function isAdditiveSalesCorrectionCommand(message: string): boolean {
  return /\btambah\b/.test(normalizeInput(message).toLowerCase());
}

function isPendingConfirmationEditCommand(message: string): boolean {
  const normalized = normalizeInput(message).toLowerCase();
  return /\b(ganti|ubah|edit|revisi|koreksi|jadinya|jadi|seharusnya|harusnya|akun|tanggal|nominal|jumlah|keterangan|catatan|target|objek|dari|ke)\b/.test(
    normalized,
  );
}

function isAutoWriteIntent(intent: ProposedAction["intent"]): boolean {
  return AUTO_WRITE_INTENTS.has(intent);
}

function requiresConfirmation(parserResult: Extract<ParseIntentResult, { status: "parsed" }>): boolean {
  return parserResult.requiresConfirmationReason === "clarified_ambiguity";
}

function createLowConfidenceClarificationMessage(): string {
  return "Aku belum cukup yakin untuk simpan otomatis. Tolong tulis ulang transaksi ini lebih spesifik ya.";
}

function toAutoWriteClarification(error: unknown): { message: string; missingFields: string[] } | null {
  if (error instanceof MissingPaymentAccountForTransactionError || error instanceof InvalidPaymentAccountOwnershipError) {
    return { message: error.message, missingFields: ["paymentAccountId"] };
  }
  if (error instanceof MissingAffectedObjectError || error instanceof AmbiguousFinancialTargetError) {
    return { message: error.message, missingFields: ["affectedObject"] };
  }
  if (error instanceof FinancialTargetNotFoundError) {
    return { message: error.message, missingFields: ["dependency"] };
  }
  if (error instanceof FinancialTargetOverpaymentError) {
    return { message: error.message, missingFields: ["amount"] };
  }
  if (error instanceof InsufficientPaymentAccountBalanceError) {
    return { message: error.message, missingFields: ["amount"] };
  }
  return null;
}

async function appendAssistantResultMessage(input: { businessId: string; userId: string; message: string; extra?: Record<string, unknown> }) {
  await runFinancialWrite(async (tx) => {
    await appendChatMessage(tx, {
      businessId: input.businessId,
      userId: input.userId,
      role: "assistant",
      kind: "system_result",
      content: {
        message: input.message,
        ...(input.extra ?? {}),
      },
    });
  });
}

async function handleUndoIntent(input: ParseChatMessageInput): Promise<ChatParseResponse> {
  await runFinancialWrite(async (tx) => {
    await appendChatMessage(tx, {
      businessId: input.businessId,
      userId: input.userId,
      role: "user",
      kind: "text",
      content: {
        text: input.message,
      },
    });
  });

  try {
    const result = await reverseLatestTransactionForBusiness({
      businessId: input.businessId,
      userId: input.userId,
      reason: "Undo dari obrolan",
      transactionDate: todayIso(),
    });

    const message = "Oke, transaksi terakhir berhasil di-undo.";
    await appendAssistantResultMessage({
      businessId: input.businessId,
      userId: input.userId,
      message,
      extra: {
        originalTransactionId: result.originalTransactionId,
        reversalTransactionId: result.reversalTransactionId,
      },
    });

    return {
      status: "cancelled_pending_confirmation",
      message,
    };
  } catch (error) {
    const knownMessage =
      error instanceof NoReversibleTransactionError ||
      error instanceof UnsafeReversalError ||
      error instanceof InsufficientPaymentAccountBalanceError
        ? error.message
        : null;

    if (!knownMessage) {
      throw error;
    }

    await appendAssistantResultMessage({
      businessId: input.businessId,
      userId: input.userId,
      message: knownMessage,
    });

    return {
      status: "cancelled_pending_confirmation",
      message: knownMessage,
    };
  }
}

async function getPaymentAccountContext(businessId: string) {
  const accounts = await listPaymentAccountsByBusinessId(businessId);
  const defaultAccount = accounts.find((account) => account.isDefault) ?? accounts[0] ?? null;

  return {
    defaultPaymentAccountId: defaultAccount?.id ?? null,
    defaultPaymentAccountName: defaultAccount?.name ?? null,
    paymentAccounts: accounts.map((account) => ({
      id: account.id,
      name: account.name,
      type: account.type,
      isDefault: account.isDefault,
    })),
  };
}

function parseMenuAliases(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  }

  return [];
}

async function getParserMenuContext(businessId: string) {
  const menuItems = await listActiveMenuItemsByBusinessId(businessId);

  return menuItems.map((item) => ({
    id: item.id,
    name: item.name,
    aliases: parseMenuAliases(item.aliases),
    defaultPrice: item.defaultPrice === null ? null : Number(item.defaultPrice),
    category: item.category,
  }));
}

async function getOpenFinancialTargetContext(businessId: string) {
  const [liabilities, receivables] = await Promise.all([
    db
      .selectFrom("liabilities")
      .select(["id", "lenderName", "description", "outstandingAmount", "status"])
      .where("businessId", "=", businessId)
      .where("status", "in", ["open", "partial"])
      .execute(),
    db
      .selectFrom("receivables")
      .select(["id", "customerName", "description", "outstandingAmount", "status"])
      .where("businessId", "=", businessId)
      .where("status", "in", ["open", "partial"])
      .execute(),
  ]);

  return {
    openLiabilities: liabilities.map((item) => ({
      id: item.id,
      lenderName: item.lenderName,
      description: item.description,
      outstandingAmount: Number(item.outstandingAmount),
    })),
    openReceivables: receivables.map((item) => ({
      id: item.id,
      customerName: item.customerName,
      description: item.description,
      outstandingAmount: Number(item.outstandingAmount),
    })),
  };
}

function parsedCommandValues(input: ParseChatMessageInput, parserResult: ParseIntentResult) {
  const now = new Date();
  const structuredPayload = parserResult.structuredPayload as Record<string, unknown>;

  return {
    id: randomUUID(),
    businessId: input.businessId,
    userId: input.userId,
    rawInputText: input.message,
    normalizedInputText: normalizeInput(input.message),
    source: "text" as const,
    detectedIntent: parserResult.proposedAction?.intent ?? String(structuredPayload.detectedIntent ?? ""),
    parserModel: parserResult.parserModel,
    parserVersion: parserResult.parserVersion,
    confidence: parserResult.confidence.toString(),
    structuredPayload: JSON.stringify(parserResult.structuredPayload),
    missingFields: JSON.stringify(parserResult.missingFields),
    validationErrors: JSON.stringify(parserResult.validationErrors),
    status: parserResult.status,
    createdAt: now,
    updatedAt: now,
  };
}

function neracaParsedCommandValues(input: ParseChatMessageInput, reportDate: string, preview: NeracaSnapshotData) {
  const now = new Date();
  return {
    id: randomUUID(),
    businessId: input.businessId,
    userId: input.userId,
    rawInputText: input.message,
    normalizedInputText: normalizeInput(input.message),
    source: "text" as const,
    detectedIntent: "generate_neraca",
    parserModel: "deterministic-system",
    parserVersion: "neraca-command-v1",
    confidence: "1",
    structuredPayload: JSON.stringify({
      detectedIntent: "generate_neraca",
      reportDate,
      preview,
    }),
    missingFields: JSON.stringify([]),
    validationErrors: JSON.stringify([]),
    status: "parsed" as const,
    createdAt: now,
    updatedAt: now,
  };
}

function salesCorrectionParsedCommandValues(input: ParseChatMessageInput, proposedAction: ProposedAction) {
  const now = new Date();
  return {
    id: randomUUID(),
    businessId: input.businessId,
    userId: input.userId,
    rawInputText: input.message,
    normalizedInputText: normalizeInput(input.message),
    source: "text" as const,
    detectedIntent: "sales_order_update",
    parserModel: "deterministic-system",
    parserVersion: "pos-sales-correction-v1",
    confidence: "1",
    structuredPayload: JSON.stringify(proposedAction),
    missingFields: JSON.stringify([]),
    validationErrors: JSON.stringify([]),
    status: "parsed" as const,
    createdAt: now,
    updatedAt: now,
  };
}

function findCorrectionQuantity(message: string): number | null {
  const match = normalizeInput(message).match(/\b(\d+)\b/);
  if (!match) return null;
  const quantity = Number(match[1]);
  return Number.isInteger(quantity) && quantity > 0 ? quantity : null;
}

function lineMatchesCorrection(message: string, line: NonNullable<ProposedAction["salesOrder"]>["lines"][number]): boolean {
  const normalized = normalizeInput(message).toLowerCase();
  const candidates = [line.productName, line.spokenLabel, ...line.productName.split(/\s+/)].map((value) => value.trim().toLowerCase()).filter(Boolean);
  return candidates.some((candidate) => normalized.includes(candidate));
}

function menuItemMatchesCorrection(message: string, menuItem: Awaited<ReturnType<typeof getParserMenuContext>>[number]): boolean {
  const normalized = normalizeInput(message).toLowerCase();
  const candidates = [menuItem.name, ...menuItem.aliases].map((value) => value.trim().toLowerCase()).filter(Boolean);
  return candidates.some((candidate) => normalized.includes(candidate));
}

function describeSalesOrder(lines: NonNullable<ProposedAction["salesOrder"]>["lines"]): string {
  return `Jual ${lines.map((line) => `${line.quantity} ${line.productName}`).join(", ")}`;
}

function rebuildSalesOrderAction(baseAction: ProposedAction, lines: NonNullable<ProposedAction["salesOrder"]>["lines"]): ProposedAction {
  const amount = lines.reduce((sum, line) => sum + line.subtotal, 0);
  const accountName = baseAction.paymentAccountName ?? "Kas";
  return {
    ...baseAction,
    amount,
    description: describeSalesOrder(lines),
    affectedObject: lines.map((line) => line.productName).join(", "),
    expectedEffects: [`${accountName} bertambah ${formatIdr(amount)}`, `Pendapatan bertambah ${formatIdr(amount)}`],
    warning: "Perubahan dari input teks/suara. Periksa lagi sebelum disimpan.",
    salesOrder: {
      status: "draft",
      totalAmount: amount,
      lines,
    },
  };
}

async function getLatestPendingTransactionAction(input: ParseChatMessageInput): Promise<{
  confirmationId: string;
  parsedCommandId: string | null;
  action: ProposedAction;
} | null> {
  const pending = await listPendingIntentConfirmations({
    businessId: input.businessId,
    userId: input.userId,
    limit: 5,
  });

  for (const confirmation of pending) {
    if (confirmation.type !== "transaction") continue;
    const action = parseProposedActionJson(confirmation.proposedActionJson);
    return {
      confirmationId: confirmation.id,
      parsedCommandId: confirmation.parsedCommandId,
      action,
    };
  }

  return null;
}

async function getPendingSalesOrderAction(input: ParseChatMessageInput): Promise<ProposedAction | null> {
  const pending = await getLatestPendingTransactionAction(input);
  return pending?.action.intent === "sales_income" && pending.action.salesOrder?.lines.length ? pending.action : null;
}

async function tryHandleSalesCorrection(input: ParseChatMessageInput): Promise<ChatParseResponse | null> {
  if (!isSalesCorrectionCommand(input.message)) return null;

  const pendingAction = await getPendingSalesOrderAction(input);
  if (!pendingAction?.salesOrder) return null;

  const quantity = findCorrectionQuantity(input.message);
  if (quantity === null) return null;

  const matchedLine = pendingAction.salesOrder.lines.find((line) => lineMatchesCorrection(input.message, line));
  const isAdditive = isAdditiveSalesCorrectionCommand(input.message);
  let updatedLines: NonNullable<ProposedAction["salesOrder"]>["lines"] | null = null;

  if (matchedLine) {
    updatedLines = pendingAction.salesOrder.lines.map((line) => {
      if (line.productId !== matchedLine.productId) return line;

      const nextQuantity = isAdditive ? line.quantity + quantity : quantity;
      return {
        ...line,
        quantity: nextQuantity,
        subtotal: nextQuantity * line.unitPrice,
      };
    });
  } else if (isAdditive) {
    const menuItems = await getParserMenuContext(input.businessId);
    const matches = menuItems.filter((menuItem) => menuItemMatchesCorrection(input.message, menuItem));
    if (matches.length !== 1) return null;

    const [menuItem] = matches;
    if (menuItem.defaultPrice === null) return null;

    updatedLines = [
      ...pendingAction.salesOrder.lines,
      {
        productId: menuItem.id,
        productName: menuItem.name,
        spokenLabel: menuItem.name.toLowerCase(),
        quantity,
        unitPrice: menuItem.defaultPrice,
        subtotal: quantity * menuItem.defaultPrice,
        matchStatus: "matched",
      },
    ];
  }

  if (!updatedLines) return null;

  const proposedAction = rebuildSalesOrderAction(pendingAction, updatedLines);

  return runFinancialWrite(async (tx) => {
    await appendChatMessage(tx, {
      businessId: input.businessId,
      userId: input.userId,
      role: "user",
      kind: "text",
      content: {
        text: input.message,
      },
    });

    const parsedCommand = await tx
      .insertInto("parsed_commands")
      .values(salesCorrectionParsedCommandValues(input, proposedAction))
      .returningAll()
      .executeTakeFirstOrThrow();

    const confirmation = await createConfirmationRequest(tx, {
      businessId: input.businessId,
      userId: input.userId,
      parsedCommandId: parsedCommand.id,
      proposedAction,
    });

    await appendChatMessage(tx, {
      businessId: input.businessId,
      userId: input.userId,
      role: "assistant",
      kind: "confirmation_card",
      parsedCommandId: parsedCommand.id,
      confirmationRequestId: confirmation.id,
      content: {
        status: "requires_confirmation",
        confirmationRequestId: confirmation.id,
        proposedAction,
        confirmation: toConfirmationResponse(confirmation),
      },
    });

    return {
      status: "requires_confirmation",
      confirmationRequestId: confirmation.id,
      proposedAction,
      confirmation: toConfirmationResponse(confirmation),
    };
  });
}

function findPaymentAccountInMessage(message: string, accounts: Awaited<ReturnType<typeof getPaymentAccountContext>>["paymentAccounts"]) {
  const normalized = normalizeSearchText(message);
  const matches = accounts.filter((account) => {
    const normalizedName = normalizeSearchText(account.name);
    const normalizedId = normalizeSearchText(account.id);
    return normalizedName && (normalized.includes(normalizedName) || normalized.includes(normalizedId));
  });

  return matches.length === 1 ? matches[0] : null;
}

function parseAmountEdit(message: string): number | null {
  const normalized = normalizeInput(message).toLowerCase().replace(/rp\s*/g, "");
  const match = normalized.match(/(\d+(?:[.,]\d+)?)\s*(ribu|rb|juta|jt)?/);
  if (!match) return null;

  const numberValue = Number(match[1].replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(numberValue) || numberValue <= 0) return null;

  const unit = match[2] ?? "";
  if (unit === "juta" || unit === "jt") return Math.round(numberValue * 1_000_000);
  if (unit === "ribu" || unit === "rb") return Math.round(numberValue * 1_000);
  return Math.round(numberValue);
}

function parseDateEdit(message: string): string | null {
  const normalized = normalizeInput(message).toLowerCase();
  const isoMatch = normalized.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) return isoMatch[1];

  const monthNumbers: Record<string, string> = {
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

  const day = match[1].padStart(2, "0");
  return `${match[3]}-${monthNumbers[match[2]]}-${day}`;
}

function extractTextEdit(message: string, fieldPattern: RegExp): string | null {
  const match = message.match(fieldPattern);
  const value = match?.[1]?.trim();
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : null;
}

function rebuildExpectedEffects(action: ProposedAction): string[] {
  const amount = formatIdr(action.amount);
  const accountName = action.paymentAccountName ?? "Kas";
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
      return action.paymentAccountId
        ? [`${accountName} bertambah ${amount}`, `Utang ${action.affectedObject ?? ""}`.trim() + ` bertambah ${amount}`]
        : [`Utang ${action.affectedObject ?? ""}`.trim() + ` bertambah ${amount}`];
    case "liability_payment":
      return [`${accountName} berkurang ${amount}`, `Utang ${action.affectedObject ?? ""}`.trim() + ` berkurang ${amount}`];
    case "receivable_created":
      return [`Piutang ${action.affectedObject ?? ""}`.trim() + ` bertambah ${amount}`, `Pendapatan bertambah ${amount}`];
    case "receivable_payment":
      return [`${accountName} bertambah ${amount}`, `Piutang ${action.affectedObject ?? ""}`.trim() + ` berkurang ${amount}`];
    case "owner_withdrawal":
      return [`${accountName} berkurang ${amount}`, `Prive bertambah ${amount}`];
    case "account_transfer":
      return [`${accountName} berkurang ${amount}`, `${action.destinationPaymentAccountName ?? "Akun tujuan"} bertambah ${amount}`];
    case "reversal":
      return [`Pembalikan transaksi sebesar ${amount}`];
    case "general_expense":
    default:
      return [`${accountName} berkurang ${amount}`, `Biaya bertambah ${amount}`];
  }
}

async function tryHandlePendingConfirmationEdit(input: ParseChatMessageInput): Promise<ChatParseResponse | null> {
  if (!isPendingConfirmationEditCommand(input.message)) return null;

  const pending = await getLatestPendingTransactionAction(input);
  if (!pending) return null;

  const accountContext = await getPaymentAccountContext(input.businessId);
  const matchedAccount = findPaymentAccountInMessage(input.message, accountContext.paymentAccounts);
  const amount = parseAmountEdit(input.message);
  const date = parseDateEdit(input.message);
  const description = extractTextEdit(input.message, /\b(?:keterangan|catatan|deskripsi)(?:nya)?\s*(?:jadi|ke|:)?\s+(.+)$/i);
  const affectedObject = extractTextEdit(
    input.message,
    /\b(?:target|objek|persediaan|stok|aset|utang|piutang|pelanggan|menu)(?:nya)?\s*(?:jadi|ke|:)?\s+(.+)$/i,
  );

  let proposedAction: ProposedAction = {
    ...pending.action,
    ...(amount ? { amount } : {}),
    ...(date ? { date } : {}),
    ...(description ? { description } : {}),
    ...(affectedObject ? { affectedObject } : {}),
  };

  if (matchedAccount) {
    const normalized = normalizeInput(input.message).toLowerCase();
    const editsDestination = proposedAction.intent === "account_transfer" && /\b(ke|tujuan)\b/.test(normalized) && !/\b(dari|asal)\b/.test(normalized);
    proposedAction = editsDestination
      ? {
          ...proposedAction,
          destinationPaymentAccountId: matchedAccount.id,
          destinationPaymentAccountName: matchedAccount.name,
        }
      : {
          ...proposedAction,
          paymentAccountId: matchedAccount.id,
          paymentAccountName: matchedAccount.name,
        };
  }

  if (proposedAction === pending.action) return null;
  if (
    proposedAction.amount === pending.action.amount &&
    proposedAction.date === pending.action.date &&
    proposedAction.paymentAccountId === pending.action.paymentAccountId &&
    proposedAction.destinationPaymentAccountId === pending.action.destinationPaymentAccountId &&
    proposedAction.description === pending.action.description &&
    proposedAction.affectedObject === pending.action.affectedObject
  ) {
    return null;
  }

  proposedAction = {
    ...proposedAction,
    expectedEffects: rebuildExpectedEffects(proposedAction),
    warning: "Perubahan dari input teks/suara. Periksa lagi sebelum disimpan.",
  };

  return runFinancialWrite(async (tx) => {
    await appendChatMessage(tx, {
      businessId: input.businessId,
      userId: input.userId,
      role: "user",
      kind: "text",
      content: {
        text: input.message,
      },
    });

    const parsedCommand = await tx
      .insertInto("parsed_commands")
      .values(salesCorrectionParsedCommandValues(input, proposedAction))
      .returningAll()
      .executeTakeFirstOrThrow();

    const confirmation = await createConfirmationRequest(tx, {
      businessId: input.businessId,
      userId: input.userId,
      parsedCommandId: parsedCommand.id,
      proposedAction,
    });

    await appendChatMessage(tx, {
      businessId: input.businessId,
      userId: input.userId,
      role: "assistant",
      kind: "confirmation_card",
      parsedCommandId: parsedCommand.id,
      confirmationRequestId: confirmation.id,
      content: {
        status: "requires_confirmation",
        confirmationRequestId: confirmation.id,
        proposedAction,
        confirmation: toConfirmationResponse(confirmation),
      },
    });

    return {
      status: "requires_confirmation",
      confirmationRequestId: confirmation.id,
      proposedAction,
      confirmation: toConfirmationResponse(confirmation),
    };
  });
}

async function handleNeracaIntent(input: ParseChatMessageInput): Promise<ChatParseResponse> {
  const reportDate = todayIso();
  const preview = await previewNeraca({
    businessId: input.businessId,
    userId: input.userId,
    reportDate,
  });

  return runFinancialWrite(async (tx) => {
    await appendChatMessage(tx, {
      businessId: input.businessId,
      userId: input.userId,
      role: "user",
      kind: "text",
      content: {
        text: input.message,
      },
    });

    const parsedCommand = await tx
      .insertInto("parsed_commands")
      .values(neracaParsedCommandValues(input, reportDate, preview))
      .returningAll()
      .executeTakeFirstOrThrow();

    const confirmation = await createNeracaConfirmationRequest(tx, {
      businessId: input.businessId,
      userId: input.userId,
      parsedCommandId: parsedCommand.id,
      reportDate,
      preview,
    });

    await appendChatMessage(tx, {
      businessId: input.businessId,
      userId: input.userId,
      role: "assistant",
      kind: "confirmation_card",
      parsedCommandId: parsedCommand.id,
      confirmationRequestId: confirmation.id,
      content: {
        status: "requires_confirmation",
        confirmationRequestId: confirmation.id,
        proposedNeracaReport: preview,
        confirmation: toConfirmationResponse(confirmation),
      },
    });

    return {
      status: "requires_confirmation",
      confirmationRequestId: confirmation.id,
      proposedNeracaReport: preview,
      confirmation: toConfirmationResponse(confirmation),
    };
  });
}

async function createParserInput(
  input: ParseChatMessageInput,
  clarification?: ParseIntentInput["clarification"],
): Promise<ParseIntentInput> {
  const [accountContext, menuItems, targetContext] = await Promise.all([
    getPaymentAccountContext(input.businessId),
    getParserMenuContext(input.businessId),
    getOpenFinancialTargetContext(input.businessId),
  ]);

  return {
    ...input,
    ...accountContext,
    menuItems,
    ...targetContext,
    today: todayIso(),
    clarification,
  };
}

async function createClarificationResult(input: {
  tx: FinancialWriteTx;
  businessId: string;
  userId: string;
  parsedCommandId: string;
  detectedIntent: string;
  structuredPayload: Record<string, unknown>;
  question: string;
  missingFields: string[];
}): Promise<Extract<ChatParseResponse, { status: "requires_clarification" }>> {
  await input.tx
    .updateTable("parsed_commands")
    .set({
      detectedIntent: input.detectedIntent,
      status: "needs_clarification",
      structuredPayload: JSON.stringify(input.structuredPayload),
      missingFields: JSON.stringify(input.missingFields),
      validationErrors: JSON.stringify([]),
      updatedAt: new Date(),
    })
    .where("id", "=", input.parsedCommandId)
    .executeTakeFirst();

  await appendChatMessage(input.tx, {
    businessId: input.businessId,
    userId: input.userId,
    role: "assistant",
    kind: "clarification",
    parsedCommandId: input.parsedCommandId,
    content: {
      status: "requires_clarification",
      clarificationId: input.parsedCommandId,
      question: input.question,
      options: [],
      missingFields: input.missingFields,
    },
  });

  return {
    status: "requires_clarification",
    clarificationId: input.parsedCommandId,
    question: input.question,
    options: [],
    missingFields: input.missingFields,
  };
}

async function autoSaveParsedAction(input: {
  tx: FinancialWriteTx;
  businessId: string;
  userId: string;
  parsedCommandId: string;
  proposedAction: ProposedAction;
}): Promise<ChatParseResponse> {
  let transaction;
  try {
    transaction = await createBaseTransactionInTransaction(input.tx, {
      businessId: input.businessId,
      createdBy: input.userId,
      type: input.proposedAction.intent as TransactionType,
      amount: input.proposedAction.amount,
      transactionDate: input.proposedAction.date,
      description: input.proposedAction.description,
      affectedObject: input.proposedAction.affectedObject,
      paymentAccountId: input.proposedAction.paymentAccountId,
      parsedCommandId: input.parsedCommandId,
      confirmationRequestId: null,
    });
  } catch (error) {
    const clarification = toAutoWriteClarification(error);
    if (!clarification) throw error;
    return createClarificationResult({
      tx: input.tx,
      businessId: input.businessId,
      userId: input.userId,
      parsedCommandId: input.parsedCommandId,
      detectedIntent: input.proposedAction.intent,
      structuredPayload: input.proposedAction as unknown as Record<string, unknown>,
      question: clarification.message,
      missingFields: clarification.missingFields,
    });
  }

  const message = "Transaksi langsung disimpan. Kalau ada yang kurang tepat, bisa pakai Undo.";
  await appendChatMessage(input.tx, {
    businessId: input.businessId,
    userId: input.userId,
    role: "assistant",
    kind: "system_result",
    parsedCommandId: input.parsedCommandId,
    transactionId: transaction.id,
    content: {
      status: "saved_fast",
      transactionId: transaction.id,
      captureMode: "auto_fast",
      message,
      proposedAction: input.proposedAction,
    },
  });

  return {
    status: "saved_fast",
    transactionId: transaction.id,
    message,
    proposedAction: input.proposedAction,
    captureMode: "auto_fast",
  };
}

export async function parseChatMessage(input: ParseChatMessageInput): Promise<ChatParseResponse> {
  if (isCancelCommand(input.message)) {
    return runFinancialWrite(async (tx) => {
      await appendChatMessage(tx, {
        businessId: input.businessId,
        userId: input.userId,
        role: "user",
        kind: "text",
        content: {
          text: input.message,
        },
      });

      const cancelledCount = await cancelPendingConfirmationsInTransaction(tx, {
        businessId: input.businessId,
        userId: input.userId,
      });
      const message =
        cancelledCount > 0 ? "Oke, konfirmasi yang masih pending sudah dibatalkan." : "Tidak ada konfirmasi pending.";

      await appendChatMessage(tx, {
        businessId: input.businessId,
        userId: input.userId,
        role: "assistant",
        kind: "system_result",
        content: {
          message,
          cancelledCount,
        },
      });

      return {
        status: "cancelled_pending_confirmation",
        message,
      };
    });
  }

  if (isUndoIntentCommand(input.message)) {
    return handleUndoIntent(input);
  }

  if (isNeracaIntentCommand(input.message)) {
    return handleNeracaIntent(input);
  }

  const salesCorrectionResult = await tryHandleSalesCorrection(input);
  if (salesCorrectionResult) return salesCorrectionResult;

  const pendingConfirmationEditResult = await tryHandlePendingConfirmationEdit(input);
  if (pendingConfirmationEditResult) return pendingConfirmationEditResult;

  const parserInput = await createParserInput(input);
  const parserResult = createInventoryOrExpenseClarification(parserInput) ?? (await parserEngine.parse(parserInput));

  return runFinancialWrite(async (tx) => {
    await appendChatMessage(tx, {
      businessId: input.businessId,
      userId: input.userId,
      role: "user",
      kind: "text",
      content: {
        text: input.message,
      },
    });

    const parsedCommand = await tx
      .insertInto("parsed_commands")
      .values(parsedCommandValues(input, parserResult))
      .returningAll()
      .executeTakeFirstOrThrow();

    if (parserResult.status === "needs_clarification") {
      await appendChatMessage(tx, {
        businessId: input.businessId,
        userId: input.userId,
        role: "assistant",
        kind: "clarification",
        parsedCommandId: parsedCommand.id,
        content: {
          status: "requires_clarification",
          clarificationId: parsedCommand.id,
          question: parserResult.question,
          options: parserResult.options,
          missingFields: parserResult.missingFields,
        },
      });

      return {
        status: "requires_clarification",
        clarificationId: parsedCommand.id,
        question: parserResult.question,
        options: parserResult.options,
        missingFields: parserResult.missingFields,
      };
    }

    if (!requiresConfirmation(parserResult) && isAutoWriteIntent(parserResult.proposedAction.intent) && parserResult.confidence < AUTO_WRITE_MIN_CONFIDENCE) {
      return createClarificationResult({
        tx,
        businessId: input.businessId,
        userId: input.userId,
        parsedCommandId: parsedCommand.id,
        detectedIntent: parserResult.proposedAction.intent,
        structuredPayload: parserResult.proposedAction as unknown as Record<string, unknown>,
        question: createLowConfidenceClarificationMessage(),
        missingFields: ["confidence"],
      });
    }

    if (!requiresConfirmation(parserResult) && isAutoWriteIntent(parserResult.proposedAction.intent)) {
      return autoSaveParsedAction({
        tx,
        businessId: input.businessId,
        userId: input.userId,
        parsedCommandId: parsedCommand.id,
        proposedAction: parserResult.proposedAction,
      });
    }

    const confirmation = await createConfirmationRequest(tx, {
      businessId: input.businessId,
      userId: input.userId,
      parsedCommandId: parsedCommand.id,
      proposedAction: parserResult.proposedAction,
    });

    await appendChatMessage(tx, {
      businessId: input.businessId,
      userId: input.userId,
      role: "assistant",
      kind: "confirmation_card",
      parsedCommandId: parsedCommand.id,
      confirmationRequestId: confirmation.id,
      content: {
        status: "requires_confirmation",
        confirmationRequestId: confirmation.id,
        proposedAction: parserResult.proposedAction,
        confirmation: toConfirmationResponse(confirmation),
      },
    });

    return {
      status: "requires_confirmation",
      confirmationRequestId: confirmation.id,
      proposedAction: parserResult.proposedAction,
      confirmation: toConfirmationResponse(confirmation),
    };
  });
}

function readStructuredPayload(command: ParsedCommandRow): Record<string, unknown> {
  if (command.structuredPayload && typeof command.structuredPayload === "object") {
    return command.structuredPayload as Record<string, unknown>;
  }

  if (typeof command.structuredPayload === "string") {
    try {
      const parsed = JSON.parse(command.structuredPayload);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  return {};
}

export async function clarifyChatMessage(input: ClarifyChatMessageInput): Promise<ChatParseResponse> {
  const command = await db
    .selectFrom("parsed_commands")
    .selectAll()
    .where("id", "=", input.clarificationId)
    .where("businessId", "=", input.businessId)
    .where("userId", "=", input.userId)
    .executeTakeFirst();

  if (!command) {
    throw new Error("Clarification request not found.");
  }

  const payload = readStructuredPayload(command);
  const parserInput = await createParserInput(
    {
      businessId: input.businessId,
      userId: input.userId,
      message: command.rawInputText,
    },
    {
      originalMessage: command.rawInputText,
      previousPayload: payload,
      answer: input.answer,
    },
  );
  const parserResult = resolveInventoryOrExpenseClarification(parserInput) ?? (await parserEngine.parse(parserInput));

  return runFinancialWrite(async (tx) => {
    await appendChatMessage(tx, {
      businessId: input.businessId,
      userId: input.userId,
      role: "user",
      kind: "text",
      parsedCommandId: command.id,
      content: {
        text: `Jawaban klarifikasi: ${input.answer}`,
      },
    });

    if (parserResult.status === "needs_clarification") {
      await tx
        .updateTable("parsed_commands")
        .set({
          detectedIntent: String(parserResult.structuredPayload.detectedIntent ?? command.detectedIntent ?? ""),
          status: "needs_clarification",
          structuredPayload: JSON.stringify(parserResult.structuredPayload),
          missingFields: JSON.stringify(parserResult.missingFields),
          validationErrors: JSON.stringify(parserResult.validationErrors),
          updatedAt: new Date(),
        })
        .where("id", "=", command.id)
        .executeTakeFirst();

      await appendChatMessage(tx, {
        businessId: input.businessId,
        userId: input.userId,
        role: "assistant",
        kind: "clarification",
        parsedCommandId: command.id,
        content: {
          status: "requires_clarification",
          clarificationId: command.id,
          question: parserResult.question,
          options: parserResult.options,
          missingFields: parserResult.missingFields,
        },
      });

      return {
        status: "requires_clarification",
        clarificationId: command.id,
        question: parserResult.question,
        options: parserResult.options,
        missingFields: parserResult.missingFields,
      };
    }

    if (!requiresConfirmation(parserResult) && isAutoWriteIntent(parserResult.proposedAction.intent) && parserResult.confidence < AUTO_WRITE_MIN_CONFIDENCE) {
      return createClarificationResult({
        tx,
        businessId: input.businessId,
        userId: input.userId,
        parsedCommandId: command.id,
        detectedIntent: parserResult.proposedAction.intent,
        structuredPayload: parserResult.proposedAction as unknown as Record<string, unknown>,
        question: createLowConfidenceClarificationMessage(),
        missingFields: ["confidence"],
      });
    }

    await tx
      .updateTable("parsed_commands")
      .set({
        detectedIntent: parserResult.proposedAction.intent,
        status: "parsed",
        structuredPayload: JSON.stringify(parserResult.proposedAction),
        missingFields: JSON.stringify([]),
        validationErrors: JSON.stringify([]),
        updatedAt: new Date(),
      })
      .where("id", "=", command.id)
      .executeTakeFirst();

    if (!requiresConfirmation(parserResult) && isAutoWriteIntent(parserResult.proposedAction.intent)) {
      return autoSaveParsedAction({
        tx,
        businessId: input.businessId,
        userId: input.userId,
        parsedCommandId: command.id,
        proposedAction: parserResult.proposedAction,
      });
    }

    const confirmation = await createConfirmationRequest(tx, {
      businessId: input.businessId,
      userId: input.userId,
      parsedCommandId: command.id,
      proposedAction: parserResult.proposedAction,
    });

    await appendChatMessage(tx, {
      businessId: input.businessId,
      userId: input.userId,
      role: "assistant",
      kind: "confirmation_card",
      parsedCommandId: command.id,
      confirmationRequestId: confirmation.id,
      content: {
        status: "requires_confirmation",
        confirmationRequestId: confirmation.id,
        proposedAction: parserResult.proposedAction,
        confirmation: toConfirmationResponse(confirmation),
      },
    });

    return {
      status: "requires_confirmation",
      confirmationRequestId: confirmation.id,
      proposedAction: parserResult.proposedAction,
      confirmation: toConfirmationResponse(confirmation),
    };
  });
}

import { randomUUID } from "node:crypto";
import { db, type ParsedCommandRow } from "../../lib/database.js";
import { runFinancialWrite, type FinancialWriteTx } from "../../lib/financial-write.js";
import {
  cancelPendingConfirmationsInTransaction,
  createConfirmationRequest,
  createNeracaConfirmationRequest,
  toConfirmationResponse,
} from "../confirmations/confirmation.service.js";
import { previewNeraca, type NeracaSnapshotData } from "../neraca/neraca.service.js";
import { listActiveMenuItemsByBusinessId } from "../menu-items/menu-item.service.js";
import { listPaymentAccountsByBusinessId } from "../payment-accounts/payment-account.service.js";
import { parserEngine } from "../parser/parser-engine.service.js";
import type { ParseIntentInput, ParseIntentResult, ProposedAction } from "../parser/parser.types.js";
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
  "sales_income",
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

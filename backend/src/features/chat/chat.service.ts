import { randomUUID } from "node:crypto";
import { db, type ParsedCommandRow } from "../../lib/database.js";
import { runFinancialWrite } from "../../lib/financial-write.js";
import { listActiveMenuItemsByBusinessId } from "../menu-items/menu-item.service.js";
import { listPaymentAccountsByBusinessId } from "../payment-accounts/payment-account.service.js";
import { parserEngine } from "../parser/parser-engine.service.js";
import type { ParseIntentInput, ParseIntentResult, ProposedAction } from "../parser/parser.types.js";
import {
  cancelPendingConfirmationsInTransaction,
  createConfirmationRequest,
  toConfirmationResponse,
} from "../confirmations/confirmation.service.js";
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
      proposedAction: ProposedAction;
      confirmation: ReturnType<typeof toConfirmationResponse>;
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

async function createParserInput(
  input: ParseChatMessageInput,
  clarification?: ParseIntentInput["clarification"],
): Promise<ParseIntentInput> {
  const [accountContext, menuItems] = await Promise.all([
    getPaymentAccountContext(input.businessId),
    getParserMenuContext(input.businessId),
  ]);

  return {
    ...input,
    ...accountContext,
    menuItems,
    today: todayIso(),
    clarification,
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

  const parserResult = await parserEngine.parse(await createParserInput(input));

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
  const parserResult = await parserEngine.parse(
    await createParserInput(
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
    ),
  );

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

    const confirmation = await createConfirmationRequest(tx, {
      businessId: input.businessId,
      userId: input.userId,
      parsedCommandId: command.id,
      proposedAction: parserResult.proposedAction,
    });

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

import { randomUUID } from "node:crypto";
import { db, type ParsedCommandRow } from "../../lib/database.js";
import { runFinancialWrite } from "../../lib/financial-write.js";
import { listPaymentAccountsByBusinessId } from "../payment-accounts/payment-account.service.js";
import {
  createDeterministicProposedAction,
  deterministicIntentParser,
} from "../parser/deterministic-parser.service.js";
import type { ProposedAction } from "../parser/parser.types.js";
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

async function getDefaultPaymentAccountContext(businessId: string) {
  const accounts = await listPaymentAccountsByBusinessId(businessId);
  const defaultAccount = accounts.find((account) => account.isDefault) ?? accounts[0] ?? null;

  return {
    defaultPaymentAccountId: defaultAccount?.id ?? null,
    defaultPaymentAccountName: defaultAccount?.name ?? null,
  };
}

function parsedCommandValues(input: ParseChatMessageInput, parserResult: Awaited<ReturnType<typeof deterministicIntentParser.parse>>) {
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

  const accountContext = await getDefaultPaymentAccountContext(input.businessId);
  const parserResult = await deterministicIntentParser.parse({
    ...input,
    ...accountContext,
    today: todayIso(),
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
  return command.structuredPayload && typeof command.structuredPayload === "object"
    ? (command.structuredPayload as Record<string, unknown>)
    : {};
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

  if (input.answer !== "inventory_purchase_value" && input.answer !== "general_expense") {
    throw new Error("Clarification answer is not supported.");
  }

  const payload = readStructuredPayload(command);
  const amount = typeof payload.amount === "number" ? payload.amount : null;

  if (!amount) {
    throw new Error("Clarification is missing amount.");
  }

  const accountContext = await getDefaultPaymentAccountContext(input.businessId);
  const proposedAction = createDeterministicProposedAction(
    {
      businessId: input.businessId,
      userId: input.userId,
      message: command.rawInputText,
      today: todayIso(),
      ...accountContext,
    },
    input.answer,
    amount,
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

    const confirmation = await createConfirmationRequest(tx, {
      businessId: input.businessId,
      userId: input.userId,
      parsedCommandId: command.id,
      proposedAction,
    });

    await tx
      .updateTable("parsed_commands")
      .set({
        detectedIntent: input.answer,
        status: "parsed",
        structuredPayload: JSON.stringify(proposedAction),
        missingFields: JSON.stringify([]),
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

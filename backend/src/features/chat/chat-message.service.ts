import { randomUUID } from "node:crypto";
import { db, type ChatMessageRow } from "../../lib/database.js";
import type { FinancialWriteTx } from "../../lib/financial-write.js";

export interface ChatMessageContent {
  [key: string]: unknown;
}

export interface AppendChatMessageInput {
  businessId: string;
  userId: string;
  role: "user" | "assistant";
  kind: "text" | "clarification" | "confirmation_card" | "system_result";
  content: ChatMessageContent;
  parsedCommandId?: string | null;
  confirmationRequestId?: string | null;
  transactionId?: string | null;
}

interface ResolveChatSessionInput {
  businessId: string;
  userId: string;
}

async function resolveActiveSessionId(
  tx: FinancialWriteTx,
  input: ResolveChatSessionInput,
): Promise<string> {
  const active = await tx
    .selectFrom("chat_sessions")
    .select(["id"])
    .where("businessId", "=", input.businessId)
    .where("userId", "=", input.userId)
    .where("status", "=", "active")
    .orderBy("updatedAt", "desc")
    .executeTakeFirst();

  if (active) {
    await tx
      .updateTable("chat_sessions")
      .set({
        updatedAt: new Date(),
      })
      .where("id", "=", active.id)
      .executeTakeFirst();
    return active.id;
  }

  const created = await tx
    .insertInto("chat_sessions")
    .values({
      id: randomUUID(),
      businessId: input.businessId,
      userId: input.userId,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  return created.id;
}

export async function appendChatMessage(
  tx: FinancialWriteTx,
  input: AppendChatMessageInput,
): Promise<ChatMessageRow> {
  const sessionId = await resolveActiveSessionId(tx, {
    businessId: input.businessId,
    userId: input.userId,
  });

  return tx
    .insertInto("chat_messages")
    .values({
      id: randomUUID(),
      sessionId,
      businessId: input.businessId,
      userId: input.userId,
      role: input.role,
      kind: input.kind,
      contentJson: JSON.stringify(input.content),
      parsedCommandId: input.parsedCommandId ?? null,
      confirmationRequestId: input.confirmationRequestId ?? null,
      transactionId: input.transactionId ?? null,
      createdAt: new Date(),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function listChatMessagesForBusinessUser(input: {
  businessId: string;
  userId: string;
  limit?: number;
}): Promise<ChatMessageRow[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 100, 200));

  return db
    .selectFrom("chat_messages")
    .selectAll()
    .where("businessId", "=", input.businessId)
    .where("userId", "=", input.userId)
    .orderBy("createdAt", "asc")
    .limit(limit)
    .execute();
}

export function toChatMessageResponse(message: ChatMessageRow) {
  return {
    id: message.id,
    sessionId: message.sessionId,
    role: message.role,
    kind: message.kind,
    content: message.contentJson,
    parsedCommandId: message.parsedCommandId,
    confirmationRequestId: message.confirmationRequestId,
    transactionId: message.transactionId,
    createdAt: message.createdAt,
  };
}


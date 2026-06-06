import { db } from "../../lib/database.js";
import {
  extractAffectedObject,
  parseJsonObject,
  parseJsonStringArray,
  toPaymentAccountDto,
  toTransactionHistoryStatus,
} from "./transaction-dto.mapper.js";
import { toNumber, type TransactionType } from "./transaction-types.js";

export interface TransactionHistoryItem {
  id: string;
  type: TransactionType;
  amount: number;
  date: string;
  description: string;
  status: "confirmed" | "reversed" | "reversal";
  isReversed: boolean;
  cashDirection: "in" | "out" | "neutral";
  affectedObject: string | null;
  paymentAccount: {
    id: string;
    name: string;
  } | null;
  captureMode: "auto_fast" | "confirmed_flow";
  createdAt: Date;
}

export interface TransactionHistoryResult {
  items: TransactionHistoryItem[];
  page: number;
  limit: number;
  total: number;
}

export interface ListTransactionHistoryInput {
  businessId: string;
  page: number;
  limit: number;
  type?: TransactionType;
  fromDate?: string;
  toDate?: string;
  sortBy?: "date" | "amount" | "type" | "status" | "createdAt";
  sortDirection?: "asc" | "desc";
}

export interface TransactionDetailEffect {
  targetType: string;
  effectType: string;
  direction: "increase" | "decrease";
  amount: number;
  beforeAmount: number;
  afterAmount: number;
}

export interface TransactionDetail extends TransactionHistoryItem {
  rawInputText: string | null;
  interpretedAction: Record<string, unknown> | null;
  expectedEffects: string[];
  effects: TransactionDetailEffect[];
  notes: string[];
  inventoryDecrease: {
    hasDecrease: boolean;
    amount: number;
  };
}

interface TransactionHistoryRow {
  id: string;
  type: string;
  amount: string;
  transactionDate: string;
  description: string;
  status: "confirmed" | "reversed";
  isReversal: boolean;
  createdAt: Date;
  paymentAccountId: string | null;
  paymentAccountName: string | null;
  confirmationRequestId: string | null;
  proposedActionJson: unknown;
}

export function cashDirectionFromPaymentEffects(
  effects: Array<{ direction: "increase" | "decrease"; amount: string | number }>,
): TransactionHistoryItem["cashDirection"] {
  const incoming = effects
    .filter((effect) => effect.direction === "increase")
    .reduce((sum, effect) => sum + toNumber(effect.amount), 0);
  const outgoing = effects
    .filter((effect) => effect.direction === "decrease")
    .reduce((sum, effect) => sum + toNumber(effect.amount), 0);

  if (incoming > outgoing) return "in";
  if (outgoing > incoming) return "out";
  return "neutral";
}

function toTransactionHistoryItem(
  row: TransactionHistoryRow,
  effects: Array<{ direction: "increase" | "decrease"; amount: string | number }>,
): TransactionHistoryItem {
  return {
    id: row.id,
    type: row.type as TransactionType,
    amount: toNumber(row.amount),
    date: row.transactionDate,
    description: row.description,
    status: toTransactionHistoryStatus(row.type, row.status, row.isReversal),
    isReversed: row.status === "reversed",
    cashDirection: cashDirectionFromPaymentEffects(effects),
    affectedObject: extractAffectedObject(row.proposedActionJson),
    paymentAccount: toPaymentAccountDto(row.paymentAccountId, row.paymentAccountName),
    captureMode: row.confirmationRequestId ? "confirmed_flow" : "auto_fast",
    createdAt: row.createdAt,
  };
}

export async function listTransactionHistoryByBusinessId(input: ListTransactionHistoryInput): Promise<TransactionHistoryResult> {
  const offset = (input.page - 1) * input.limit;
  const sortBy = input.sortBy ?? "date";
  const sortDirection = input.sortDirection ?? "desc";

  let baseQuery = db
    .selectFrom("transactions as tx")
    .where("tx.businessId", "=", input.businessId);

  if (input.type) {
    baseQuery = baseQuery.where("tx.type", "=", input.type);
  }
  if (input.fromDate) {
    baseQuery = baseQuery.where("tx.transactionDate", ">=", input.fromDate);
  }
  if (input.toDate) {
    baseQuery = baseQuery.where("tx.transactionDate", "<=", input.toDate);
  }

  const totalRow = await baseQuery
    .select(({ fn }) => fn.countAll<string>().as("count"))
    .executeTakeFirst();

  const rowsQuery = baseQuery
    .leftJoin("payment_accounts as pa", "pa.id", "tx.paymentAccountId")
    .leftJoin("confirmation_requests as cr", "cr.id", "tx.confirmationRequestId")
    .select([
      "tx.id",
      "tx.type",
      "tx.amount",
      "tx.transactionDate",
      "tx.description",
      "tx.status",
      "tx.isReversal",
      "tx.createdAt",
      "tx.paymentAccountId",
      "tx.confirmationRequestId",
      "pa.name as paymentAccountName",
      "cr.proposedActionJson",
    ]);

  const sortableColumns = {
    date: "tx.transactionDate",
    amount: "tx.amount",
    type: "tx.type",
    status: "tx.status",
    createdAt: "tx.createdAt",
  } as const;

  const rows = await rowsQuery
    .orderBy(sortableColumns[sortBy], sortDirection)
    .orderBy("tx.createdAt", "desc")
    .limit(input.limit)
    .offset(offset)
    .execute();

  const transactionIds = rows.map((row) => row.id);
  const effectRows = transactionIds.length
    ? await db
        .selectFrom("transaction_effects")
        .select(["transactionId", "direction", "amount"])
        .where("businessId", "=", input.businessId)
        .where("targetType", "=", "payment_account")
        .where("transactionId", "in", transactionIds)
        .execute()
    : [];
  const effectsByTransactionId = new Map<string, Array<{ direction: "increase" | "decrease"; amount: string | number }>>();

  effectRows.forEach((effect) => {
    const current = effectsByTransactionId.get(effect.transactionId) ?? [];
    current.push({ direction: effect.direction, amount: effect.amount });
    effectsByTransactionId.set(effect.transactionId, current);
  });

  return {
    items: rows.map((row) =>
      toTransactionHistoryItem(row as TransactionHistoryRow, effectsByTransactionId.get(row.id) ?? []),
    ),
    page: input.page,
    limit: input.limit,
    total: toNumber(totalRow?.count ?? 0),
  };
}

function interpretedActionFromPayloads(input: {
  proposedActionJson: unknown;
  structuredPayload: unknown;
}): Record<string, unknown> | null {
  return parseJsonObject(input.proposedActionJson) ?? parseJsonObject(input.structuredPayload);
}

export async function getTransactionDetailByBusinessId(input: {
  businessId: string;
  transactionId: string;
}): Promise<TransactionDetail | null> {
  const row = await db
    .selectFrom("transactions as tx")
    .leftJoin("payment_accounts as pa", "pa.id", "tx.paymentAccountId")
    .leftJoin("confirmation_requests as cr", "cr.id", "tx.confirmationRequestId")
    .leftJoin("parsed_commands as pc", "pc.id", "tx.parsedCommandId")
    .select([
      "tx.id",
      "tx.type",
      "tx.amount",
      "tx.transactionDate",
      "tx.description",
      "tx.status",
      "tx.isReversal",
      "tx.createdAt",
      "tx.paymentAccountId",
      "tx.confirmationRequestId",
      "pa.name as paymentAccountName",
      "cr.proposedActionJson",
      "cr.expectedEffectsJson",
      "pc.rawInputText",
      "pc.structuredPayload",
    ])
    .where("tx.businessId", "=", input.businessId)
    .where("tx.id", "=", input.transactionId)
    .executeTakeFirst();

  if (!row) return null;

  const effectRows = await db
    .selectFrom("transaction_effects")
    .select(["targetType", "effectType", "direction", "amount", "beforeAmount", "afterAmount"])
    .where("businessId", "=", input.businessId)
    .where("transactionId", "=", input.transactionId)
    .execute();
  const paymentEffects = effectRows.filter((effect) => effect.targetType === "payment_account");
  const effects = effectRows.map((effect) => ({
    targetType: effect.targetType,
    effectType: effect.effectType,
    direction: effect.direction,
    amount: toNumber(effect.amount),
    beforeAmount: toNumber(effect.beforeAmount),
    afterAmount: toNumber(effect.afterAmount),
  }));
  const inventoryDecreaseAmount = effects
    .filter((effect) => effect.targetType === "inventory" && effect.direction === "decrease")
    .reduce((sum, effect) => sum + effect.amount, 0);
  const notes = row.type === "sales_income" ? ["Penjualan tidak otomatis mengurangi stok."] : [];

  return {
    id: row.id,
    type: row.type as TransactionType,
    amount: toNumber(row.amount),
    date: row.transactionDate,
    description: row.description,
    status: toTransactionHistoryStatus(row.type, row.status, row.isReversal),
    isReversed: row.status === "reversed",
    cashDirection: cashDirectionFromPaymentEffects(paymentEffects),
    affectedObject: extractAffectedObject(row.proposedActionJson ?? row.structuredPayload),
    paymentAccount: toPaymentAccountDto(row.paymentAccountId, row.paymentAccountName),
    captureMode: row.confirmationRequestId ? "confirmed_flow" : "auto_fast",
    createdAt: row.createdAt,
    rawInputText: row.rawInputText ?? null,
    interpretedAction: interpretedActionFromPayloads({
      proposedActionJson: row.proposedActionJson,
      structuredPayload: row.structuredPayload,
    }),
    expectedEffects: parseJsonStringArray(row.expectedEffectsJson),
    effects,
    notes,
    inventoryDecrease: {
      hasDecrease: inventoryDecreaseAmount > 0,
      amount: inventoryDecreaseAmount,
    },
  };
}

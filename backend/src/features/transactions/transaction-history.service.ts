import { db } from "../../lib/database.js";
import { extractAffectedObject, toPaymentAccountDto, toTransactionHistoryStatus } from "./transaction-dto.mapper.js";
import { toNumber, type TransactionType } from "./transaction-types.js";

export interface TransactionHistoryItem {
  id: string;
  type: TransactionType;
  amount: number;
  date: string;
  description: string;
  status: "confirmed" | "reversed" | "reversal";
  isReversed: boolean;
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

function toTransactionHistoryItem(row: TransactionHistoryRow): TransactionHistoryItem {
  return {
    id: row.id,
    type: row.type as TransactionType,
    amount: toNumber(row.amount),
    date: row.transactionDate,
    description: row.description,
    status: toTransactionHistoryStatus(row.type, row.status, row.isReversal),
    isReversed: row.status === "reversed",
    affectedObject: extractAffectedObject(row.proposedActionJson),
    paymentAccount: toPaymentAccountDto(row.paymentAccountId, row.paymentAccountName),
    captureMode: row.confirmationRequestId ? "confirmed_flow" : "auto_fast",
    createdAt: row.createdAt,
  };
}

export async function listTransactionHistoryByBusinessId(input: ListTransactionHistoryInput): Promise<TransactionHistoryResult> {
  const offset = (input.page - 1) * input.limit;

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

  const rows = await baseQuery
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
    ])
    .orderBy("tx.transactionDate", "desc")
    .orderBy("tx.createdAt", "desc")
    .limit(input.limit)
    .offset(offset)
    .execute();

  return {
    items: rows.map((row) => toTransactionHistoryItem(row as TransactionHistoryRow)),
    page: input.page,
    limit: input.limit,
    total: toNumber(totalRow?.count ?? 0),
  };
}

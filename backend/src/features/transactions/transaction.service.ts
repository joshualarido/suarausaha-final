import { randomUUID } from "node:crypto";
import { runFinancialWrite } from "../../lib/financial-write.js";
import { db, type OpeningBalanceRow, type TransactionRow } from "../../lib/database.js";
import type { FinancialWriteTx } from "../../lib/financial-write.js";

export const TRANSACTION_TYPES = [
  "sales_income",
  "general_expense",
  "inventory_purchase_value",
  "asset_record_or_purchase",
  "liability_created",
  "liability_payment",
  "receivable_created",
  "receivable_payment",
  "owner_capital_contribution",
  "owner_withdrawal",
  "reversal",
] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export interface CreateBaseTransactionInput {
  businessId: string;
  createdBy: string;
  type: TransactionType;
  amount: number;
  transactionDate: string;
  description: string;
  paymentAccountId?: string | null;
  confirmationRequestId?: string | null;
  parsedCommandId?: string | null;
  isReversal?: boolean;
}

export class InvalidTransactionAmountError extends Error {
  constructor() {
    super("Transaction amount must be greater than zero.");
  }
}

export class InvalidPaymentAccountOwnershipError extends Error {
  constructor() {
    super("Payment account does not belong to this business.");
  }
}

function validateBaseTransactionInput(input: CreateBaseTransactionInput): void {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new InvalidTransactionAmountError();
  }

  if (!input.description.trim()) {
    throw new Error("Transaction description is required.");
  }
}

export async function createBaseTransactionInTransaction(
  tx: FinancialWriteTx,
  input: CreateBaseTransactionInput,
): Promise<TransactionRow> {
  validateBaseTransactionInput(input);

  if (input.paymentAccountId) {
    const account = await tx
      .selectFrom("payment_accounts")
      .select(["id", "businessId"])
      .where("id", "=", input.paymentAccountId)
      .executeTakeFirst();

    if (!account || account.businessId !== input.businessId) {
      throw new InvalidPaymentAccountOwnershipError();
    }
  }

  const now = new Date();

  return tx
    .insertInto("transactions")
    .values({
      id: randomUUID(),
      businessId: input.businessId,
      confirmationRequestId: input.confirmationRequestId ?? null,
      parsedCommandId: input.parsedCommandId ?? null,
      paymentAccountId: input.paymentAccountId ?? null,
      type: input.type,
      amount: BigInt(input.amount).toString(),
      transactionDate: input.transactionDate,
      description: input.description.trim(),
      status: "confirmed",
      isReversal: input.isReversal ?? false,
      reversedAt: null,
      createdAt: now,
      createdBy: input.createdBy,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function createBaseTransaction(input: CreateBaseTransactionInput): Promise<TransactionRow> {
  validateBaseTransactionInput(input);
  return runFinancialWrite(async (tx) => createBaseTransactionInTransaction(tx, input));
}

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

export interface InventorySummaryResult {
  estimatedValue: number;
  openingValue: number;
  purchasedValue: number;
  lastUpdatedAt: Date | null;
  note: string;
}

export interface AssetSummaryItem {
  id: string;
  name: string;
  value: number;
  recordedDate: string;
  sourceTransactionId: string;
}

export interface AssetSummaryResult {
  totalAssetValue: number;
  openingValue: number;
  purchasedOrRecordedValue: number;
  items: AssetSummaryItem[];
}

export interface LiabilitySummaryItem {
  id: string;
  lenderName: string;
  originalAmount: number;
  outstandingAmount: number;
  status: "open" | "partial" | "paid";
  createdDate: string;
  sourceTransactionId: string;
}

export interface LiabilitySummaryResult {
  totalOriginalAmount: number;
  totalOutstandingAmount: number;
  items: LiabilitySummaryItem[];
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }

  return null;
}

export function extractAffectedObject(proposedActionJson: unknown): string | null {
  const payload = parseJsonObject(proposedActionJson);
  if (!payload) return null;

  const affectedObject = payload.affectedObject;
  if (typeof affectedObject !== "string") return null;

  const trimmed = affectedObject.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toHistoryStatus(type: string, status: TransactionRow["status"], isReversal: boolean): "confirmed" | "reversed" | "reversal" {
  if (type === "reversal" || isReversal) return "reversal";
  return status;
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
  proposedActionJson: unknown;
}

function toTransactionHistoryItem(row: TransactionHistoryRow): TransactionHistoryItem {
  return {
    id: row.id,
    type: row.type as TransactionType,
    amount: toNumber(row.amount),
    date: row.transactionDate,
    description: row.description,
    status: toHistoryStatus(row.type, row.status, row.isReversal),
    isReversed: row.status === "reversed",
    affectedObject: extractAffectedObject(row.proposedActionJson),
    paymentAccount:
      row.paymentAccountId && row.paymentAccountName
        ? {
            id: row.paymentAccountId,
            name: row.paymentAccountName,
          }
        : null,
    createdAt: row.createdAt,
  };
}

function normalizeDate(value: Date | string | null): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function getConfirmedOpeningBalanceByBusinessId(businessId: string): Promise<OpeningBalanceRow | null> {
  return (
    (await db
      .selectFrom("opening_balances")
      .selectAll()
      .where("businessId", "=", businessId)
      .where("status", "=", "confirmed")
      .executeTakeFirst()) ?? null
  );
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

export async function getInventorySummaryByBusinessId(businessId: string): Promise<InventorySummaryResult> {
  const [openingBalance, inventoryTotals] = await Promise.all([
    getConfirmedOpeningBalanceByBusinessId(businessId),
    db
      .selectFrom("transactions")
      .select(({ fn }) => [
        fn.sum<string>("amount").as("purchasedValue"),
        fn.max("createdAt").as("lastUpdatedAt"),
      ])
      .where("businessId", "=", businessId)
      .where("type", "=", "inventory_purchase_value")
      .executeTakeFirst(),
  ]);

  const openingValue = toNumber(openingBalance?.inventoryValue ?? 0);
  const purchasedValue = toNumber(inventoryTotals?.purchasedValue ?? 0);
  const openingUpdatedAt = normalizeDate(openingBalance?.confirmedAt ?? null);
  const transactionUpdatedAt = normalizeDate(inventoryTotals?.lastUpdatedAt ?? null);

  const lastUpdatedAt =
    openingUpdatedAt && transactionUpdatedAt
      ? openingUpdatedAt > transactionUpdatedAt
        ? openingUpdatedAt
        : transactionUpdatedAt
      : openingUpdatedAt ?? transactionUpdatedAt;

  return {
    estimatedValue: openingValue + purchasedValue,
    openingValue,
    purchasedValue,
    lastUpdatedAt,
    note: "Nilai persediaan masih berupa estimasi dan tidak otomatis berkurang saat terjadi penjualan.",
  };
}

export async function getAssetSummaryByBusinessId(businessId: string): Promise<AssetSummaryResult> {
  const [openingBalance, assetRows] = await Promise.all([
    getConfirmedOpeningBalanceByBusinessId(businessId),
    db
      .selectFrom("transactions as tx")
      .leftJoin("confirmation_requests as cr", "cr.id", "tx.confirmationRequestId")
      .select([
        "tx.id",
        "tx.amount",
        "tx.transactionDate",
        "tx.description",
        "cr.proposedActionJson",
      ])
      .where("tx.businessId", "=", businessId)
      .where("tx.type", "=", "asset_record_or_purchase")
      .orderBy("tx.transactionDate", "desc")
      .orderBy("tx.createdAt", "desc")
      .execute(),
  ]);

  const items = assetRows.map((row) => {
    const affectedObject = extractAffectedObject(row.proposedActionJson);
    return {
      id: `asset-from-${row.id}`,
      name: affectedObject ?? row.description,
      value: toNumber(row.amount),
      recordedDate: row.transactionDate,
      sourceTransactionId: row.id,
    };
  });

  const openingValue = toNumber(openingBalance?.assetValue ?? 0);
  const purchasedOrRecordedValue = items.reduce((total, item) => total + item.value, 0);

  return {
    totalAssetValue: openingValue + purchasedOrRecordedValue,
    openingValue,
    purchasedOrRecordedValue,
    items,
  };
}

interface LiabilityAccumulator {
  id: string;
  lenderName: string;
  originalAmount: number;
  paidAmount: number;
  createdDate: string;
  sourceTransactionId: string;
}

function liabilityStatusFromOutstanding(outstandingAmount: number, paidAmount: number): "open" | "partial" | "paid" {
  if (outstandingAmount <= 0) return "paid";
  if (paidAmount > 0) return "partial";
  return "open";
}

export async function getLiabilitySummaryByBusinessId(businessId: string): Promise<LiabilitySummaryResult> {
  const [openingBalance, liabilityRows] = await Promise.all([
    getConfirmedOpeningBalanceByBusinessId(businessId),
    db
      .selectFrom("transactions as tx")
      .leftJoin("confirmation_requests as cr", "cr.id", "tx.confirmationRequestId")
      .select([
        "tx.id",
        "tx.type",
        "tx.amount",
        "tx.transactionDate",
        "tx.description",
        "cr.proposedActionJson",
      ])
      .where("tx.businessId", "=", businessId)
      .where("tx.type", "in", ["liability_created", "liability_payment"])
      .orderBy("tx.transactionDate", "asc")
      .orderBy("tx.createdAt", "asc")
      .execute(),
  ]);

  const byName = new Map<string, LiabilityAccumulator>();

  for (const row of liabilityRows) {
    const amount = toNumber(row.amount);
    const affectedObject = extractAffectedObject(row.proposedActionJson);
    const lenderName = affectedObject ?? row.description;
    const key = lenderName.toLowerCase();

    const existing = byName.get(key) ?? {
      id: `liability-${byName.size + 1}`,
      lenderName,
      originalAmount: 0,
      paidAmount: 0,
      createdDate: row.transactionDate,
      sourceTransactionId: row.id,
    };

    if (row.type === "liability_created") {
      existing.originalAmount += amount;
    } else if (row.type === "liability_payment") {
      existing.paidAmount += amount;
    }

    byName.set(key, existing);
  }

  const openingDebtValue = toNumber(openingBalance?.debtValue ?? 0);
  if (openingDebtValue > 0) {
    const openingDate = openingBalance?.confirmedAt?.toISOString().slice(0, 10) ?? new Date().toISOString().slice(0, 10);
    byName.set("__opening-balance__", {
      id: "liability-opening-balance",
      lenderName: "Saldo awal utang",
      originalAmount: openingDebtValue,
      paidAmount: 0,
      createdDate: openingDate,
      sourceTransactionId: "opening-balance",
    });
  }

  const items = Array.from(byName.values())
    .map((entry) => {
      const outstandingAmount = Math.max(0, entry.originalAmount - entry.paidAmount);
      return {
        id: entry.id,
        lenderName: entry.lenderName,
        originalAmount: entry.originalAmount,
        outstandingAmount,
        status: liabilityStatusFromOutstanding(outstandingAmount, entry.paidAmount),
        createdDate: entry.createdDate,
        sourceTransactionId: entry.sourceTransactionId,
      };
    })
    .sort((a, b) => b.outstandingAmount - a.outstandingAmount);

  return {
    totalOriginalAmount: items.reduce((sum, item) => sum + item.originalAmount, 0),
    totalOutstandingAmount: items.reduce((sum, item) => sum + item.outstandingAmount, 0),
    items,
  };
}

import { db, type OpeningBalanceRow } from "../../lib/database.js";
import { toNumber } from "./transaction-types.js";

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

export interface ReceivableSummaryItem {
  id: string;
  customerName: string;
  originalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  remainingAmount: number;
  status: "open" | "partial" | "paid";
  createdDate: string;
  sourceTransactionId: string;
}

export interface ReceivableSummaryResult {
  totalOriginalAmount: number;
  totalPaidAmount: number;
  totalOutstandingAmount: number;
  items: ReceivableSummaryItem[];
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

export async function getInventorySummaryByBusinessId(businessId: string): Promise<InventorySummaryResult> {
  const [openingBalance, inventoryRows] = await Promise.all([
    getConfirmedOpeningBalanceByBusinessId(businessId),
    db
      .selectFrom("inventory_summaries")
      .select(["estimatedValue", "sourceOpeningBalanceId", "lastUpdatedAt"])
      .where("businessId", "=", businessId)
      .where("status", "=", "active")
      .execute(),
  ]);

  const openingRows = inventoryRows.filter((row) => row.sourceOpeningBalanceId);
  const transactionRows = inventoryRows.filter((row) => !row.sourceOpeningBalanceId);
  const openingValue = openingRows.length
    ? openingRows.reduce((sum, row) => sum + toNumber(row.estimatedValue), 0)
    : toNumber(openingBalance?.inventoryValue ?? 0);
  const purchasedValue = transactionRows.reduce((sum, row) => sum + toNumber(row.estimatedValue), 0);
  const openingUpdatedAt = normalizeDate(openingBalance?.confirmedAt ?? null);
  const transactionUpdatedAt = inventoryRows
    .map((row) => normalizeDate(row.lastUpdatedAt))
    .filter((value): value is Date => Boolean(value))
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

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
      .selectFrom("asset_summaries")
      .select([
        "id",
        "name",
        "value",
        "recordedDate",
        "sourceOpeningBalanceId",
        "sourceTransactionId",
      ])
      .where("businessId", "=", businessId)
      .where("status", "=", "active")
      .orderBy("recordedDate", "desc")
      .orderBy("createdAt", "desc")
      .execute(),
  ]);

  const items = assetRows.map((row) => {
    return {
      id: row.id,
      name: row.name,
      value: toNumber(row.value),
      recordedDate: row.recordedDate,
      sourceTransactionId: row.sourceOpeningBalanceId ? "opening-balance" : row.sourceTransactionId ?? "unknown",
    };
  });

  const openingRows = assetRows.filter((row) => row.sourceOpeningBalanceId);
  const openingValue = openingRows.length
    ? openingRows.reduce((total, item) => total + toNumber(item.value), 0)
    : toNumber(openingBalance?.assetValue ?? 0);
  const purchasedOrRecordedValue = assetRows
    .filter((row) => !row.sourceOpeningBalanceId)
    .reduce((total, item) => total + toNumber(item.value), 0);

  return {
    totalAssetValue: openingValue + purchasedOrRecordedValue,
    openingValue,
    purchasedOrRecordedValue,
    items,
  };
}

export async function getLiabilitySummaryByBusinessId(businessId: string): Promise<LiabilitySummaryResult> {
  const [openingBalance, liabilityRows] = await Promise.all([
    getConfirmedOpeningBalanceByBusinessId(businessId),
    db
      .selectFrom("liabilities")
      .select([
        "id",
        "lenderName",
        "originalAmount",
        "outstandingAmount",
        "status",
        "createdDate",
        "sourceOpeningBalanceId",
        "sourceTransactionId",
      ])
      .where("businessId", "=", businessId)
      .where("status", "in", ["open", "partial", "paid"])
      .orderBy("createdDate", "asc")
      .orderBy("createdAt", "asc")
      .execute(),
  ]);

  const items: LiabilitySummaryItem[] = liabilityRows.map((row) => ({
    id: row.id,
    lenderName: row.lenderName,
    originalAmount: toNumber(row.originalAmount),
    outstandingAmount: toNumber(row.outstandingAmount),
    status: row.status,
    createdDate: row.createdDate,
    sourceTransactionId: row.sourceOpeningBalanceId ? "opening-balance" : row.sourceTransactionId ?? "unknown",
  }));

  const openingDebtValue = toNumber(openingBalance?.debtValue ?? 0);
  const hasOpeningRows = liabilityRows.some((row) => row.sourceOpeningBalanceId);
  if (!hasOpeningRows && openingDebtValue > 0) {
    const openingDate = openingBalance?.confirmedAt?.toISOString().slice(0, 10) ?? new Date().toISOString().slice(0, 10);
    items.push({
      id: "liability-opening-balance",
      lenderName: "Saldo awal utang",
      originalAmount: openingDebtValue,
      outstandingAmount: openingDebtValue,
      status: "open",
      createdDate: openingDate,
      sourceTransactionId: "opening-balance",
    });
  }

  items.sort((a, b) => b.outstandingAmount - a.outstandingAmount);

  return {
    totalOriginalAmount: items.reduce((sum, item) => sum + item.originalAmount, 0),
    totalOutstandingAmount: items.reduce((sum, item) => sum + item.outstandingAmount, 0),
    items,
  };
}

export async function getReceivableSummaryByBusinessId(businessId: string): Promise<ReceivableSummaryResult> {
  const [openingBalance, receivableRows] = await Promise.all([
    getConfirmedOpeningBalanceByBusinessId(businessId),
    db
      .selectFrom("receivables")
      .select([
        "id",
        "customerName",
        "originalAmount",
        "outstandingAmount",
        "status",
        "createdDate",
        "sourceOpeningBalanceId",
        "sourceTransactionId",
      ])
      .where("businessId", "=", businessId)
      .where("status", "in", ["open", "partial", "paid"])
      .orderBy("createdDate", "asc")
      .orderBy("createdAt", "asc")
      .execute(),
  ]);

  const items: ReceivableSummaryItem[] = receivableRows.map((row) => ({
    id: row.id,
    customerName: row.customerName,
    originalAmount: toNumber(row.originalAmount),
    paidAmount: Math.max(0, toNumber(row.originalAmount) - toNumber(row.outstandingAmount)),
    outstandingAmount: toNumber(row.outstandingAmount),
    remainingAmount: toNumber(row.outstandingAmount),
    status: row.status,
    createdDate: row.createdDate,
    sourceTransactionId: row.sourceOpeningBalanceId ? "opening-balance" : row.sourceTransactionId ?? "unknown",
  }));

  const openingReceivableValue = toNumber(openingBalance?.receivableValue ?? 0);
  const hasOpeningRows = receivableRows.some((row) => row.sourceOpeningBalanceId);
  if (!hasOpeningRows && openingReceivableValue > 0) {
    const openingDate = openingBalance?.confirmedAt?.toISOString().slice(0, 10) ?? new Date().toISOString().slice(0, 10);
    items.push({
      id: "receivable-opening-balance",
      customerName: "Saldo awal piutang",
      originalAmount: openingReceivableValue,
      paidAmount: 0,
      outstandingAmount: openingReceivableValue,
      remainingAmount: openingReceivableValue,
      status: "open",
      createdDate: openingDate,
      sourceTransactionId: "opening-balance",
    });
  }

  items.sort((a, b) => b.outstandingAmount - a.outstandingAmount);

  return {
    totalOriginalAmount: items.reduce((sum, item) => sum + item.originalAmount, 0),
    totalPaidAmount: items.reduce((sum, item) => sum + item.paidAmount, 0),
    totalOutstandingAmount: items.reduce((sum, item) => sum + item.outstandingAmount, 0),
    items,
  };
}

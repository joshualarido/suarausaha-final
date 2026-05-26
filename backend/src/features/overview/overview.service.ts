import { db } from "../../lib/database.js";
import { listPaymentAccountsByBusinessId } from "../payment-accounts/payment-account.service.js";
import {
  getInventorySummaryByBusinessId,
  getLiabilitySummaryByBusinessId,
  getReceivableSummaryByBusinessId,
} from "../transactions/transaction.service.js";

export interface OverviewInput {
  businessId: string;
  userId: string;
  fromDate: string;
  toDate: string;
  asOfDate?: Date;
}

export type OverviewCashDirection = "in" | "out" | "neutral";

export interface OverviewTransactionItem {
  id: string;
  type: string;
  amount: number;
  date: string;
  description: string;
  paymentAccount: {
    id: string;
    name: string;
  } | null;
  affectedObject: string | null;
  cashDirection: OverviewCashDirection;
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

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function nextDateInputValue(date: Date): string {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  return toDateInputValue(next);
}

function activeOutstanding<T extends { outstandingAmount?: number; remainingAmount?: number }>(item: T): boolean {
  return (item.remainingAmount ?? item.outstandingAmount ?? 0) > 0;
}

export function cashDirectionFromEffects(effects: Array<{ direction: "increase" | "decrease"; amount: string }>): OverviewCashDirection {
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

export function summarizePaymentAccountBalances(
  paymentAccounts: Array<{ type: "cash" | "non_cash"; status: "active" | "inactive"; currentBalance: string | number }>,
) {
  const activeAccounts = paymentAccounts.filter((account) => account.status === "active");
  const cashBalance = activeAccounts
    .filter((account) => account.type === "cash")
    .reduce((sum, account) => sum + toNumber(account.currentBalance), 0);
  const nonCashBalance = activeAccounts
    .filter((account) => account.type === "non_cash")
    .reduce((sum, account) => sum + toNumber(account.currentBalance), 0);

  return {
    cashBalance,
    nonCashBalance,
    totalBalance: cashBalance + nonCashBalance,
  };
}

export function summarizeCashActivityRows(rows: Array<{ direction: "increase" | "decrease"; amount: string | number }>) {
  return rows.reduce(
    (summary, row) => {
      if (row.direction === "increase") {
        return { ...summary, moneyIn: summary.moneyIn + toNumber(row.amount) };
      }
      return { ...summary, moneyOut: summary.moneyOut + toNumber(row.amount) };
    },
    { moneyIn: 0, moneyOut: 0 },
  );
}

async function getMonthlyCashActivity(input: Pick<OverviewInput, "businessId" | "fromDate" | "toDate">) {
  const rows = await db
    .selectFrom("transaction_effects as effect")
    .innerJoin("transactions as transaction", "transaction.id", "effect.transactionId")
    .select(["effect.direction", "effect.amount"])
    .where("effect.businessId", "=", input.businessId)
    .where("effect.targetType", "=", "payment_account")
    .where("transaction.status", "=", "confirmed")
    .where("transaction.transactionDate", ">=", input.fromDate)
    .where("transaction.transactionDate", "<=", input.toDate)
    .execute();

  return summarizeCashActivityRows(rows);
}

async function getPendingConfirmationCount(input: Pick<OverviewInput, "businessId" | "userId">) {
  const row = await db
    .selectFrom("confirmation_requests")
    .select(({ fn }) => fn.countAll<string>().as("count"))
    .where("businessId", "=", input.businessId)
    .where("userId", "=", input.userId)
    .where("status", "=", "pending")
    .where("expiresAt", ">", new Date())
    .executeTakeFirst();

  return toNumber(row?.count ?? 0);
}

async function getTodayReversalCount(input: Pick<OverviewInput, "businessId" | "asOfDate">) {
  const asOfDate = input.asOfDate ?? new Date();
  const today = toDateInputValue(asOfDate);
  const tomorrow = nextDateInputValue(asOfDate);

  const row = await db
    .selectFrom("transactions")
    .select(({ fn }) => fn.countAll<string>().as("count"))
    .where("businessId", "=", input.businessId)
    .where((eb) =>
      eb.or([
        eb.and([
          eb("isReversal", "=", true),
          eb("createdAt", ">=", new Date(`${today}T00:00:00`)),
          eb("createdAt", "<", new Date(`${tomorrow}T00:00:00`)),
        ]),
        eb.and([
          eb("reversedAt", "is not", null),
          eb("reversedAt", ">=", new Date(`${today}T00:00:00`)),
          eb("reversedAt", "<", new Date(`${tomorrow}T00:00:00`)),
        ]),
      ]),
    )
    .executeTakeFirst();

  return toNumber(row?.count ?? 0);
}

async function getLatestConfirmedTransactions(businessId: string): Promise<OverviewTransactionItem[]> {
  const rows = await db
    .selectFrom("transactions as transaction")
    .leftJoin("payment_accounts as paymentAccount", "paymentAccount.id", "transaction.paymentAccountId")
    .leftJoin("confirmation_requests as confirmation", "confirmation.id", "transaction.confirmationRequestId")
    .select([
      "transaction.id",
      "transaction.type",
      "transaction.amount",
      "transaction.transactionDate",
      "transaction.description",
      "transaction.paymentAccountId",
      "paymentAccount.name as paymentAccountName",
      "confirmation.proposedActionJson",
    ])
    .where("transaction.businessId", "=", businessId)
    .where("transaction.status", "=", "confirmed")
    .where("transaction.isReversal", "=", false)
    .where("transaction.type", "!=", "reversal")
    .orderBy("transaction.transactionDate", "desc")
    .orderBy("transaction.createdAt", "desc")
    .limit(5)
    .execute();

  const transactionIds = rows.map((row) => row.id);
  const effectRows = transactionIds.length
    ? await db
        .selectFrom("transaction_effects")
        .select(["transactionId", "direction", "amount"])
        .where("businessId", "=", businessId)
        .where("targetType", "=", "payment_account")
        .where("transactionId", "in", transactionIds)
        .execute()
    : [];

  return rows.map((row) => {
    const effects = effectRows.filter((effect) => effect.transactionId === row.id);

    return {
      id: row.id,
      type: row.type,
      amount: toNumber(row.amount),
      date: row.transactionDate,
      description: row.description,
      affectedObject: extractAffectedObject(row.proposedActionJson),
      paymentAccount:
        row.paymentAccountId && row.paymentAccountName
          ? {
              id: row.paymentAccountId,
              name: row.paymentAccountName,
            }
          : null,
      cashDirection: cashDirectionFromEffects(effects),
    };
  });
}

function extractAffectedObject(proposedActionJson: unknown): string | null {
  const payload =
    proposedActionJson && typeof proposedActionJson === "object" && !Array.isArray(proposedActionJson)
      ? proposedActionJson as Record<string, unknown>
      : null;
  const affectedObject = payload?.affectedObject;
  return typeof affectedObject === "string" && affectedObject.trim() ? affectedObject.trim() : null;
}

export async function getOverviewByBusinessId(input: OverviewInput) {
  const [
    paymentAccounts,
    inventorySummary,
    receivablesSummary,
    liabilitiesSummary,
    monthlyCashActivity,
    pendingConfirmationCount,
    reversedTransactionCountToday,
    latestConfirmedTransactions,
  ] = await Promise.all([
    listPaymentAccountsByBusinessId(input.businessId),
    getInventorySummaryByBusinessId(input.businessId),
    getReceivableSummaryByBusinessId(input.businessId),
    getLiabilitySummaryByBusinessId(input.businessId),
    getMonthlyCashActivity(input),
    getPendingConfirmationCount(input),
    getTodayReversalCount(input),
    getLatestConfirmedTransactions(input.businessId),
  ]);

  const accountBalanceSummary = summarizePaymentAccountBalances(paymentAccounts);
  const activeReceivables = receivablesSummary.items.filter(activeOutstanding);
  const activeLiabilities = liabilitiesSummary.items.filter(activeOutstanding);

  return {
    asOfDate: toDateInputValue(input.asOfDate ?? new Date()),
    summaryCards: {
      totalBusinessMoney: accountBalanceSummary.totalBalance,
      cashBalance: accountBalanceSummary.cashBalance,
      nonCashBalance: accountBalanceSummary.nonCashBalance,
      receivableOutstanding: receivablesSummary.totalOutstandingAmount,
      liabilityOutstanding: liabilitiesSummary.totalOutstandingAmount,
      inventoryEstimated: inventorySummary.estimatedValue,
    },
    accountBalances: {
      cashBalance: accountBalanceSummary.cashBalance,
      nonCashBalance: accountBalanceSummary.nonCashBalance,
      totalBalance: accountBalanceSummary.totalBalance,
    },
    monthlyActivity: {
      fromDate: input.fromDate,
      toDate: input.toDate,
      moneyIn: monthlyCashActivity.moneyIn,
      moneyOut: monthlyCashActivity.moneyOut,
      difference: monthlyCashActivity.moneyIn - monthlyCashActivity.moneyOut,
    },
    receivables: {
      totalOutstanding: receivablesSummary.totalOutstandingAmount,
      activeCount: activeReceivables.length,
      items: activeReceivables.slice(0, 3),
    },
    liabilities: {
      totalOutstanding: liabilitiesSummary.totalOutstandingAmount,
      activeCount: activeLiabilities.length,
      items: activeLiabilities.slice(0, 3),
    },
    warnings: {
      isCashLow: accountBalanceSummary.cashBalance < 100_000,
      pendingConfirmationCount,
      reversedTransactionCountToday,
    },
    latestConfirmedTransactions,
    notes: {
      inventory: inventorySummary.note,
      monthlyActivity: "Ringkasan aktivitas uang bulan ini. Ini bukan laba.",
    },
  };
}

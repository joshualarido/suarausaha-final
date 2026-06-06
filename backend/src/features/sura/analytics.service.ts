import { db } from "../../lib/database.js";
import { listPaymentAccountsByBusinessId } from "../payment-accounts/payment-account.service.js";
import {
  getAssetSummaryByBusinessId,
  getInventorySummaryByBusinessId,
  getLiabilitySummaryByBusinessId,
  getReceivableSummaryByBusinessId,
} from "../transactions/transaction.service.js";
import { toNumber } from "../transactions/transaction-types.js";
import type { ResolvedSuraDateRange } from "./date-range.js";
import type { SuraAnalyticsIntent } from "./sura-intent-classifier.js";

export interface SuraAnalyticsInput {
  businessId: string;
  intent: SuraAnalyticsIntent;
  dateRange?: ResolvedSuraDateRange | null;
  limit?: number | null;
}

async function getPaymentAccountBalances(businessId: string) {
  const accounts = await listPaymentAccountsByBusinessId(businessId);
  const activeAccounts = accounts.filter((account) => account.status === "active");
  const cashBalance = activeAccounts
    .filter((account) => account.type === "cash")
    .reduce((sum, account) => sum + toNumber(account.currentBalance), 0);
  const nonCashBalance = activeAccounts
    .filter((account) => account.type === "non_cash")
    .reduce((sum, account) => sum + toNumber(account.currentBalance), 0);

  return {
    cashBalance,
    nonCashBalance,
    totalMoney: cashBalance + nonCashBalance,
  };
}

async function sumConfirmedTransactions(input: {
  businessId: string;
  type: "sales_income" | "general_expense";
  dateRange: ResolvedSuraDateRange;
}) {
  const row = await db
    .selectFrom("transactions")
    .select(({ fn }) => fn.sum<string>("amount").as("total"))
    .where("businessId", "=", input.businessId)
    .where("status", "=", "confirmed")
    .where("isReversal", "=", false)
    .where("type", "=", input.type)
    .where("transactionDate", ">=", input.dateRange.startDate)
    .where("transactionDate", "<=", input.dateRange.endDate)
    .executeTakeFirst();

  return toNumber(row?.total ?? 0);
}

async function countConfirmedTransactions(input: {
  businessId: string;
  dateRange: ResolvedSuraDateRange;
}) {
  const row = await db
    .selectFrom("transactions")
    .select(({ fn }) => fn.countAll<string>().as("count"))
    .where("businessId", "=", input.businessId)
    .where("status", "=", "confirmed")
    .where("isReversal", "=", false)
    .where("transactionDate", ">=", input.dateRange.startDate)
    .where("transactionDate", "<=", input.dateRange.endDate)
    .executeTakeFirst();

  return toNumber(row?.count ?? 0);
}

async function getRecentTransactions(input: { businessId: string; limit?: number | null }) {
  const limit = Math.max(1, Math.min(input.limit ?? 5, 20));
  const rows = await db
    .selectFrom("transactions")
    .select(["id", "type", "amount", "transactionDate", "description"])
    .where("businessId", "=", input.businessId)
    .where("status", "=", "confirmed")
    .where("isReversal", "=", false)
    .where("type", "!=", "reversal")
    .orderBy("transactionDate", "desc")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .execute();

  return {
    items: rows.map((row) => ({
      id: row.id,
      type: row.type,
      amount: toNumber(row.amount),
      date: normalizeDateValue(row.transactionDate),
      description: row.description,
    })),
    limit,
  };
}

function normalizeDateValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? trimmed : parsed.toISOString().slice(0, 10);
  }
  return "";
}

export async function runSuraAnalytics(input: SuraAnalyticsInput): Promise<Record<string, unknown>> {
  if (
    input.intent === "current_cash_balance" ||
    input.intent === "current_non_cash_balance" ||
    input.intent === "current_total_money"
  ) {
    return getPaymentAccountBalances(input.businessId);
  }

  if (input.intent === "sales_total") {
    return {
      salesTotal: await sumConfirmedTransactions({
        businessId: input.businessId,
        type: "sales_income",
        dateRange: input.dateRange!,
      }),
    };
  }

  if (input.intent === "expense_total") {
    return {
      expenseTotal: await sumConfirmedTransactions({
        businessId: input.businessId,
        type: "general_expense",
        dateRange: input.dateRange!,
      }),
    };
  }

  if (input.intent === "simple_net_income") {
    const [salesTotal, expenseTotal] = await Promise.all([
      sumConfirmedTransactions({
        businessId: input.businessId,
        type: "sales_income",
        dateRange: input.dateRange!,
      }),
      sumConfirmedTransactions({
        businessId: input.businessId,
        type: "general_expense",
        dateRange: input.dateRange!,
      }),
    ]);

    return {
      salesTotal,
      expenseTotal,
      netIncome: salesTotal - expenseTotal,
    };
  }

  if (input.intent === "recent_transactions") {
    return getRecentTransactions({ businessId: input.businessId, limit: input.limit });
  }

  if (input.intent === "outstanding_liabilities") {
    const summary = await getLiabilitySummaryByBusinessId(input.businessId);
    return {
      totalOutstanding: summary.totalOutstandingAmount,
      items: summary.items
        .filter((item) => item.outstandingAmount > 0)
        .map((item) => ({ name: item.lenderName, amount: item.outstandingAmount })),
    };
  }

  if (input.intent === "outstanding_receivables") {
    const summary = await getReceivableSummaryByBusinessId(input.businessId);
    return {
      totalOutstanding: summary.totalOutstandingAmount,
      items: summary.items
        .filter((item) => item.outstandingAmount > 0)
        .map((item) => ({ name: item.customerName, amount: item.outstandingAmount })),
    };
  }

  if (input.intent === "inventory_value") {
    const summary = await getInventorySummaryByBusinessId(input.businessId);
    return {
      inventoryValue: summary.estimatedValue,
    };
  }

  if (input.intent === "asset_value") {
    const summary = await getAssetSummaryByBusinessId(input.businessId);
    return {
      assetValue: summary.totalAssetValue,
      items: summary.items,
    };
  }

  const [salesTotal, expenseTotal, transactionCount, balances] = await Promise.all([
    sumConfirmedTransactions({
      businessId: input.businessId,
      type: "sales_income",
      dateRange: input.dateRange!,
    }),
    sumConfirmedTransactions({
      businessId: input.businessId,
      type: "general_expense",
      dateRange: input.dateRange!,
    }),
    countConfirmedTransactions({
      businessId: input.businessId,
      dateRange: input.dateRange!,
    }),
    getPaymentAccountBalances(input.businessId),
  ]);

  return {
    salesTotal,
    expenseTotal,
    netIncome: salesTotal - expenseTotal,
    transactionCount,
    cashBalance: balances.cashBalance,
    nonCashBalance: balances.nonCashBalance,
  };
}

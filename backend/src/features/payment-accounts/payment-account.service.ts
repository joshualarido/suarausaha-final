import { randomUUID } from "node:crypto";
import type { Selectable } from "kysely";
import { db, ensureDatabaseSchema, type PaymentAccountRow } from "../../lib/database.js";
import { runFinancialWrite, type FinancialWriteTx } from "../../lib/financial-write.js";

export type PaymentAccount = Selectable<PaymentAccountRow>;

export const DEFAULT_PAYMENT_ACCOUNTS = {
  cash: {
    type: "cash" as const,
    name: "Kas",
  },
  nonCash: {
    type: "non_cash" as const,
    name: "Bank / QRIS / E-wallet",
  },
};

export async function listPaymentAccountsByBusinessId(businessId: string): Promise<PaymentAccount[]> {
  await ensureDatabaseSchema();

  return db
    .selectFrom("payment_accounts")
    .selectAll()
    .where("businessId", "=", businessId)
    .orderBy("createdAt", "asc")
    .execute();
}

interface SeedDefaultPaymentAccountsInput {
  businessId: string;
  cashBalance: bigint;
  nonCashBalance: bigint;
}

interface SeedDefaultPaymentAccountsResult {
  cashAccountId: string;
  nonCashAccountId: string;
}

interface EnsureDefaultPaymentAccountsInput {
  businessId: string;
}

export async function ensureDefaultPaymentAccounts(
  tx: FinancialWriteTx,
  input: EnsureDefaultPaymentAccountsInput,
): Promise<SeedDefaultPaymentAccountsResult> {
  const existing = await tx
    .selectFrom("payment_accounts")
    .selectAll()
    .where("businessId", "=", input.businessId)
    .execute();

  const now = new Date();
  const cashAccount = existing.find((account) => account.type === DEFAULT_PAYMENT_ACCOUNTS.cash.type);
  const nonCashAccount = existing.find((account) => account.type === DEFAULT_PAYMENT_ACCOUNTS.nonCash.type);

  const cashAccountId = cashAccount?.id ?? randomUUID();
  const nonCashAccountId = nonCashAccount?.id ?? randomUUID();

  if (cashAccount) {
    await tx
      .updateTable("payment_accounts")
      .set({
        name: DEFAULT_PAYMENT_ACCOUNTS.cash.name,
        isDefault: true,
        status: "active",
        updatedAt: now,
      })
      .where("id", "=", cashAccount.id)
      .executeTakeFirst();
  } else {
    await tx
      .insertInto("payment_accounts")
      .values({
        id: cashAccountId,
        businessId: input.businessId,
        name: DEFAULT_PAYMENT_ACCOUNTS.cash.name,
        type: DEFAULT_PAYMENT_ACCOUNTS.cash.type,
        currentBalance: "0",
        isDefault: true,
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .executeTakeFirst();
  }

  if (nonCashAccount) {
    await tx
      .updateTable("payment_accounts")
      .set({
        name: DEFAULT_PAYMENT_ACCOUNTS.nonCash.name,
        isDefault: false,
        status: "active",
        updatedAt: now,
      })
      .where("id", "=", nonCashAccount.id)
      .executeTakeFirst();
  } else {
    await tx
      .insertInto("payment_accounts")
      .values({
        id: nonCashAccountId,
        businessId: input.businessId,
        name: DEFAULT_PAYMENT_ACCOUNTS.nonCash.name,
        type: DEFAULT_PAYMENT_ACCOUNTS.nonCash.type,
        currentBalance: "0",
        isDefault: false,
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .executeTakeFirst();
  }

  return {
    cashAccountId,
    nonCashAccountId,
  };
}

export async function ensureDefaultPaymentAccountsForBusinessId(businessId: string): Promise<void> {
  await runFinancialWrite(async (tx) => {
    await ensureDefaultPaymentAccounts(tx, { businessId });
  });
}

export async function seedDefaultPaymentAccounts(
  tx: FinancialWriteTx,
  input: SeedDefaultPaymentAccountsInput,
): Promise<SeedDefaultPaymentAccountsResult> {
  const now = new Date();
  const accountIds = await ensureDefaultPaymentAccounts(tx, { businessId: input.businessId });

  await tx
    .updateTable("payment_accounts")
    .set({
      name: DEFAULT_PAYMENT_ACCOUNTS.cash.name,
      currentBalance: input.cashBalance.toString(),
      isDefault: true,
      status: "active",
      updatedAt: now,
    })
    .where("id", "=", accountIds.cashAccountId)
    .executeTakeFirst();

  await tx
    .updateTable("payment_accounts")
    .set({
      name: DEFAULT_PAYMENT_ACCOUNTS.nonCash.name,
      currentBalance: input.nonCashBalance.toString(),
      isDefault: false,
      status: "active",
      updatedAt: now,
    })
    .where("id", "=", accountIds.nonCashAccountId)
    .executeTakeFirst();

  return {
    cashAccountId: accountIds.cashAccountId,
    nonCashAccountId: accountIds.nonCashAccountId,
  };
}

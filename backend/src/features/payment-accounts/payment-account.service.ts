import { randomUUID } from "node:crypto";
import type { Selectable } from "kysely";
import { db, type PaymentAccountRow } from "../../lib/database.js";
import { runFinancialWrite, type FinancialWriteTx } from "../../lib/financial-write.js";

export type PaymentAccount = Selectable<PaymentAccountRow>;

export class PaymentAccountNotFoundError extends Error {
  constructor() {
    super("Payment account not found for this business.");
  }
}

export class PaymentAccountAlreadyExistsError extends Error {
  constructor() {
    super("Payment account already exists.");
  }
}

export class DefaultPaymentAccountRemovalError extends Error {
  constructor() {
    super("Default payment account cannot be removed.");
  }
}

export const DEFAULT_PAYMENT_ACCOUNTS = {
  cash: {
    type: "cash" as const,
    name: "Kas",
  },
};

export async function listPaymentAccountsByBusinessId(businessId: string): Promise<PaymentAccount[]> {
  return db
    .selectFrom("payment_accounts")
    .selectAll()
    .where("businessId", "=", businessId)
    .where("status", "=", "active")
    .orderBy("createdAt", "asc")
    .execute();
}

interface SeedDefaultPaymentAccountsInput {
  businessId: string;
  cashBalance: bigint;
}

interface SeedDefaultPaymentAccountsResult {
  cashAccountId: string;
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

  const cashAccountId = cashAccount?.id ?? randomUUID();

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

  return {
    cashAccountId,
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

  return {
    cashAccountId: accountIds.cashAccountId,
  };
}

export async function updatePaymentAccountNameForBusiness(
  businessId: string,
  paymentAccountId: string,
  name: string,
): Promise<PaymentAccount> {
  return runFinancialWrite(async (tx) => {
    const updated = await tx
      .updateTable("payment_accounts")
      .set({
        name,
        updatedAt: new Date(),
      })
      .where("id", "=", paymentAccountId)
      .where("businessId", "=", businessId)
      .returningAll()
      .executeTakeFirst();

    if (!updated) {
      throw new PaymentAccountNotFoundError();
    }

    return updated;
  });
}

export async function createPaymentAccountForBusiness(
  businessId: string,
  name: string,
): Promise<PaymentAccount> {

  return runFinancialWrite(async (tx) => {
    const existing = await tx
      .selectFrom("payment_accounts")
      .selectAll()
      .where("businessId", "=", businessId)
      .where("name", "=", name)
      .executeTakeFirst();

    const now = new Date();

    if (existing) {
      if (existing.status === "active") {
        throw new PaymentAccountAlreadyExistsError();
      }

      const reactivated = await tx
        .updateTable("payment_accounts")
        .set({
          name,
          status: "active",
          updatedAt: now,
        })
        .where("id", "=", existing.id)
        .returningAll()
        .executeTakeFirstOrThrow();

      return reactivated;
    }

    const created = await tx
      .insertInto("payment_accounts")
      .values({
        id: randomUUID(),
        businessId,
        name,
        type: "non_cash",
        currentBalance: "0",
        isDefault: false,
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return created;
  });
}

export async function deactivatePaymentAccountForBusiness(
  businessId: string,
  paymentAccountId: string,
): Promise<PaymentAccount> {
  return runFinancialWrite(async (tx) => {
    const account = await tx
      .selectFrom("payment_accounts")
      .selectAll()
      .where("id", "=", paymentAccountId)
      .where("businessId", "=", businessId)
      .executeTakeFirst();

    if (!account) {
      throw new PaymentAccountNotFoundError();
    }

    if (account.isDefault) {
      throw new DefaultPaymentAccountRemovalError();
    }

    const updated = await tx
      .updateTable("payment_accounts")
      .set({
        status: "inactive",
        updatedAt: new Date(),
      })
      .where("id", "=", paymentAccountId)
      .where("businessId", "=", businessId)
      .returningAll()
      .executeTakeFirstOrThrow();

    return updated;
  });
}

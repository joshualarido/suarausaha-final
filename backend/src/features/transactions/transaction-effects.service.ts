import { randomUUID } from "node:crypto";
import type {
  AssetSummaryRow,
  InventorySummaryRow,
  LiabilityRow,
  PaymentAccountRow,
  ReceivableRow,
  TransactionEffectRow,
  TransactionRow,
} from "../../lib/database.js";
import type { FinancialWriteTx } from "../../lib/financial-write.js";
import {
  AmbiguousFinancialTargetError,
  FinancialTargetNotFoundError,
  FinancialTargetOverpaymentError,
  InsufficientPaymentAccountBalanceError,
  InvalidPaymentAccountOwnershipError,
  MissingPaymentAccountForTransactionError,
  normalizeTargetName,
  statusFromOutstanding,
  type CreateBaseTransactionInput,
  type TransactionType,
} from "./transaction-types.js";

function paymentAccountDeltaForValidation(type: TransactionType, amount: bigint, hasPaymentAccount: boolean): bigint | null {
  switch (type) {
    case "sales_income":
    case "receivable_payment":
    case "owner_capital_contribution":
      return amount;
    case "general_expense":
    case "inventory_purchase_value":
    case "liability_payment":
    case "owner_withdrawal":
    case "account_transfer":
      return -amount;
    case "asset_record_or_purchase":
      return hasPaymentAccount ? -amount : null;
    case "liability_created":
      return hasPaymentAccount ? amount : null;
    case "receivable_created":
    case "reversal":
      return null;
  }
}

export function validatePaymentAccountAvailability(
  type: TransactionType,
  amount: bigint,
  paymentAccount: Pick<PaymentAccountRow, "name" | "currentBalance"> | null,
): void {
  const delta = paymentAccountDeltaForValidation(type, amount, Boolean(paymentAccount));
  if (delta !== null && !paymentAccount) {
    throw new MissingPaymentAccountForTransactionError();
  }
  if (paymentAccount && delta !== null && BigInt(paymentAccount.currentBalance) + delta < 0n) {
    throw new InsufficientPaymentAccountBalanceError({
      accountName: paymentAccount.name,
      currentBalance: BigInt(paymentAccount.currentBalance),
      requiredAmount: delta < 0n ? -delta : amount,
    });
  }
}

export async function insertTransactionEffect(
  tx: FinancialWriteTx,
  input: {
    transactionId: string;
    businessId: string;
    targetType: string;
    targetId: string;
    effectType: string;
    direction: "increase" | "decrease";
    amount: bigint;
    beforeAmount: bigint;
    afterAmount: bigint;
    createdAt: Date;
  },
): Promise<TransactionEffectRow> {
  return tx
    .insertInto("transaction_effects")
    .values({
      id: randomUUID(),
      transactionId: input.transactionId,
      businessId: input.businessId,
      targetType: input.targetType,
      targetId: input.targetId,
      effectType: input.effectType,
      direction: input.direction,
      amount: input.amount.toString(),
      beforeAmount: input.beforeAmount.toString(),
      afterAmount: input.afterAmount.toString(),
      createdAt: input.createdAt,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function getPaymentAccountForUpdate(
  tx: FinancialWriteTx,
  input: CreateBaseTransactionInput,
): Promise<Pick<PaymentAccountRow, "id" | "businessId" | "name" | "currentBalance"> | null> {
  if (!input.paymentAccountId) return null;

  return getPaymentAccountByIdForUpdate(tx, {
    businessId: input.businessId,
    paymentAccountId: input.paymentAccountId,
  });
}

export async function getPaymentAccountByIdForUpdate(
  tx: FinancialWriteTx,
  input: { businessId: string; paymentAccountId: string },
): Promise<Pick<PaymentAccountRow, "id" | "businessId" | "name" | "currentBalance">> {
  const paymentAccount = await tx
    .selectFrom("payment_accounts")
    .select(["id", "businessId", "name", "currentBalance"])
    .where("id", "=", input.paymentAccountId)
    .forUpdate()
    .executeTakeFirst();

  if (!paymentAccount || paymentAccount.businessId !== input.businessId) {
    throw new InvalidPaymentAccountOwnershipError();
  }

  return paymentAccount;
}

export async function applyPaymentAccountEffect(
  tx: FinancialWriteTx,
  input: {
    transaction: TransactionRow;
    paymentAccount: Pick<PaymentAccountRow, "id" | "name" | "currentBalance"> | null;
    delta: bigint;
    effectType: string;
    now: Date;
  },
): Promise<void> {
  if (!input.paymentAccount) {
    throw new MissingPaymentAccountForTransactionError();
  }

  const beforeAmount = BigInt(input.paymentAccount.currentBalance);
  const afterAmount = beforeAmount + input.delta;
  if (afterAmount < 0n) {
    throw new InsufficientPaymentAccountBalanceError({
      accountName: input.paymentAccount.name,
      currentBalance: beforeAmount,
      requiredAmount: input.delta < 0n ? -input.delta : 0n,
    });
  }

  await tx
    .updateTable("payment_accounts")
    .set({
      currentBalance: afterAmount.toString(),
      updatedAt: input.now,
    })
    .where("id", "=", input.paymentAccount.id)
    .executeTakeFirst();

  await insertTransactionEffect(tx, {
    transactionId: input.transaction.id,
    businessId: input.transaction.businessId,
    targetType: "payment_account",
    targetId: input.paymentAccount.id,
    effectType: input.effectType,
    direction: input.delta > 0n ? "increase" : "decrease",
    amount: input.delta < 0n ? -input.delta : input.delta,
    beforeAmount,
    afterAmount,
    createdAt: input.now,
  });
}

export async function createInventoryRecord(
  tx: FinancialWriteTx,
  input: { transaction: TransactionRow; name: string; amount: bigint; now: Date },
): Promise<InventorySummaryRow> {
  const inventory = await tx
    .insertInto("inventory_summaries")
    .values({
      id: randomUUID(),
      businessId: input.transaction.businessId,
      name: input.name,
      estimatedValue: input.amount.toString(),
      sourceOpeningBalanceId: null,
      sourceTransactionId: input.transaction.id,
      lastUpdatedAt: input.now,
      status: "active",
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  await insertTransactionEffect(tx, {
    transactionId: input.transaction.id,
    businessId: input.transaction.businessId,
    targetType: "inventory",
    targetId: inventory.id,
    effectType: "inventory_value",
    direction: "increase",
    amount: input.amount,
    beforeAmount: 0n,
    afterAmount: input.amount,
    createdAt: input.now,
  });

  return inventory;
}

export async function createAssetRecord(
  tx: FinancialWriteTx,
  input: { transaction: TransactionRow; name: string; amount: bigint; now: Date },
): Promise<AssetSummaryRow> {
  const asset = await tx
    .insertInto("asset_summaries")
    .values({
      id: randomUUID(),
      businessId: input.transaction.businessId,
      name: input.name,
      value: input.amount.toString(),
      recordedDate: input.transaction.transactionDate,
      sourceOpeningBalanceId: null,
      sourceTransactionId: input.transaction.id,
      status: "active",
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  await insertTransactionEffect(tx, {
    transactionId: input.transaction.id,
    businessId: input.transaction.businessId,
    targetType: "asset",
    targetId: asset.id,
    effectType: "asset_value",
    direction: "increase",
    amount: input.amount,
    beforeAmount: 0n,
    afterAmount: input.amount,
    createdAt: input.now,
  });

  return asset;
}

export async function createLiabilityRecord(
  tx: FinancialWriteTx,
  input: { transaction: TransactionRow; lenderName: string; amount: bigint; now: Date },
): Promise<LiabilityRow> {
  const liability = await tx
    .insertInto("liabilities")
    .values({
      id: randomUUID(),
      businessId: input.transaction.businessId,
      lenderName: input.lenderName,
      description: input.transaction.description,
      originalAmount: input.amount.toString(),
      outstandingAmount: input.amount.toString(),
      createdDate: input.transaction.transactionDate,
      status: "open",
      sourceOpeningBalanceId: null,
      sourceTransactionId: input.transaction.id,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  await insertTransactionEffect(tx, {
    transactionId: input.transaction.id,
    businessId: input.transaction.businessId,
    targetType: "liability",
    targetId: liability.id,
    effectType: "liability_outstanding",
    direction: "increase",
    amount: input.amount,
    beforeAmount: 0n,
    afterAmount: input.amount,
    createdAt: input.now,
  });

  return liability;
}

export async function createReceivableRecord(
  tx: FinancialWriteTx,
  input: { transaction: TransactionRow; customerName: string; amount: bigint; now: Date },
): Promise<ReceivableRow> {
  const receivable = await tx
    .insertInto("receivables")
    .values({
      id: randomUUID(),
      businessId: input.transaction.businessId,
      customerName: input.customerName,
      description: input.transaction.description,
      originalAmount: input.amount.toString(),
      outstandingAmount: input.amount.toString(),
      createdDate: input.transaction.transactionDate,
      status: "open",
      sourceOpeningBalanceId: null,
      sourceTransactionId: input.transaction.id,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  await insertTransactionEffect(tx, {
    transactionId: input.transaction.id,
    businessId: input.transaction.businessId,
    targetType: "receivable",
    targetId: receivable.id,
    effectType: "receivable_outstanding",
    direction: "increase",
    amount: input.amount,
    beforeAmount: 0n,
    afterAmount: input.amount,
    createdAt: input.now,
  });

  return receivable;
}

export async function insertIncomeOrExpenseEffect(
  tx: FinancialWriteTx,
  input: {
    transaction: TransactionRow;
    effectType: "income" | "expense" | "owner_capital" | "owner_withdrawal";
    amount: bigint;
    now: Date;
  },
): Promise<void> {
  await insertTransactionEffect(tx, {
    transactionId: input.transaction.id,
    businessId: input.transaction.businessId,
    targetType: "business_bucket",
    targetId: input.effectType,
    effectType: input.effectType,
    direction: "increase",
    amount: input.amount,
    beforeAmount: 0n,
    afterAmount: input.amount,
    createdAt: input.now,
  });
}

export async function resolveLiabilityForPayment(
  tx: FinancialWriteTx,
  input: { businessId: string; targetName: string },
): Promise<LiabilityRow> {
  const rows = await tx
    .selectFrom("liabilities")
    .selectAll()
    .where("businessId", "=", input.businessId)
    .where("status", "in", ["open", "partial"])
    .forUpdate()
    .execute();

  const normalizedTarget = normalizeTargetName(input.targetName);
  const matches = rows.filter((row) => {
    return (
      row.id === input.targetName ||
      normalizeTargetName(row.lenderName).includes(normalizedTarget) ||
      normalizeTargetName(row.description ?? "").includes(normalizedTarget)
    );
  });

  if (matches.length === 0) {
    throw new FinancialTargetNotFoundError("Utang yang mau dibayar tidak ditemukan. Sebutkan nama pemberi utang yang sesuai.");
  }
  if (matches.length > 1) {
    throw new AmbiguousFinancialTargetError("Ada lebih dari satu utang yang cocok. Sebutkan target utang yang lebih spesifik.");
  }

  return matches[0];
}

export async function resolveReceivablesForPayment(
  tx: FinancialWriteTx,
  input: { businessId: string; targetName: string },
): Promise<ReceivableRow[]> {
  const rows = await tx
    .selectFrom("receivables")
    .selectAll()
    .where("businessId", "=", input.businessId)
    .where("status", "in", ["open", "partial"])
    .forUpdate()
    .execute();

  const normalizedTarget = normalizeTargetName(input.targetName);
  const exactMatches = rows.filter((row) => row.id === input.targetName);
  if (exactMatches.length > 0) return exactMatches;

  const matches = rows.filter((row) => {
    return (
      normalizeTargetName(row.customerName).includes(normalizedTarget) ||
      normalizeTargetName(row.description ?? "").includes(normalizedTarget)
    );
  });

  if (matches.length === 0) {
    throw new FinancialTargetNotFoundError("Piutang yang dibayar tidak ditemukan. Sebutkan nama pelanggan yang sesuai.");
  }
  if (matches.length > 1) {
    const customerNames = [...new Set(matches.map((row) => normalizeTargetName(row.customerName)))];
    if (customerNames.length > 1) {
      throw new AmbiguousFinancialTargetError("Ada lebih dari satu piutang yang cocok. Sebutkan target piutang yang lebih spesifik.");
    }
  }

  return matches;
}

export async function applyLiabilityPaymentEffect(
  tx: FinancialWriteTx,
  input: { transaction: TransactionRow; liability: LiabilityRow; amount: bigint; now: Date },
): Promise<void> {
  const beforeAmount = BigInt(input.liability.outstandingAmount);
  const originalAmount = BigInt(input.liability.originalAmount);
  if (input.amount > beforeAmount) {
    throw new FinancialTargetOverpaymentError(
      "Jumlah pembayaran melebihi sisa utang. Ubah jumlah pembayaran agar tidak lebih dari sisa utang.",
    );
  }

  const afterAmount = beforeAmount - input.amount;
  await tx
    .updateTable("liabilities")
    .set({
      outstandingAmount: afterAmount.toString(),
      status: statusFromOutstanding(originalAmount, afterAmount),
      updatedAt: input.now,
    })
    .where("id", "=", input.liability.id)
    .executeTakeFirst();

  await insertTransactionEffect(tx, {
    transactionId: input.transaction.id,
    businessId: input.transaction.businessId,
    targetType: "liability",
    targetId: input.liability.id,
    effectType: "liability_outstanding",
    direction: "decrease",
    amount: input.amount,
    beforeAmount,
    afterAmount,
    createdAt: input.now,
  });
}

export async function applyReceivablePaymentEffect(
  tx: FinancialWriteTx,
  input: { transaction: TransactionRow; receivable: ReceivableRow; amount: bigint; now: Date },
): Promise<void> {
  const beforeAmount = BigInt(input.receivable.outstandingAmount);
  const originalAmount = BigInt(input.receivable.originalAmount);
  if (input.amount > beforeAmount) {
    throw new FinancialTargetOverpaymentError(
      "Jumlah pembayaran melebihi sisa piutang. Ubah jumlah pembayaran agar tidak lebih dari sisa piutang.",
    );
  }

  const afterAmount = beforeAmount - input.amount;
  await tx
    .updateTable("receivables")
    .set({
      outstandingAmount: afterAmount.toString(),
      status: statusFromOutstanding(originalAmount, afterAmount),
      updatedAt: input.now,
    })
    .where("id", "=", input.receivable.id)
    .executeTakeFirst();

  await insertTransactionEffect(tx, {
    transactionId: input.transaction.id,
    businessId: input.transaction.businessId,
    targetType: "receivable",
    targetId: input.receivable.id,
    effectType: "receivable_outstanding",
    direction: "decrease",
    amount: input.amount,
    beforeAmount,
    afterAmount,
    createdAt: input.now,
  });
}

export async function applyReceivablePaymentEffects(
  tx: FinancialWriteTx,
  input: { transaction: TransactionRow; receivables: ReceivableRow[]; amount: bigint; now: Date },
): Promise<void> {
  const totalOutstanding = input.receivables.reduce((sum, receivable) => sum + BigInt(receivable.outstandingAmount), 0n);
  if (input.amount > totalOutstanding) {
    throw new FinancialTargetOverpaymentError(
      "Jumlah pembayaran melebihi sisa piutang. Ubah jumlah pembayaran agar tidak lebih dari sisa piutang.",
    );
  }

  let remaining = input.amount;
  for (const receivable of input.receivables) {
    if (remaining <= 0n) break;

    const outstanding = BigInt(receivable.outstandingAmount);
    const appliedAmount = remaining > outstanding ? outstanding : remaining;
    if (appliedAmount > 0n) {
      await applyReceivablePaymentEffect(tx, {
        transaction: input.transaction,
        receivable,
        amount: appliedAmount,
        now: input.now,
      });
      remaining -= appliedAmount;
    }
  }
}

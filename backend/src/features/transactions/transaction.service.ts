import { randomUUID } from "node:crypto";
import { runFinancialWrite } from "../../lib/financial-write.js";
import {
  db,
  type AssetSummaryRow,
  type InventorySummaryRow,
  type LiabilityRow,
  type OpeningBalanceRow,
  type PaymentAccountRow,
  type ReceivableRow,
  type TransactionEffectRow,
  type TransactionRow,
} from "../../lib/database.js";
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
  affectedObject?: string | null;
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

export class MissingPaymentAccountForTransactionError extends Error {
  constructor() {
    super("Payment account is required for this transaction type.");
  }
}

export class InsufficientPaymentAccountBalanceError extends Error {
  constructor(input?: { accountName?: string; currentBalance?: bigint; requiredAmount?: bigint }) {
    if (!input || input.currentBalance === undefined || input.requiredAmount === undefined) {
      super("Saldo akun pembayaran tidak cukup untuk transaksi ini.");
      return;
    }

    const accountName = input.accountName?.trim() || "akun pembayaran";
    super(
      `Saldo ${accountName} tidak cukup. Saldo ${accountName} saat ini ${formatIdrFromBigInt(input.currentBalance)}, tapi transaksi ini membutuhkan ${formatIdrFromBigInt(input.requiredAmount)}.`,
    );
  }
}

export class MissingAffectedObjectError extends Error {
  constructor(message = "Nama pihak atau objek transaksi diperlukan.") {
    super(message);
  }
}

export class FinancialTargetNotFoundError extends Error {
  constructor(message = "Catatan terkait tidak ditemukan.") {
    super(message);
  }
}

export class AmbiguousFinancialTargetError extends Error {
  constructor(message = "Ada lebih dari satu catatan yang cocok. Mohon pilih target yang lebih spesifik.") {
    super(message);
  }
}

export class FinancialTargetOverpaymentError extends Error {
  constructor(message = "Jumlah pembayaran melebihi sisa tagihan.") {
    super(message);
  }
}

export class UnsafeReversalError extends Error {
  constructor(message = "Transaksi ini belum bisa dibalik otomatis.") {
    super(message);
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

function normalizeTargetName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function affectedObjectOrDescription(input: CreateBaseTransactionInput): string {
  return input.affectedObject?.trim() || input.description.trim();
}

function requireAffectedObject(input: CreateBaseTransactionInput, message: string): string {
  const target = input.affectedObject?.trim();
  if (!target) throw new MissingAffectedObjectError(message);
  return target;
}

function statusFromOutstanding(originalAmount: bigint, outstandingAmount: bigint): "open" | "partial" | "paid" {
  if (outstandingAmount <= 0n) return "paid";
  if (outstandingAmount < originalAmount) return "partial";
  return "open";
}

function formatIdrFromBigInt(value: bigint): string {
  const absolute = value < 0n ? -value : value;
  const formatted = absolute.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `Rp${formatted}`;
}

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

function validatePaymentAccountAvailability(
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

async function insertTransactionEffect(
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

async function getPaymentAccountForUpdate(
  tx: FinancialWriteTx,
  input: CreateBaseTransactionInput,
): Promise<Pick<PaymentAccountRow, "id" | "businessId" | "name" | "currentBalance"> | null> {
  if (!input.paymentAccountId) return null;

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

async function applyPaymentAccountEffect(
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

async function createInventoryRecord(
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

async function createAssetRecord(
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

async function createLiabilityRecord(
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

async function createReceivableRecord(
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

async function insertIncomeOrExpenseEffect(
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

async function resolveLiabilityForPayment(
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

async function resolveReceivableForPayment(
  tx: FinancialWriteTx,
  input: { businessId: string; targetName: string },
): Promise<ReceivableRow> {
  const rows = await tx
    .selectFrom("receivables")
    .selectAll()
    .where("businessId", "=", input.businessId)
    .where("status", "in", ["open", "partial"])
    .forUpdate()
    .execute();

  const normalizedTarget = normalizeTargetName(input.targetName);
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
    throw new AmbiguousFinancialTargetError("Ada lebih dari satu piutang yang cocok. Sebutkan target piutang yang lebih spesifik.");
  }

  return matches[0];
}

async function applyLiabilityPaymentEffect(
  tx: FinancialWriteTx,
  input: { transaction: TransactionRow; liability: LiabilityRow; amount: bigint; now: Date },
): Promise<void> {
  const beforeAmount = BigInt(input.liability.outstandingAmount);
  const originalAmount = BigInt(input.liability.originalAmount);
  if (input.amount > beforeAmount) {
    throw new FinancialTargetOverpaymentError("Jumlah pembayaran melebihi sisa utang.");
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

async function applyReceivablePaymentEffect(
  tx: FinancialWriteTx,
  input: { transaction: TransactionRow; receivable: ReceivableRow; amount: bigint; now: Date },
): Promise<void> {
  const beforeAmount = BigInt(input.receivable.outstandingAmount);
  const originalAmount = BigInt(input.receivable.originalAmount);
  if (input.amount > beforeAmount) {
    throw new FinancialTargetOverpaymentError("Jumlah pembayaran melebihi sisa piutang.");
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

async function createReversalTransactionInTransaction(
  tx: FinancialWriteTx,
  input: CreateBaseTransactionInput,
): Promise<TransactionRow> {
  const targetTransactionId = requireAffectedObject(input, "Transaksi yang mau dibalik harus disebutkan.");
  const now = new Date();
  const original = await tx
    .selectFrom("transactions")
    .selectAll()
    .where("id", "=", targetTransactionId)
    .where("businessId", "=", input.businessId)
    .forUpdate()
    .executeTakeFirst();

  if (!original) {
    throw new FinancialTargetNotFoundError("Transaksi yang mau dibalik tidak ditemukan.");
  }
  if (original.isReversal || original.type === "reversal") {
    throw new UnsafeReversalError("Transaksi pembalikan tidak bisa dibalik lagi.");
  }
  if (original.status === "reversed") {
    throw new UnsafeReversalError("Transaksi ini sudah pernah dibalik.");
  }

  const originalEffects = await tx
    .selectFrom("transaction_effects")
    .selectAll()
    .where("transactionId", "=", original.id)
    .where("businessId", "=", input.businessId)
    .execute();

  if (originalEffects.length === 0) {
    throw new UnsafeReversalError("Transaksi ini belum punya jejak efek yang bisa dibalik otomatis.");
  }

  const reversal = await tx
    .insertInto("transactions")
    .values({
      id: randomUUID(),
      businessId: input.businessId,
      confirmationRequestId: input.confirmationRequestId ?? null,
      parsedCommandId: input.parsedCommandId ?? null,
      paymentAccountId: original.paymentAccountId,
      type: "reversal",
      amount: original.amount,
      transactionDate: input.transactionDate,
      description: input.description.trim(),
      status: "confirmed",
      isReversal: true,
      reversedAt: null,
      createdAt: now,
      createdBy: input.createdBy,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  for (const effect of originalEffects) {
    const amount = BigInt(effect.amount);
    const beforeAmount = BigInt(effect.afterAmount);
    const afterAmount = BigInt(effect.beforeAmount);
    const direction = effect.direction === "increase" ? "decrease" : "increase";

    switch (effect.targetType) {
      case "payment_account": {
        const account = await tx
          .selectFrom("payment_accounts")
          .select(["id", "businessId", "currentBalance"])
          .where("id", "=", effect.targetId)
          .forUpdate()
          .executeTakeFirst();
        if (!account || account.businessId !== input.businessId) throw new InvalidPaymentAccountOwnershipError();
        const currentBalance = BigInt(account.currentBalance);
        const delta = direction === "increase" ? amount : -amount;
        const nextBalance = currentBalance + delta;
        if (nextBalance < 0n) throw new InsufficientPaymentAccountBalanceError();
        await tx
          .updateTable("payment_accounts")
          .set({ currentBalance: nextBalance.toString(), updatedAt: now })
          .where("id", "=", account.id)
          .executeTakeFirst();
        await insertTransactionEffect(tx, {
          transactionId: reversal.id,
          businessId: input.businessId,
          targetType: effect.targetType,
          targetId: effect.targetId,
          effectType: effect.effectType,
          direction,
          amount,
          beforeAmount: currentBalance,
          afterAmount: nextBalance,
          createdAt: now,
        });
        break;
      }
      case "inventory":
        await tx
          .updateTable("inventory_summaries")
          .set({ estimatedValue: afterAmount.toString(), status: afterAmount <= 0n ? "inactive" : "active", updatedAt: now, lastUpdatedAt: now })
          .where("id", "=", effect.targetId)
          .where("businessId", "=", input.businessId)
          .executeTakeFirst();
        await insertTransactionEffect(tx, {
          transactionId: reversal.id,
          businessId: input.businessId,
          targetType: effect.targetType,
          targetId: effect.targetId,
          effectType: effect.effectType,
          direction,
          amount,
          beforeAmount,
          afterAmount,
          createdAt: now,
        });
        break;
      case "asset":
        await tx
          .updateTable("asset_summaries")
          .set({ value: afterAmount.toString(), status: afterAmount <= 0n ? "inactive" : "active", updatedAt: now })
          .where("id", "=", effect.targetId)
          .where("businessId", "=", input.businessId)
          .executeTakeFirst();
        await insertTransactionEffect(tx, {
          transactionId: reversal.id,
          businessId: input.businessId,
          targetType: effect.targetType,
          targetId: effect.targetId,
          effectType: effect.effectType,
          direction,
          amount,
          beforeAmount,
          afterAmount,
          createdAt: now,
        });
        break;
      case "liability": {
        const liability = await tx
          .selectFrom("liabilities")
          .selectAll()
          .where("id", "=", effect.targetId)
          .where("businessId", "=", input.businessId)
          .forUpdate()
          .executeTakeFirst();
        if (!liability) throw new FinancialTargetNotFoundError("Utang terkait transaksi tidak ditemukan.");
        const currentOutstanding = BigInt(liability.outstandingAmount);
        if (effect.direction === "increase" && currentOutstanding !== BigInt(effect.afterAmount)) {
          throw new UnsafeReversalError("Utang ini sudah punya pembayaran, jadi transaksi awalnya belum bisa dibalik otomatis.");
        }
        const nextOutstanding = direction === "increase" ? currentOutstanding + amount : currentOutstanding - amount;
        if (nextOutstanding < 0n) throw new FinancialTargetOverpaymentError("Pembalikan membuat sisa utang negatif.");
        await tx
          .updateTable("liabilities")
          .set({
            outstandingAmount: nextOutstanding.toString(),
            status: statusFromOutstanding(BigInt(liability.originalAmount), nextOutstanding),
            updatedAt: now,
          })
          .where("id", "=", liability.id)
          .executeTakeFirst();
        await insertTransactionEffect(tx, {
          transactionId: reversal.id,
          businessId: input.businessId,
          targetType: effect.targetType,
          targetId: effect.targetId,
          effectType: effect.effectType,
          direction,
          amount,
          beforeAmount: currentOutstanding,
          afterAmount: nextOutstanding,
          createdAt: now,
        });
        break;
      }
      case "receivable": {
        const receivable = await tx
          .selectFrom("receivables")
          .selectAll()
          .where("id", "=", effect.targetId)
          .where("businessId", "=", input.businessId)
          .forUpdate()
          .executeTakeFirst();
        if (!receivable) throw new FinancialTargetNotFoundError("Piutang terkait transaksi tidak ditemukan.");
        const currentOutstanding = BigInt(receivable.outstandingAmount);
        if (effect.direction === "increase" && currentOutstanding !== BigInt(effect.afterAmount)) {
          throw new UnsafeReversalError("Piutang ini sudah punya pembayaran, jadi transaksi awalnya belum bisa dibalik otomatis.");
        }
        const nextOutstanding = direction === "increase" ? currentOutstanding + amount : currentOutstanding - amount;
        if (nextOutstanding < 0n) throw new FinancialTargetOverpaymentError("Pembalikan membuat sisa piutang negatif.");
        await tx
          .updateTable("receivables")
          .set({
            outstandingAmount: nextOutstanding.toString(),
            status: statusFromOutstanding(BigInt(receivable.originalAmount), nextOutstanding),
            updatedAt: now,
          })
          .where("id", "=", receivable.id)
          .executeTakeFirst();
        await insertTransactionEffect(tx, {
          transactionId: reversal.id,
          businessId: input.businessId,
          targetType: effect.targetType,
          targetId: effect.targetId,
          effectType: effect.effectType,
          direction,
          amount,
          beforeAmount: currentOutstanding,
          afterAmount: nextOutstanding,
          createdAt: now,
        });
        break;
      }
      default:
        await insertTransactionEffect(tx, {
          transactionId: reversal.id,
          businessId: input.businessId,
          targetType: effect.targetType,
          targetId: effect.targetId,
          effectType: effect.effectType,
          direction,
          amount,
          beforeAmount,
          afterAmount,
          createdAt: now,
        });
    }
  }

  await tx
    .updateTable("transactions")
    .set({ status: "reversed", reversedAt: now })
    .where("id", "=", original.id)
    .executeTakeFirst();

  await tx
    .insertInto("transaction_corrections")
    .values({
      id: randomUUID(),
      businessId: input.businessId,
      originalTransactionId: original.id,
      reversalTransactionId: reversal.id,
      reason: input.description.trim(),
      status: "applied",
      createdAt: now,
      createdBy: input.createdBy,
    })
    .executeTakeFirst();

  return reversal;
}

export async function createBaseTransactionInTransaction(
  tx: FinancialWriteTx,
  input: CreateBaseTransactionInput,
): Promise<TransactionRow> {
  validateBaseTransactionInput(input);

  if (input.type === "reversal") {
    return createReversalTransactionInTransaction(tx, input);
  }

  const now = new Date();
  const amount = BigInt(input.amount);
  const paymentAccount = await getPaymentAccountForUpdate(tx, input);
  validatePaymentAccountAvailability(input.type, amount, paymentAccount);
  const targetName = input.affectedObject?.trim();
  const liabilityForPayment =
    input.type === "liability_payment"
      ? await resolveLiabilityForPayment(tx, {
          businessId: input.businessId,
          targetName: requireAffectedObject(input, "Utang yang mau dibayar harus disebutkan."),
        })
      : null;
  const receivableForPayment =
    input.type === "receivable_payment"
      ? await resolveReceivableForPayment(tx, {
          businessId: input.businessId,
          targetName: requireAffectedObject(input, "Piutang yang dibayar harus disebutkan."),
        })
      : null;

  const transaction = await tx
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

  switch (input.type) {
    case "sales_income":
      await applyPaymentAccountEffect(tx, {
        transaction,
        paymentAccount,
        delta: amount,
        effectType: "payment_account_balance",
        now,
      });
      await insertIncomeOrExpenseEffect(tx, { transaction, effectType: "income", amount, now });
      break;
    case "general_expense":
      await applyPaymentAccountEffect(tx, {
        transaction,
        paymentAccount,
        delta: -amount,
        effectType: "payment_account_balance",
        now,
      });
      await insertIncomeOrExpenseEffect(tx, { transaction, effectType: "expense", amount, now });
      break;
    case "inventory_purchase_value":
      await applyPaymentAccountEffect(tx, {
        transaction,
        paymentAccount,
        delta: -amount,
        effectType: "payment_account_balance",
        now,
      });
      await createInventoryRecord(tx, {
        transaction,
        name: affectedObjectOrDescription(input),
        amount,
        now,
      });
      break;
    case "asset_record_or_purchase":
      if (paymentAccount) {
        await applyPaymentAccountEffect(tx, {
          transaction,
          paymentAccount,
          delta: -amount,
          effectType: "payment_account_balance",
          now,
        });
      }
      await createAssetRecord(tx, {
        transaction,
        name: affectedObjectOrDescription(input),
        amount,
        now,
      });
      break;
    case "liability_created":
      if (paymentAccount) {
        await applyPaymentAccountEffect(tx, {
          transaction,
          paymentAccount,
          delta: amount,
          effectType: "payment_account_balance",
          now,
        });
      }
      await createLiabilityRecord(tx, {
        transaction,
        lenderName: targetName || input.description.trim(),
        amount,
        now,
      });
      break;
    case "liability_payment":
      await applyPaymentAccountEffect(tx, {
        transaction,
        paymentAccount,
        delta: -amount,
        effectType: "payment_account_balance",
        now,
      });
      await applyLiabilityPaymentEffect(tx, {
        transaction,
        liability: liabilityForPayment!,
        amount,
        now,
      });
      break;
    case "receivable_created":
      await createReceivableRecord(tx, {
        transaction,
        customerName: targetName || input.description.trim(),
        amount,
        now,
      });
      await insertIncomeOrExpenseEffect(tx, { transaction, effectType: "income", amount, now });
      break;
    case "receivable_payment":
      await applyPaymentAccountEffect(tx, {
        transaction,
        paymentAccount,
        delta: amount,
        effectType: "payment_account_balance",
        now,
      });
      await applyReceivablePaymentEffect(tx, {
        transaction,
        receivable: receivableForPayment!,
        amount,
        now,
      });
      break;
    case "owner_capital_contribution":
      await applyPaymentAccountEffect(tx, {
        transaction,
        paymentAccount,
        delta: amount,
        effectType: "payment_account_balance",
        now,
      });
      await insertIncomeOrExpenseEffect(tx, { transaction, effectType: "owner_capital", amount, now });
      break;
    case "owner_withdrawal":
      await applyPaymentAccountEffect(tx, {
        transaction,
        paymentAccount,
        delta: -amount,
        effectType: "payment_account_balance",
        now,
      });
      await insertIncomeOrExpenseEffect(tx, { transaction, effectType: "owner_withdrawal", amount, now });
      break;
  }

  return transaction;
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

export interface ReceivableSummaryItem {
  id: string;
  customerName: string;
  originalAmount: number;
  outstandingAmount: number;
  status: "open" | "partial" | "paid";
  createdDate: string;
  sourceTransactionId: string;
}

export interface ReceivableSummaryResult {
  totalOriginalAmount: number;
  totalOutstandingAmount: number;
  items: ReceivableSummaryItem[];
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
      .selectFrom("inventory_summaries")
      .select(({ fn }) => [
        fn.sum<string>("estimatedValue").as("purchasedValue"),
        fn.max("lastUpdatedAt").as("lastUpdatedAt"),
      ])
      .where("businessId", "=", businessId)
      .where("status", "=", "active")
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
      .selectFrom("asset_summaries")
      .select([
        "id",
        "name",
        "value",
        "recordedDate",
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
      sourceTransactionId: row.sourceTransactionId ?? "unknown",
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

function liabilityStatusFromOutstanding(outstandingAmount: number, paidAmount: number): "open" | "partial" | "paid" {
  if (outstandingAmount <= 0) return "paid";
  if (paidAmount > 0) return "partial";
  return "open";
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
    sourceTransactionId: row.sourceTransactionId ?? "unknown",
  }));

  const openingDebtValue = toNumber(openingBalance?.debtValue ?? 0);
  if (openingDebtValue > 0) {
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
    outstandingAmount: toNumber(row.outstandingAmount),
    status: row.status,
    createdDate: row.createdDate,
    sourceTransactionId: row.sourceTransactionId ?? "unknown",
  }));

  const openingReceivableValue = toNumber(openingBalance?.receivableValue ?? 0);
  if (openingReceivableValue > 0) {
    const openingDate = openingBalance?.confirmedAt?.toISOString().slice(0, 10) ?? new Date().toISOString().slice(0, 10);
    items.push({
      id: "receivable-opening-balance",
      customerName: "Saldo awal piutang",
      originalAmount: openingReceivableValue,
      outstandingAmount: openingReceivableValue,
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

import { randomUUID } from "node:crypto";
import type { TransactionRow } from "../../lib/database.js";
import { runFinancialWrite, type FinancialWriteTx } from "../../lib/financial-write.js";
import { insertTransactionEffect } from "./transaction-effects.service.js";
import {
  FinancialTargetNotFoundError,
  FinancialTargetOverpaymentError,
  InsufficientPaymentAccountBalanceError,
  InvalidPaymentAccountOwnershipError,
  NoReversibleTransactionError,
  requireAffectedObject,
  statusFromOutstanding,
  UnsafeReversalError,
  type CreateBaseTransactionInput,
} from "./transaction-types.js";

export async function createReversalTransactionInTransaction(
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

export interface ReverseLatestTransactionInput {
  businessId: string;
  userId: string;
  reason?: string;
  transactionDate?: string;
}

export interface ReverseLatestTransactionResult {
  originalTransactionId: string;
  reversalTransactionId: string;
}

export async function reverseLatestTransactionForBusinessInTransaction(
  tx: FinancialWriteTx,
  input: ReverseLatestTransactionInput,
  createBaseTransactionInTransaction: (tx: FinancialWriteTx, input: CreateBaseTransactionInput) => Promise<TransactionRow>,
): Promise<ReverseLatestTransactionResult> {
  const latest = await tx
    .selectFrom("transactions")
    .select(["id", "amount", "transactionDate", "status", "isReversal", "type"])
    .where("businessId", "=", input.businessId)
    .where("status", "=", "confirmed")
    .where("isReversal", "=", false)
    .where("type", "!=", "reversal")
    .orderBy("transactionDate", "desc")
    .orderBy("createdAt", "desc")
    .forUpdate()
    .executeTakeFirst();

  if (!latest) {
    throw new NoReversibleTransactionError("Belum ada transaksi yang bisa di-undo.");
  }

  const reversal = await createBaseTransactionInTransaction(tx, {
    businessId: input.businessId,
    createdBy: input.userId,
    type: "reversal",
    amount: 1,
    transactionDate: input.transactionDate ?? new Date().toISOString().slice(0, 10),
    description: input.reason?.trim() || "Undo transaksi terakhir",
    affectedObject: latest.id,
    paymentAccountId: null,
  });

  return {
    originalTransactionId: latest.id,
    reversalTransactionId: reversal.id,
  };
}

export async function reverseLatestTransactionForBusiness(
  input: ReverseLatestTransactionInput,
  createBaseTransactionInTransaction: (tx: FinancialWriteTx, input: CreateBaseTransactionInput) => Promise<TransactionRow>,
): Promise<ReverseLatestTransactionResult> {
  return runFinancialWrite(async (tx) =>
    reverseLatestTransactionForBusinessInTransaction(tx, input, createBaseTransactionInTransaction),
  );
}

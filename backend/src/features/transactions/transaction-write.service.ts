import { randomUUID } from "node:crypto";
import type { TransactionRow } from "../../lib/database.js";
import { runFinancialWrite, type FinancialWriteTx } from "../../lib/financial-write.js";
import {
  InvalidAccountTransferError,
  affectedObjectOrDescription,
  requireAffectedObject,
  validateBaseTransactionInput,
  type CreateBaseTransactionInput,
} from "./transaction-types.js";
import {
  applyLiabilityPaymentEffect,
  applyPaymentAccountEffect,
  applyReceivablePaymentEffects,
  createAssetRecord,
  createInventoryRecord,
  createLiabilityRecord,
  createReceivableRecord,
  getPaymentAccountByIdForUpdate,
  getPaymentAccountForUpdate,
  insertIncomeOrExpenseEffect,
  resolveLiabilityForPayment,
  resolveReceivablesForPayment,
  validatePaymentAccountAvailability,
} from "./transaction-effects.service.js";
import { createReversalTransactionInTransaction } from "./reversal.service.js";
import { FinancialTargetNotFoundError, normalizeTargetName } from "./transaction-types.js";

function parseMenuAliases(aliases: unknown): string[] {
  if (Array.isArray(aliases)) return aliases.filter((alias): alias is string => typeof alias === "string");
  if (typeof aliases !== "string") return [];

  try {
    const parsed = JSON.parse(aliases) as unknown;
    return Array.isArray(parsed) ? parsed.filter((alias): alias is string => typeof alias === "string") : [];
  } catch {
    return [];
  }
}

async function validateSalesCatalogItem(tx: FinancialWriteTx, input: CreateBaseTransactionInput): Promise<void> {
  if (input.type !== "sales_income") return;

  const targetNames = input.salesOrder?.lines.length
    ? input.salesOrder.lines.map((line) => line.productName.trim()).filter(Boolean)
    : input.affectedObject?.trim()
      ? [input.affectedObject.trim()]
      : [];

  if (targetNames.length === 0) {
    throw new FinancialTargetNotFoundError("Menu yang dijual harus dipilih dari katalog.");
  }

  const menuItems = await tx
    .selectFrom("menu_items")
    .select(["name", "aliases"])
    .where("businessId", "=", input.businessId)
    .where("status", "=", "active")
    .execute();

  const matchedNames = targetNames.every((targetName) => {
    const normalizedTarget = normalizeTargetName(targetName);
    return menuItems.some((item) => {
    const aliases = parseMenuAliases(item.aliases);
    const candidates = [item.name, ...aliases].map(normalizeTargetName);
    return candidates.includes(normalizedTarget);
  });
  });

  if (!matchedNames) {
    throw new FinancialTargetNotFoundError("Menu yang dijual belum ada di katalog. Buat menu dulu di Katalog, lalu catat penjualan lagi.");
  }
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
  const destinationPaymentAccount =
    input.type === "account_transfer" && input.destinationPaymentAccountId
      ? await getPaymentAccountByIdForUpdate(tx, {
          businessId: input.businessId,
          paymentAccountId: input.destinationPaymentAccountId,
        })
      : null;

  if (input.type === "account_transfer") {
    if (!input.destinationPaymentAccountId || !destinationPaymentAccount) {
      throw new InvalidAccountTransferError("Akun tujuan transfer harus dipilih.");
    }
    if (input.paymentAccountId === input.destinationPaymentAccountId) {
      throw new InvalidAccountTransferError();
    }
  }

  validatePaymentAccountAvailability(input.type, amount, paymentAccount);
  await validateSalesCatalogItem(tx, input);
  const targetName = input.affectedObject?.trim();
  const liabilityForPayment =
    input.type === "liability_payment"
      ? await resolveLiabilityForPayment(tx, {
          businessId: input.businessId,
          targetName: requireAffectedObject(input, "Utang yang mau dibayar harus disebutkan."),
        })
      : null;
  const receivablesForPayment =
    input.type === "receivable_payment"
      ? await resolveReceivablesForPayment(tx, {
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
      await applyReceivablePaymentEffects(tx, {
        transaction,
        receivables: receivablesForPayment!,
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
    case "account_transfer":
      await applyPaymentAccountEffect(tx, {
        transaction,
        paymentAccount,
        delta: -amount,
        effectType: "account_transfer",
        now,
      });
      await applyPaymentAccountEffect(tx, {
        transaction,
        paymentAccount: destinationPaymentAccount,
        delta: amount,
        effectType: "account_transfer",
        now,
      });
      break;
  }

  return transaction;
}

export async function createBaseTransaction(input: CreateBaseTransactionInput): Promise<TransactionRow> {
  validateBaseTransactionInput(input);
  return runFinancialWrite(async (tx) => createBaseTransactionInTransaction(tx, input));
}

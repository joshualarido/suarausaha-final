import { randomUUID } from "node:crypto";
import { runFinancialWrite } from "../../lib/financial-write.js";
import type { TransactionRow } from "../../lib/database.js";
import type { FinancialWriteTx } from "../../lib/financial-write.js";

export type TransactionType =
  | "sales_income"
  | "general_expense"
  | "inventory_purchase_value"
  | "asset_record_or_purchase"
  | "liability_created"
  | "liability_payment"
  | "receivable_created"
  | "receivable_payment"
  | "owner_capital_contribution"
  | "owner_withdrawal"
  | "reversal";

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

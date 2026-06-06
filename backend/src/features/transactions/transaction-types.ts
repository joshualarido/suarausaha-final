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
  "account_transfer",
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
  destinationPaymentAccountId?: string | null;
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

export class InvalidAccountTransferError extends Error {
  constructor(message = "Akun asal dan tujuan transfer harus berbeda.") {
    super(message);
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

export class NoReversibleTransactionError extends Error {
  constructor(message = "Belum ada transaksi yang bisa dibalik.") {
    super(message);
  }
}

export function validateBaseTransactionInput(input: CreateBaseTransactionInput): void {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new InvalidTransactionAmountError();
  }

  if (!input.description.trim()) {
    throw new Error("Transaction description is required.");
  }
}

export function normalizeTargetName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function affectedObjectOrDescription(input: CreateBaseTransactionInput): string {
  return input.affectedObject?.trim() || input.description.trim();
}

export function requireAffectedObject(input: CreateBaseTransactionInput, message: string): string {
  const target = input.affectedObject?.trim();
  if (!target) throw new MissingAffectedObjectError(message);
  return target;
}

export function statusFromOutstanding(originalAmount: bigint, outstandingAmount: bigint): "open" | "partial" | "paid" {
  if (outstandingAmount <= 0n) return "paid";
  if (outstandingAmount < originalAmount) return "partial";
  return "open";
}

export function formatIdrFromBigInt(value: bigint): string {
  const absolute = value < 0n ? -value : value;
  const formatted = absolute.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `Rp${formatted}`;
}

export function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

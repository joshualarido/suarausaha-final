import { randomUUID } from "node:crypto";
import { db, type ConfirmationRequestRow } from "../../lib/database.js";
import { runFinancialWrite, type FinancialWriteTx } from "../../lib/financial-write.js";
import {
  createBaseTransactionInTransaction,
  AmbiguousFinancialTargetError,
  FinancialTargetNotFoundError,
  FinancialTargetOverpaymentError,
  InsufficientPaymentAccountBalanceError,
  InvalidPaymentAccountOwnershipError,
  InvalidAccountTransferError,
  MissingAffectedObjectError,
  MissingPaymentAccountForTransactionError,
  UnsafeReversalError,
  type TransactionType,
} from "../transactions/transaction.service.js";
import { parseProposedActionJson, toConfirmationResponseDto } from "../transactions/transaction-dto.mapper.js";
import type { ProposedAction } from "../parser/parser.types.js";
import { createNeracaReportInTransaction, type NeracaSnapshotData } from "../neraca/neraca.service.js";

const CONFIRMATION_TTL_MS = 15 * 60 * 1000;
export type ConfirmationStateErrorCode =
  | "CONFIRMATION_NOT_USABLE"
  | "INSUFFICIENT_BALANCE"
  | "PAYMENT_ACCOUNT_REQUIRED"
  | "PAYMENT_ACCOUNT_INVALID"
  | "TARGET_REQUIRED"
  | "TARGET_NOT_FOUND"
  | "TARGET_AMBIGUOUS"
  | "PAYMENT_AMOUNT_INVALID"
  | "REVERSAL_NOT_ALLOWED";

export class ConfirmationNotFoundError extends Error {
  constructor() {
    super("Confirmation request not found.");
  }
}

export class InvalidConfirmationStateError extends Error {
  code: ConfirmationStateErrorCode;

  constructor(message = "Confirmation request cannot be used.", code: ConfirmationStateErrorCode = "CONFIRMATION_NOT_USABLE") {
    super(message);
    this.code = code;
  }
}

export interface CreateConfirmationRequestInput {
  businessId: string;
  userId: string;
  parsedCommandId: string | null;
  proposedAction: ProposedAction;
}

export interface CreateNeracaConfirmationRequestInput {
  businessId: string;
  userId: string;
  parsedCommandId: string | null;
  reportDate: string;
  preview: NeracaSnapshotData;
}

export interface ConfirmConfirmationRequestInput {
  businessId: string;
  userId: string;
  confirmationRequestId: string;
}

export type ConfirmationNotification =
  | {
      kind: "transaction";
      title: string;
      actionLabel: string;
      amount: number;
      date: string;
      paymentAccountName?: string;
      destinationPaymentAccountName?: string;
      affectedObject?: string;
      description: string;
    }
  | {
      kind: "neraca_report";
      title: string;
      reportDate: string;
      totalAktiva: number;
      totalPasiva: number;
      reconciliationStatus: string;
    };

export async function listPendingIntentConfirmations(input: {
  businessId: string;
  userId: string;
  limit?: number;
}): Promise<ConfirmationRequestRow[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 50, 200));

  return db
    .selectFrom("confirmation_requests")
    .selectAll()
    .where("businessId", "=", input.businessId)
    .where("userId", "=", input.userId)
    .where("status", "=", "pending")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .execute();
}

export interface EditConfirmationRequestInput extends ConfirmConfirmationRequestInput {
  patch: Partial<
    Pick<
      ProposedAction,
      | "intent"
      | "amount"
      | "date"
      | "paymentAccountId"
      | "paymentAccountName"
      | "destinationPaymentAccountId"
      | "destinationPaymentAccountName"
      | "affectedObject"
      | "description"
    >
  >;
}

export async function cancelPendingConfirmationsInTransaction(
  tx: FinancialWriteTx,
  input: { businessId: string; userId: string },
): Promise<number> {
  const pending = await tx
    .selectFrom("confirmation_requests")
    .select(["id"])
    .where("businessId", "=", input.businessId)
    .where("userId", "=", input.userId)
    .where("status", "=", "pending")
    .execute();

  if (pending.length === 0) {
    return 0;
  }

  await tx
    .updateTable("confirmation_requests")
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      "id",
      "in",
      pending.map((row) => row.id),
    )
    .executeTakeFirst();

  return pending.length;
}

function expiresAtFrom(now: Date): Date {
  return new Date(now.getTime() + CONFIRMATION_TTL_MS);
}

function summaryFor(action: ProposedAction): string {
  const amount = action.amount.toLocaleString("id-ID");
  const labels: Record<ProposedAction["intent"], string> = {
    sales_income: "Catat pemasukan penjualan",
    general_expense: "Catat biaya usaha",
    inventory_purchase_value: "Catat pembelian stok",
    asset_record_or_purchase: "Catat aset usaha",
    liability_created: "Catat utang baru",
    liability_payment: "Catat pembayaran utang",
    receivable_created: "Catat piutang baru",
    receivable_payment: "Catat pembayaran piutang",
    owner_capital_contribution: "Catat modal pemilik",
    owner_withdrawal: "Catat ambil uang usaha",
    account_transfer: "Catat transfer antar akun",
    reversal: "Catat pembalikan transaksi",
  };

  return `${labels[action.intent]} Rp${amount}`;
}

function summaryForNeraca(reportDate: string): string {
  return `Buat laporan neraca per ${reportDate}`;
}

function parseNeracaPayload(value: unknown): { reportDate: string } {
  const payload = typeof value === "string" ? JSON.parse(value) : value;
  if (payload && typeof payload === "object" && "reportDate" in payload && typeof payload.reportDate === "string") {
    return { reportDate: payload.reportDate };
  }
  return { reportDate: new Date().toISOString().slice(0, 10) };
}

function parseAction(value: unknown): ProposedAction {
  return parseProposedActionJson(value);
}

function formatIdr(amount: number): string {
  return `Rp${amount.toLocaleString("id-ID")}`;
}

function rebuildExpectedEffects(action: ProposedAction): string[] {
  const amount = formatIdr(action.amount);
  const accountName = action.paymentAccountName ?? "Kas";
  switch (action.intent) {
    case "sales_income":
      return [`${accountName} bertambah ${amount}`, `Pendapatan bertambah ${amount}`];
    case "owner_capital_contribution":
      return [`${accountName} bertambah ${amount}`, `Modal pemilik bertambah ${amount}`];
    case "inventory_purchase_value":
      return [`${accountName} berkurang ${amount}`, `Nilai persediaan bertambah ${amount}`];
    case "asset_record_or_purchase":
      return [`Aset usaha bertambah ${amount}`, `${accountName} dapat berkurang ${amount} jika ini pembelian tunai`];
    case "liability_created":
      return action.paymentAccountId
        ? [`${accountName} bertambah ${amount}`, `Utang ${action.affectedObject ?? ""}`.trim() + ` bertambah ${amount}`]
        : [`Utang ${action.affectedObject ?? ""}`.trim() + ` bertambah ${amount}`];
    case "liability_payment":
      return [`${accountName} berkurang ${amount}`, `Utang ${action.affectedObject ?? ""}`.trim() + ` berkurang ${amount}`];
    case "receivable_created":
      return [`Piutang ${action.affectedObject ?? ""}`.trim() + ` bertambah ${amount}`, `Pendapatan bertambah ${amount}`];
    case "receivable_payment":
      return [`${accountName} bertambah ${amount}`, `Piutang ${action.affectedObject ?? ""}`.trim() + ` berkurang ${amount}`];
    case "owner_withdrawal":
      return [`${accountName} berkurang ${amount}`, `Prive bertambah ${amount}`];
    case "account_transfer":
      return [`${accountName} berkurang ${amount}`, `${action.destinationPaymentAccountName ?? "Akun tujuan"} bertambah ${amount}`];
    case "reversal":
      return [`Pembalikan transaksi sebesar ${amount}`];
    case "general_expense":
    default:
      return [`${accountName} berkurang ${amount}`, `Biaya bertambah ${amount}`];
  }
}

export function buildTransactionConfirmationNotification(action: ProposedAction): ConfirmationNotification {
  const actionLabels: Record<ProposedAction["intent"], string> = {
    sales_income: "Penjualan",
    general_expense: "Biaya usaha",
    inventory_purchase_value: "Pembelian stok",
    asset_record_or_purchase: "Aset usaha",
    liability_created: "Utang baru",
    liability_payment: "Pembayaran utang",
    receivable_created: "Piutang baru",
    receivable_payment: "Pembayaran piutang",
    owner_capital_contribution: "Modal pemilik",
    owner_withdrawal: "Ambil uang usaha",
    account_transfer: "Transfer antar akun",
    reversal: "Pembalikan transaksi",
  };

  return {
    kind: "transaction",
    title: "Transaksi disimpan",
    actionLabel: actionLabels[action.intent],
    amount: action.amount,
    date: action.date,
    ...(action.paymentAccountName ? { paymentAccountName: action.paymentAccountName } : {}),
    ...(action.destinationPaymentAccountName ? { destinationPaymentAccountName: action.destinationPaymentAccountName } : {}),
    ...(action.affectedObject ? { affectedObject: action.affectedObject } : {}),
    description: action.description,
  };
}

export function buildNeracaConfirmationNotification(report: {
  reportDate: string;
  totalAktiva: string | number;
  totalPasiva: string | number;
  reconciliationStatus: string;
}): ConfirmationNotification {
  return {
    kind: "neraca_report",
    title: "Laporan disimpan",
    reportDate: report.reportDate,
    totalAktiva: Number(report.totalAktiva),
    totalPasiva: Number(report.totalPasiva),
    reconciliationStatus: report.reconciliationStatus,
  };
}

function toConfirmationStateError(error: unknown): InvalidConfirmationStateError | null {
  if (error instanceof MissingPaymentAccountForTransactionError) {
    return new InvalidConfirmationStateError(error.message, "PAYMENT_ACCOUNT_REQUIRED");
  }
  if (error instanceof InsufficientPaymentAccountBalanceError) {
    return new InvalidConfirmationStateError(error.message, "INSUFFICIENT_BALANCE");
  }
  if (error instanceof InvalidPaymentAccountOwnershipError) {
    return new InvalidConfirmationStateError(error.message, "PAYMENT_ACCOUNT_INVALID");
  }
  if (error instanceof InvalidAccountTransferError) {
    return new InvalidConfirmationStateError(error.message, "PAYMENT_ACCOUNT_INVALID");
  }
  if (error instanceof MissingAffectedObjectError) {
    return new InvalidConfirmationStateError(error.message, "TARGET_REQUIRED");
  }
  if (error instanceof FinancialTargetNotFoundError) {
    return new InvalidConfirmationStateError(error.message, "TARGET_NOT_FOUND");
  }
  if (error instanceof AmbiguousFinancialTargetError) {
    return new InvalidConfirmationStateError(error.message, "TARGET_AMBIGUOUS");
  }
  if (error instanceof FinancialTargetOverpaymentError) {
    return new InvalidConfirmationStateError(error.message, "PAYMENT_AMOUNT_INVALID");
  }
  if (error instanceof UnsafeReversalError) {
    return new InvalidConfirmationStateError(error.message, "REVERSAL_NOT_ALLOWED");
  }

  return null;
}

async function findConfirmationForUpdate(
  tx: FinancialWriteTx,
  input: ConfirmConfirmationRequestInput,
): Promise<ConfirmationRequestRow> {
  const confirmation = await tx
    .selectFrom("confirmation_requests")
    .selectAll()
    .where("id", "=", input.confirmationRequestId)
    .where("businessId", "=", input.businessId)
    .where("userId", "=", input.userId)
    .forUpdate()
    .executeTakeFirst();

  if (!confirmation) {
    throw new ConfirmationNotFoundError();
  }

  return confirmation;
}

async function expireConfirmation(
  tx: FinancialWriteTx,
  confirmation: ConfirmationRequestRow,
): Promise<ConfirmationRequestRow> {
  return tx
    .updateTable("confirmation_requests")
    .set({
      status: "expired",
      updatedAt: new Date(),
    })
    .where("id", "=", confirmation.id)
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function createConfirmationRequest(
  tx: FinancialWriteTx,
  input: CreateConfirmationRequestInput,
): Promise<ConfirmationRequestRow> {
  const now = new Date();
  await cancelPendingConfirmationsInTransaction(tx, {
    businessId: input.businessId,
    userId: input.userId,
  });

  return tx
    .insertInto("confirmation_requests")
    .values({
      id: randomUUID(),
      businessId: input.businessId,
      userId: input.userId,
      parsedCommandId: input.parsedCommandId,
      type: "transaction",
      status: "pending",
      proposedActionJson: JSON.stringify(input.proposedAction),
      summaryText: summaryFor(input.proposedAction),
      warningText: input.proposedAction.warning,
      expectedEffectsJson: JSON.stringify(input.proposedAction.expectedEffects),
      expiresAt: expiresAtFrom(now),
      confirmedAt: null,
      cancelledAt: null,
      resultingTransactionId: null,
      resultingNeracaReportId: null,
      createdAt: now,
      updatedAt: now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function createNeracaConfirmationRequest(
  tx: FinancialWriteTx,
  input: CreateNeracaConfirmationRequestInput,
): Promise<ConfirmationRequestRow> {
  const now = new Date();
  await cancelPendingConfirmationsInTransaction(tx, {
    businessId: input.businessId,
    userId: input.userId,
  });

  return tx
    .insertInto("confirmation_requests")
    .values({
      id: randomUUID(),
      businessId: input.businessId,
      userId: input.userId,
      parsedCommandId: input.parsedCommandId,
      type: "neraca_report",
      status: "pending",
      proposedActionJson: JSON.stringify({
        kind: "neraca_report",
        reportDate: input.reportDate,
        preview: input.preview,
      }),
      summaryText: summaryForNeraca(input.reportDate),
      warningText: input.preview.warningText,
      expectedEffectsJson: JSON.stringify([
        "Backend menghitung neraca dari data yang sudah dikonfirmasi.",
        "Laporan disimpan sebagai snapshot dan tidak berubah setelah dibuat.",
      ]),
      expiresAt: expiresAtFrom(now),
      confirmedAt: null,
      cancelledAt: null,
      resultingTransactionId: null,
      resultingNeracaReportId: null,
      createdAt: now,
      updatedAt: now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function getConfirmationRequestForUser(input: ConfirmConfirmationRequestInput): Promise<ConfirmationRequestRow> {
  const confirmation = await db
    .selectFrom("confirmation_requests")
    .selectAll()
    .where("id", "=", input.confirmationRequestId)
    .where("businessId", "=", input.businessId)
    .where("userId", "=", input.userId)
    .executeTakeFirst();

  if (!confirmation) {
    throw new ConfirmationNotFoundError();
  }

  return confirmation;
}

export async function cancelConfirmationRequest(
  input: ConfirmConfirmationRequestInput,
): Promise<ConfirmationRequestRow> {
  const result = await runFinancialWrite(async (tx) => {
    const confirmation = await findConfirmationForUpdate(tx, input);

    if (confirmation.status === "confirmed") {
      throw new InvalidConfirmationStateError("Confirmation request is already confirmed.");
    }

    if (confirmation.status === "cancelled") {
      return {
        state: "cancelled" as const,
        confirmation,
      };
    }

    if (confirmation.status === "expired") {
      return {
        state: "expired" as const,
        confirmation,
      };
    }

    if (confirmation.expiresAt <= new Date()) {
      await expireConfirmation(tx, confirmation);
      return {
        state: "expired" as const,
        confirmation,
      };
    }

    const cancelled = await tx
      .updateTable("confirmation_requests")
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        updatedAt: new Date(),
      })
      .where("id", "=", confirmation.id)
      .returningAll()
      .executeTakeFirstOrThrow();

    return {
      state: "cancelled" as const,
      confirmation: cancelled,
    };
  });

  if (result.state === "expired") {
    throw new InvalidConfirmationStateError("Confirmation request is expired.");
  }

  return result.confirmation;
}

export async function confirmConfirmationRequest(
  input: ConfirmConfirmationRequestInput,
): Promise<{
  transactionId?: string;
  neracaReportId?: string;
  message: string;
  type: "transaction" | "neraca_report";
  notification?: ConfirmationNotification;
}> {
  const result = await runFinancialWrite(async (tx) => {
    const confirmation = await findConfirmationForUpdate(tx, input);

    if (confirmation.status === "confirmed") {
      if (confirmation.type === "neraca_report") {
        if (!confirmation.resultingNeracaReportId) {
          throw new InvalidConfirmationStateError("Confirmed request is missing neraca report reference.");
        }

        return {
          state: "confirmed" as const,
          type: "neraca_report" as const,
          neracaReportId: confirmation.resultingNeracaReportId,
          message: "Laporan neraca sudah pernah disimpan.",
        };
      }

      if (!confirmation.resultingTransactionId) {
        throw new InvalidConfirmationStateError("Confirmed request is missing transaction reference.");
      }

      return {
        state: "confirmed" as const,
        type: "transaction" as const,
        transactionId: confirmation.resultingTransactionId,
        message: "Transaksi sudah pernah disimpan.",
      };
    }

    if (confirmation.status === "cancelled" || confirmation.status === "expired" || confirmation.status === "failed") {
      throw new InvalidConfirmationStateError("Confirmation request cannot be confirmed.");
    }

    if (confirmation.expiresAt <= new Date()) {
      await expireConfirmation(tx, confirmation);
      return {
        state: "expired" as const,
      };
    }

    if (confirmation.type === "neraca_report") {
      const payload = parseNeracaPayload(confirmation.proposedActionJson);
      const report = await createNeracaReportInTransaction(tx, {
        businessId: input.businessId,
        userId: input.userId,
        reportDate: payload.reportDate,
        confirmationRequestId: confirmation.id,
      });

      await tx
        .updateTable("confirmation_requests")
        .set({
          status: "confirmed",
          confirmedAt: new Date(),
          resultingNeracaReportId: report.id,
          updatedAt: new Date(),
        })
        .where("id", "=", confirmation.id)
        .executeTakeFirst();

      return {
        state: "confirmed" as const,
        type: "neraca_report" as const,
        neracaReportId: report.id,
        message: "Laporan neraca berhasil disimpan.",
        notification: buildNeracaConfirmationNotification(report),
      };
    }

    const proposedAction = parseAction(confirmation.proposedActionJson);
    let transaction;
    try {
      transaction = await createBaseTransactionInTransaction(tx, {
        businessId: input.businessId,
        createdBy: input.userId,
        type: proposedAction.intent as TransactionType,
        amount: proposedAction.amount,
        transactionDate: proposedAction.date,
        description: proposedAction.description,
        affectedObject: proposedAction.affectedObject,
        paymentAccountId: proposedAction.paymentAccountId,
        destinationPaymentAccountId: proposedAction.destinationPaymentAccountId,
        salesOrder: proposedAction.salesOrder,
        confirmationRequestId: confirmation.id,
        parsedCommandId: confirmation.parsedCommandId,
      });
    } catch (error) {
      const confirmationStateError = toConfirmationStateError(error);
      if (confirmationStateError) {
        throw confirmationStateError;
      }
      throw error;
    }

    await tx
      .updateTable("confirmation_requests")
      .set({
        status: "confirmed",
        confirmedAt: new Date(),
        resultingTransactionId: transaction.id,
        updatedAt: new Date(),
      })
      .where("id", "=", confirmation.id)
      .executeTakeFirst();

    return {
      state: "confirmed" as const,
      type: "transaction" as const,
      transactionId: transaction.id,
      message: "Transaksi berhasil disimpan.",
      notification: buildTransactionConfirmationNotification(proposedAction),
    };
  });

  if (result.state === "expired") {
    throw new InvalidConfirmationStateError("Confirmation request is expired.");
  }

  return {
    type: result.type,
    transactionId: result.transactionId,
    neracaReportId: result.neracaReportId,
    message: result.message,
    notification: result.notification,
  };
}

export async function editConfirmationRequest(input: EditConfirmationRequestInput): Promise<ConfirmationRequestRow> {
  const result = await runFinancialWrite(async (tx) => {
    const confirmation = await findConfirmationForUpdate(tx, input);

    if (confirmation.status !== "pending") {
      throw new InvalidConfirmationStateError("Only pending confirmations can be edited.");
    }

    if (confirmation.type !== "transaction") {
      throw new InvalidConfirmationStateError("Konfirmasi laporan neraca tidak bisa diedit.");
    }

    if (confirmation.expiresAt <= new Date()) {
      await expireConfirmation(tx, confirmation);
      return {
        state: "expired" as const,
      };
    }

    const proposedAction = parseAction({
      ...parseAction(confirmation.proposedActionJson),
      ...input.patch,
      expectedEffects: rebuildExpectedEffects({
        ...parseAction(confirmation.proposedActionJson),
        ...input.patch,
      }),
      warning: "Perubahan dari edit konfirmasi. Periksa lagi sebelum disimpan.",
    });

    await tx
      .updateTable("confirmation_requests")
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        updatedAt: new Date(),
      })
      .where("id", "=", confirmation.id)
      .returningAll()
      .executeTakeFirstOrThrow();

    const edited = await createConfirmationRequest(tx, {
      businessId: input.businessId,
      userId: input.userId,
      parsedCommandId: confirmation.parsedCommandId,
      proposedAction,
    });

    return {
      state: "edited" as const,
      confirmation: edited,
    };
  });

  if (result.state === "expired") {
    throw new InvalidConfirmationStateError("Confirmation request is expired.");
  }

  return result.confirmation;
}

export function toConfirmationResponse(confirmation: ConfirmationRequestRow) {
  return toConfirmationResponseDto(confirmation);
}

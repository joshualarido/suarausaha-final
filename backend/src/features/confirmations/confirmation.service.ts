import { randomUUID } from "node:crypto";
import { db, ensureDatabaseSchema, type ConfirmationRequestRow } from "../../lib/database.js";
import { runFinancialWrite, type FinancialWriteTx } from "../../lib/financial-write.js";
import {
  createBaseTransactionInTransaction,
  type TransactionType,
} from "../transactions/transaction.service.js";
import { proposedActionSchema, type ProposedAction } from "../parser/parser.types.js";

const CONFIRMATION_TTL_MS = 15 * 60 * 1000;

export class ConfirmationNotFoundError extends Error {
  constructor() {
    super("Confirmation request not found.");
  }
}

export class InvalidConfirmationStateError extends Error {
  constructor(message = "Confirmation request cannot be used.") {
    super(message);
  }
}

export interface CreateConfirmationRequestInput {
  businessId: string;
  userId: string;
  parsedCommandId: string | null;
  proposedAction: ProposedAction;
}

export interface ConfirmConfirmationRequestInput {
  businessId: string;
  userId: string;
  confirmationRequestId: string;
}

export async function listPendingIntentConfirmations(input: {
  businessId: string;
  userId: string;
  limit?: number;
}): Promise<ConfirmationRequestRow[]> {
  await ensureDatabaseSchema();

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
  patch: Partial<Pick<ProposedAction, "amount" | "date" | "paymentAccountId" | "paymentAccountName" | "description">>;
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
    reversal: "Catat pembalikan transaksi",
  };

  return `${labels[action.intent]} Rp${amount}`;
}

function parseAction(value: unknown): ProposedAction {
  return proposedActionSchema.parse(value);
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
      createdAt: now,
      updatedAt: now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function getConfirmationRequestForUser(input: ConfirmConfirmationRequestInput): Promise<ConfirmationRequestRow> {
  await ensureDatabaseSchema();

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
): Promise<{ transactionId: string; message: string }> {
  const result = await runFinancialWrite(async (tx) => {
    const confirmation = await findConfirmationForUpdate(tx, input);

    if (confirmation.status === "confirmed") {
      if (!confirmation.resultingTransactionId) {
        throw new InvalidConfirmationStateError("Confirmed request is missing transaction reference.");
      }

      return {
        state: "confirmed" as const,
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

    const proposedAction = parseAction(confirmation.proposedActionJson);
    const transaction = await createBaseTransactionInTransaction(tx, {
      businessId: input.businessId,
      createdBy: input.userId,
      type: proposedAction.intent as TransactionType,
      amount: proposedAction.amount,
      transactionDate: proposedAction.date,
      description: proposedAction.description,
      paymentAccountId: proposedAction.paymentAccountId,
      confirmationRequestId: confirmation.id,
      parsedCommandId: confirmation.parsedCommandId,
    });

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
      transactionId: transaction.id,
      message: "Transaksi berhasil disimpan.",
    };
  });

  if (result.state === "expired") {
    throw new InvalidConfirmationStateError("Confirmation request is expired.");
  }

  return {
    transactionId: result.transactionId,
    message: result.message,
  };
}

export async function editConfirmationRequest(input: EditConfirmationRequestInput): Promise<ConfirmationRequestRow> {
  const result = await runFinancialWrite(async (tx) => {
    const confirmation = await findConfirmationForUpdate(tx, input);

    if (confirmation.status !== "pending") {
      throw new InvalidConfirmationStateError("Only pending confirmations can be edited.");
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
  return {
    id: confirmation.id,
    status: confirmation.status,
    proposedAction: confirmation.proposedActionJson,
    summaryText: confirmation.summaryText,
    warningText: confirmation.warningText,
    expectedEffects: confirmation.expectedEffectsJson,
    expiresAt: confirmation.expiresAt,
    confirmedAt: confirmation.confirmedAt,
    cancelledAt: confirmation.cancelledAt,
    resultingTransactionId: confirmation.resultingTransactionId,
  };
}

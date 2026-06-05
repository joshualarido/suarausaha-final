import type { ConfirmationRequestRow, TransactionRow } from "../../lib/database.js";
import { proposedActionSchema, type ProposedAction } from "../parser/parser.types.js";
import type { TransactionType } from "./transaction-types.js";

export interface PaymentAccountDto {
  id: string;
  name: string;
}

export type TransactionHistoryStatus = "confirmed" | "reversed" | "reversal";

export function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  return null;
}

export function parseJsonStringArray(value: unknown): string[] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

export function parseProposedActionJson(value: unknown): ProposedAction {
  const payload = parseJsonObject(value);
  return proposedActionSchema.parse(payload ?? value);
}

export function extractAffectedObject(proposedActionJson: unknown): string | null {
  const payload = parseJsonObject(proposedActionJson);
  const affectedObject = payload?.affectedObject;
  return typeof affectedObject === "string" && affectedObject.trim() ? affectedObject.trim() : null;
}

export function toPaymentAccountDto(id: string | null, name: string | null): PaymentAccountDto | null {
  return id && name ? { id, name } : null;
}

export function toTransactionHistoryStatus(
  type: string | TransactionType,
  status: TransactionRow["status"],
  isReversal: boolean,
): TransactionHistoryStatus {
  if (type === "reversal" || isReversal) return "reversal";
  return status;
}

export function toConfirmationResponseDto(confirmation: ConfirmationRequestRow) {
  const proposedPayload = parseJsonObject(confirmation.proposedActionJson);
  const isNeracaReport = confirmation.type === "neraca_report";

  return {
    id: confirmation.id,
    type: confirmation.type,
    status: confirmation.status,
    proposedAction: isNeracaReport ? null : parseProposedActionJson(confirmation.proposedActionJson),
    proposedNeracaReport: isNeracaReport ? proposedPayload : null,
    summaryText: confirmation.summaryText,
    warningText: confirmation.warningText,
    expectedEffects: parseJsonStringArray(confirmation.expectedEffectsJson),
    expiresAt: confirmation.expiresAt,
    confirmedAt: confirmation.confirmedAt,
    cancelledAt: confirmation.cancelledAt,
    resultingTransactionId: confirmation.resultingTransactionId,
    resultingNeracaReportId: confirmation.resultingNeracaReportId,
  };
}

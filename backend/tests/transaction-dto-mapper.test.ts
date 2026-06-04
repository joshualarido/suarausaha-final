import { describe, expect, it } from "vitest";
import { extractAffectedObject, parseProposedActionJson, toConfirmationResponseDto } from "../src/features/transactions/transaction-dto.mapper.js";
import type { ConfirmationRequestRow } from "../src/lib/database.js";

const proposedAction = {
  intent: "general_expense",
  amount: 75000,
  date: "2026-06-02",
  paymentAccountId: "acct_cash",
  paymentAccountName: "Kas",
  description: "Beli gas",
  affectedObject: "Gas LPG",
  expectedEffects: ["Kas berkurang Rp75.000", "Biaya bertambah Rp75.000"],
  warning: null,
};

describe("transaction DTO mapper", () => {
  it("parses proposed actions stored as JSON strings or objects", () => {
    expect(parseProposedActionJson(JSON.stringify(proposedAction))).toEqual(proposedAction);
    expect(parseProposedActionJson(proposedAction)).toEqual(proposedAction);
  });

  it("extracts affected objects from stored proposed-action payloads", () => {
    expect(extractAffectedObject(JSON.stringify(proposedAction))).toBe("Gas LPG");
    expect(extractAffectedObject({ ...proposedAction, affectedObject: "  " })).toBeNull();
  });

  it("normalizes confirmation response DTOs", () => {
    const confirmation = {
      id: "conf_123",
      businessId: "biz_123",
      userId: "user_123",
      parsedCommandId: "parsed_123",
      type: "transaction",
      status: "pending",
      proposedActionJson: JSON.stringify(proposedAction),
      summaryText: "Catat biaya usaha Rp75.000",
      warningText: null,
      expectedEffectsJson: JSON.stringify(proposedAction.expectedEffects),
      expiresAt: new Date("2026-06-02T12:15:00.000Z"),
      confirmedAt: null,
      cancelledAt: null,
      resultingTransactionId: null,
      createdAt: new Date("2026-06-02T12:00:00.000Z"),
      updatedAt: new Date("2026-06-02T12:00:00.000Z"),
    } satisfies ConfirmationRequestRow;

    expect(toConfirmationResponseDto(confirmation)).toMatchObject({
      id: "conf_123",
      proposedAction,
      expectedEffects: proposedAction.expectedEffects,
    });
  });
});

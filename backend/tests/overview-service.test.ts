import { describe, expect, it } from "vitest";
import {
  cashDirectionFromEffects,
  summarizeCashActivityRows,
  summarizePaymentAccountBalances,
} from "../src/features/overview/overview.service.js";

describe("overview service helpers", () => {
  it("summarizes active cash and non-cash payment account balances", () => {
    const summary = summarizePaymentAccountBalances([
      { type: "cash", status: "active", currentBalance: "750000" },
      { type: "non_cash", status: "active", currentBalance: "1000000" },
      { type: "non_cash", status: "inactive", currentBalance: "900000" },
    ]);

    expect(summary).toEqual({
      cashBalance: 750_000,
      nonCashBalance: 1_000_000,
      totalBalance: 1_750_000,
    });
  });

  it("summarizes monthly money activity from payment account effects", () => {
    const summary = summarizeCashActivityRows([
      { direction: "increase", amount: "500000" },
      { direction: "increase", amount: 250_000 },
      { direction: "decrease", amount: "100000" },
      { direction: "decrease", amount: "200000" },
    ]);

    expect(summary).toEqual({
      moneyIn: 750_000,
      moneyOut: 300_000,
    });
  });

  it("derives latest transaction direction from payment account effects", () => {
    expect(cashDirectionFromEffects([{ direction: "increase", amount: "500000" }])).toBe("in");
    expect(cashDirectionFromEffects([{ direction: "decrease", amount: "100000" }])).toBe("out");
    expect(cashDirectionFromEffects([])).toBe("neutral");
  });
});

import { describe, expect, it } from "vitest";
import { cashDirectionFromPaymentEffects } from "../src/features/transactions/transaction-history.service.js";

describe("transaction history service helpers", () => {
  it("derives cash direction from payment account effects", () => {
    expect(cashDirectionFromPaymentEffects([{ direction: "increase", amount: "500000" }])).toBe("in");
    expect(cashDirectionFromPaymentEffects([{ direction: "decrease", amount: "100000" }])).toBe("out");
    expect(cashDirectionFromPaymentEffects([])).toBe("neutral");
  });

  it("uses the larger payment account movement when a transaction has multiple effects", () => {
    expect(
      cashDirectionFromPaymentEffects([
        { direction: "increase", amount: "300000" },
        { direction: "decrease", amount: "100000" },
      ]),
    ).toBe("in");
    expect(
      cashDirectionFromPaymentEffects([
        { direction: "increase", amount: "50000" },
        { direction: "decrease", amount: "200000" },
      ]),
    ).toBe("out");
  });
});

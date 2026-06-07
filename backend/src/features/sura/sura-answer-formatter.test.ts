import { describe, expect, it } from "vitest";

import { formatSuraAnswer } from "./sura-answer-formatter.js";

describe("formatSuraAnswer", () => {
  it("keeps receivable list details out of the answer text", () => {
    const result = formatSuraAnswer({
      intent: "outstanding_receivables",
      result: {
        totalOutstanding: 180000,
        items: [{ name: "Pak Budi", amount: 180000 }],
      },
    });

    expect(result.answer).toBe("Total piutang yang belum dibayar Rp180.000.");
    expect(result.answer).not.toContain("Pak Budi");
  });

  it("keeps liability list details out of the answer text", () => {
    const result = formatSuraAnswer({
      intent: "outstanding_liabilities",
      result: {
        totalOutstanding: 500000,
        items: [{ name: "Supplier Jaya", amount: 500000 }],
      },
    });

    expect(result.answer).toBe("Total utang yang belum lunas Rp500.000.");
    expect(result.answer).not.toContain("Supplier Jaya");
  });

  it("keeps recent transaction list details out of the answer text", () => {
    const result = formatSuraAnswer({
      intent: "recent_transactions",
      result: {
        items: [{ description: "Jual ayam geprek", amount: 100000, date: "2026-06-07" }],
      },
    });

    expect(result.answer).toBe("Berikut transaksi terakhir yang sudah terkonfirmasi.");
    expect(result.answer).not.toContain("Jual ayam geprek");
  });
});

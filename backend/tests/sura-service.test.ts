import { describe, expect, it } from "vitest";
import { classifySuraIntent } from "../src/features/sura/sura-intent-classifier.js";
import { resolveSuraDateRange } from "../src/features/sura/date-range.js";
import { formatSuraAnswer, formatIdr } from "../src/features/sura/sura-answer-formatter.js";

describe("sura intent classifier", () => {
  it("classifies supported analytics questions", () => {
    expect(classifySuraIntent("kas sekarang berapa?")).toMatchObject({
      type: "analytics_query",
      analyticsIntent: "current_cash_balance",
    });
    expect(classifySuraIntent("saldo qris berapa?")).toMatchObject({
      type: "analytics_query",
      analyticsIntent: "current_non_cash_balance",
    });
    expect(classifySuraIntent("laba minggu ini berapa?")).toMatchObject({
      type: "analytics_query",
      analyticsIntent: "simple_net_income",
      dateRange: { preset: "this_week" },
    });
    expect(classifySuraIntent("ringkas usaha hari ini")).toMatchObject({
      type: "analytics_query",
      analyticsIntent: "daily_summary",
      dateRange: { preset: "today" },
    });
  });

  it("redirects write and report requests without treating them as analytics", () => {
    expect(classifySuraIntent("jual ayam geprek 500 ribu tunai")).toMatchObject({
      type: "write_action",
      analyticsIntent: null,
    });
    expect(classifySuraIntent("transfer 500rb dari bca ke kas")).toMatchObject({
      type: "write_action",
      analyticsIntent: null,
    });
    expect(classifySuraIntent("pindah 200 ribu dari Kas ke BCA")).toMatchObject({
      type: "write_action",
      analyticsIntent: null,
    });
    expect(classifySuraIntent("buat neraca bulan ini")).toMatchObject({
      type: "report_request",
      analyticsIntent: null,
    });
  });
});

describe("sura date ranges", () => {
  const now = new Date("2026-06-05T12:00:00+07:00");

  it("resolves Indonesian relative date presets", () => {
    expect(resolveSuraDateRange({ preset: "today" }, now)).toEqual({
      label: "hari ini",
      startDate: "2026-06-05",
      endDate: "2026-06-05",
    });
    expect(resolveSuraDateRange({ preset: "yesterday" }, now)).toEqual({
      label: "kemarin",
      startDate: "2026-06-04",
      endDate: "2026-06-04",
    });
    expect(resolveSuraDateRange({ preset: "this_week" }, now)).toEqual({
      label: "minggu ini",
      startDate: "2026-06-01",
      endDate: "2026-06-05",
    });
    expect(resolveSuraDateRange({ preset: "last_7_days" }, now)).toEqual({
      label: "7 hari terakhir",
      startDate: "2026-05-30",
      endDate: "2026-06-05",
    });
  });
});

describe("sura answer formatter", () => {
  it("formats IDR in Indonesian style", () => {
    expect(formatIdr(1250000)).toBe("Rp1.250.000");
    expect(formatIdr(-50000)).toBe("-Rp50.000");
  });

  it("formats simple net income with the MVP limitation warning", () => {
    const answer = formatSuraAnswer({
      intent: "simple_net_income",
      dateLabel: "minggu ini",
      result: {
        salesTotal: 500000,
        expenseTotal: 125000,
        netIncome: 375000,
      },
    });

    expect(answer.answer).toContain("Laba sederhana minggu ini Rp375.000");
    expect(answer.warnings).toContain(
      "Ini laba berjalan sederhana, belum termasuk HPP/COGS otomatis, penyusutan, pajak, atau penyesuaian akuntansi formal.",
    );
  });
});

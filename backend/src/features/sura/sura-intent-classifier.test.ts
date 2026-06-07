import { describe, expect, it } from "vitest";

import { classifySuraIntent } from "./sura-intent-classifier.js";

describe("classifySuraIntent", () => {
  it.each([
    "piutang baru budi 100 ribu",
    "Budi utang 100 ribu",
    "jual tempo ke Budi 100 ribu",
    "Budi belum bayar 100 ribu",
    "Budi bayar piutang 50 ribu",
  ])("routes piutang mutation '%s' to the write flow", (message) => {
    expect(classifySuraIntent(message)).toMatchObject({
      type: "write_action",
      analyticsIntent: null,
    });
  });

  it.each([
    "berapa piutang saya",
    "lihat daftar piutang",
    "piutang yang belum dibayar",
    "total piutang sekarang",
  ])("routes piutang query '%s' to receivables analytics", (message) => {
    expect(classifySuraIntent(message)).toMatchObject({
      type: "analytics_query",
      analyticsIntent: "outstanding_receivables",
    });
  });

  it("does not treat a liability date range as a write amount", () => {
    expect(classifySuraIntent("utang 7 hari terakhir")).toMatchObject({
      type: "analytics_query",
      analyticsIntent: "outstanding_liabilities",
    });
  });

  it.each([
    ["berapa kas sekarang", "current_cash_balance"],
    ["berapa pemasukan hari ini", "sales_total"],
    ["cek pengeluaran bulan ini", "expense_total"],
    ["lihat stok sekarang", "inventory_value"],
    ["total aset usaha", "asset_value"],
  ] as const)("keeps existing analytics query '%s'", (message, analyticsIntent) => {
    expect(classifySuraIntent(message)).toMatchObject({
      type: "analytics_query",
      analyticsIntent,
    });
  });

  it.each(["jual ayam geprek 50000 tunai", "bayar listrik 100 ribu", "beli stok ayam 300 ribu"])(
    "keeps existing write action '%s'",
    (message) => {
      expect(classifySuraIntent(message)).toMatchObject({
        type: "write_action",
        analyticsIntent: null,
      });
    },
  );
});

import { describe, expect, it } from "vitest";
import {
  buildNeracaConfirmationNotification,
  buildTransactionConfirmationNotification,
} from "./confirmation.service.js";
import type { ProposedAction } from "../parser/parser.types.js";

describe("confirmation notification metadata", () => {
  it("summarizes confirmed transaction action details briefly", () => {
    const action: ProposedAction = {
      intent: "inventory_purchase_value",
      amount: 250000,
      date: "2026-06-05",
      paymentAccountId: "acct_cash",
      paymentAccountName: "Kas",
      description: "Beli stok ayam",
      affectedObject: "Ayam",
      expectedEffects: ["Kas berkurang Rp250.000", "Nilai persediaan bertambah Rp250.000"],
      warning: null,
    };

    expect(buildTransactionConfirmationNotification(action)).toEqual({
      kind: "transaction",
      title: "Transaksi disimpan",
      actionLabel: "Pembelian stok",
      amount: 250000,
      date: "2026-06-05",
      paymentAccountName: "Kas",
      affectedObject: "Ayam",
      description: "Beli stok ayam",
    });
  });

  it("omits optional transaction details when unavailable", () => {
    const action: ProposedAction = {
      intent: "receivable_created",
      amount: 125000,
      date: "2026-06-05",
      paymentAccountId: null,
      paymentAccountName: null,
      description: "Budi belum bayar pesanan",
      affectedObject: "Budi",
      expectedEffects: ["Piutang bertambah Rp125.000", "Pendapatan bertambah Rp125.000"],
      warning: null,
    };

    expect(buildTransactionConfirmationNotification(action)).toEqual({
      kind: "transaction",
      title: "Transaksi disimpan",
      actionLabel: "Piutang baru",
      amount: 125000,
      date: "2026-06-05",
      affectedObject: "Budi",
      description: "Budi belum bayar pesanan",
    });
  });

  it("summarizes saved neraca report details", () => {
    expect(
      buildNeracaConfirmationNotification({
        reportDate: "2026-06-05",
        totalAktiva: "5600000",
        totalPasiva: "5600000",
        reconciliationStatus: "seimbang",
      }),
    ).toEqual({
      kind: "neraca_report",
      title: "Laporan disimpan",
      reportDate: "2026-06-05",
      totalAktiva: 5600000,
      totalPasiva: 5600000,
      reconciliationStatus: "seimbang",
    });
  });
});

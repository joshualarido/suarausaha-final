import type { SuraAnalyticsIntent } from "./sura-intent-classifier.js";

export interface SuraFormattedAnswer {
  answer: string;
  warnings: string[];
}

export const SIMPLE_NET_INCOME_WARNING =
  "Ini laba berjalan sederhana, belum termasuk HPP/COGS otomatis, penyusutan, pajak, atau penyesuaian akuntansi formal.";

export const INVENTORY_VALUE_WARNING =
  "Nilai persediaan masih estimasi dan penjualan belum otomatis mengurangi stok.";

export function formatIdr(value: number): string {
  const safeValue = Number.isFinite(value) ? Math.round(value) : 0;
  const sign = safeValue < 0 ? "-" : "";
  return `${sign}Rp${Math.abs(safeValue).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

function joinItemLabels(items: Array<{ name: string; amount: number }>): string {
  if (!items.length) return "";
  return items
    .slice(0, 5)
    .map((item) => `${item.name} ${formatIdr(item.amount)}`)
    .join(", ");
}

export function formatSuraAnswer(input: {
  intent: SuraAnalyticsIntent;
  dateLabel?: string;
  result: Record<string, unknown>;
}): SuraFormattedAnswer {
  const dateLabel = input.dateLabel ?? "saat ini";
  const warnings: string[] = [];

  if (input.intent === "current_cash_balance") {
    return {
      answer: `Saldo kas usaha sekarang ${formatIdr(Number(input.result.cashBalance ?? 0))}.`,
      warnings,
    };
  }

  if (input.intent === "current_non_cash_balance") {
    return {
      answer: `Saldo non-tunai usaha sekarang ${formatIdr(Number(input.result.nonCashBalance ?? 0))}.`,
      warnings,
    };
  }

  if (input.intent === "current_total_money") {
    return {
      answer: `Total uang usaha sekarang ${formatIdr(Number(input.result.totalMoney ?? 0))}. Kas ${formatIdr(Number(input.result.cashBalance ?? 0))}, non-tunai ${formatIdr(Number(input.result.nonCashBalance ?? 0))}.`,
      warnings,
    };
  }

  if (input.intent === "sales_total") {
    return {
      answer: `Pemasukan ${dateLabel} ${formatIdr(Number(input.result.salesTotal ?? 0))}.`,
      warnings,
    };
  }

  if (input.intent === "expense_total") {
    return {
      answer: `Pengeluaran ${dateLabel} ${formatIdr(Number(input.result.expenseTotal ?? 0))}.`,
      warnings,
    };
  }

  if (input.intent === "simple_net_income") {
    warnings.push(SIMPLE_NET_INCOME_WARNING);
    return {
      answer: `Laba sederhana ${dateLabel} ${formatIdr(Number(input.result.netIncome ?? 0))}. Pemasukan ${formatIdr(Number(input.result.salesTotal ?? 0))}, pengeluaran ${formatIdr(Number(input.result.expenseTotal ?? 0))}.`,
      warnings,
    };
  }

  if (input.intent === "recent_transactions") {
    const items = (input.result.items ?? []) as Array<{ description: string; amount: number; date: string }>;
    if (!items.length) {
      return {
        answer: "Belum ada transaksi terkonfirmasi.",
        warnings,
      };
    }
    return {
      answer: `Transaksi terakhir: ${items.map((item) => `${item.date} - ${item.description} ${formatIdr(item.amount)}`).join("; ")}.`,
      warnings,
    };
  }

  if (input.intent === "outstanding_liabilities") {
    const items = (input.result.items ?? []) as Array<{ name: string; amount: number }>;
    const list = joinItemLabels(items);
    return {
      answer: list
        ? `Total utang yang belum lunas ${formatIdr(Number(input.result.totalOutstanding ?? 0))}. Rinciannya: ${list}.`
        : "Tidak ada utang aktif yang belum lunas.",
      warnings,
    };
  }

  if (input.intent === "outstanding_receivables") {
    const items = (input.result.items ?? []) as Array<{ name: string; amount: number }>;
    const list = joinItemLabels(items);
    return {
      answer: list
        ? `Total piutang yang belum dibayar ${formatIdr(Number(input.result.totalOutstanding ?? 0))}. Rinciannya: ${list}.`
        : "Tidak ada piutang aktif yang belum dibayar.",
      warnings,
    };
  }

  if (input.intent === "inventory_value") {
    warnings.push(INVENTORY_VALUE_WARNING);
    return {
      answer: `Nilai stok usaha sekarang sekitar ${formatIdr(Number(input.result.inventoryValue ?? 0))}.`,
      warnings,
    };
  }

  if (input.intent === "asset_value") {
    return {
      answer: `Nilai aset usaha yang tersimpan sekarang ${formatIdr(Number(input.result.assetValue ?? 0))}.`,
      warnings,
    };
  }

  warnings.push(SIMPLE_NET_INCOME_WARNING);
  return {
    answer: `Ringkasan ${dateLabel}: pemasukan ${formatIdr(Number(input.result.salesTotal ?? 0))}, pengeluaran ${formatIdr(Number(input.result.expenseTotal ?? 0))}, laba sederhana ${formatIdr(Number(input.result.netIncome ?? 0))}, ${Number(input.result.transactionCount ?? 0)} transaksi. Saldo kas sekarang ${formatIdr(Number(input.result.cashBalance ?? 0))}, non-tunai ${formatIdr(Number(input.result.nonCashBalance ?? 0))}.`,
    warnings,
  };
}

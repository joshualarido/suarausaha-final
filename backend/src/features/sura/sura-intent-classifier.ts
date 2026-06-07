import type { SuraDatePreset } from "./date-range.js";

export type SuraClassifierType =
  | "write_action"
  | "analytics_query"
  | "report_request"
  | "help"
  | "unsupported";

export const SURA_ANALYTICS_INTENTS = [
  "current_cash_balance",
  "current_non_cash_balance",
  "current_total_money",
  "sales_total",
  "expense_total",
  "simple_net_income",
  "recent_transactions",
  "outstanding_liabilities",
  "outstanding_receivables",
  "inventory_value",
  "asset_value",
  "daily_summary",
] as const;

export type SuraAnalyticsIntent = (typeof SURA_ANALYTICS_INTENTS)[number];

export interface SuraIntentClassification {
  type: SuraClassifierType;
  analyticsIntent: SuraAnalyticsIntent | null;
  dateRange: {
    preset: SuraDatePreset | null;
    startDate: string | null;
    endDate: string | null;
  };
  limit: number | null;
  confidence: number;
}

function normalizeMessage(message: string): string {
  return message
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[?!.:,;]/g, " ")
    .replace(/\s+/g, " ");
}

function detectDatePreset(message: string): SuraDatePreset | null {
  if (/\b30\s*hari\s+terakhir\b/.test(message)) return "last_30_days";
  if (/\b7\s*hari\s+terakhir\b/.test(message)) return "last_7_days";
  if (/\btahun\s+ini\b/.test(message)) return "this_year";
  if (/\bbulan\s+ini\b/.test(message)) return "this_month";
  if (/\bminggu\s+ini\b/.test(message)) return "this_week";
  if (/\bkemarin\b/.test(message)) return "yesterday";
  if (/\bhari\s+ini\b/.test(message)) return "today";
  return null;
}

function detectLimit(message: string): number | null {
  const match = message.match(/\b(\d{1,2})\s+(transaksi|terakhir)\b/);
  if (!match) return null;

  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 20) : null;
}

function baseClassification(
  type: SuraClassifierType,
  analyticsIntent: SuraAnalyticsIntent | null,
  message: string,
  confidence: number,
): SuraIntentClassification {
  const preset = detectDatePreset(message);
  return {
    type,
    analyticsIntent,
    dateRange: {
      preset,
      startDate: null,
      endDate: null,
    },
    limit: detectLimit(message),
    confidence,
  };
}

function withDefaultDateRange(classification: SuraIntentClassification): SuraIntentClassification {
  if (
    classification.type === "analytics_query" &&
    !classification.dateRange.preset &&
    (classification.analyticsIntent === "sales_total" ||
      classification.analyticsIntent === "expense_total" ||
      classification.analyticsIntent === "simple_net_income" ||
      classification.analyticsIntent === "daily_summary")
  ) {
    return {
      ...classification,
      dateRange: {
        ...classification.dateRange,
        preset: "today",
      },
    };
  }

  return classification;
}

function isReportRequest(message: string): boolean {
  return /\b(neraca|laporan\s+neraca|laporan\s+posisi)\b/.test(message);
}

function isHelp(message: string): boolean {
  return /\b(help|bantuan|bisa\s+apa|apa\s+yang\s+bisa|cara\s+pakai)\b/.test(message);
}

function hasAmountSignal(message: string): boolean {
  return (
    /\b\d+(?:[.,]\d+)?\s*(?:rb|ribu|jt|juta|k)\b/.test(message) ||
    /\b\d{4,}\b/.test(message) ||
    /\b\d+(?:[.,]\d+)?\b(?!\s*(?:hari|minggu|bulan|tahun|transaksi|terakhir)\b)/.test(message)
  );
}

function hasExplicitQueryPhrase(message: string): boolean {
  return /\b(berapa|lihat|cek|daftar|total|sisa)\b/.test(message) || /\b(yang\s+)?belum\s+(dibayar|lunas)\b/.test(message);
}

function isReceivableOrLiabilityMutation(message: string): boolean {
  const hasReceivableOrLiabilityTerm = /\b(piutang|utang|hutang)\b/.test(message);

  if (/\b(piutang|utang|hutang)\s+baru\b/.test(message)) return true;
  if (/\bjual\s+tempo\b/.test(message) && hasAmountSignal(message)) return true;
  if (/\bbayar\s+(piutang|utang|hutang)\b/.test(message) && hasAmountSignal(message)) return true;
  if (/\b(piutang|utang|hutang)\b.*\bbayar\b/.test(message) && hasAmountSignal(message)) return true;
  if (/\bbelum\s+bayar\b/.test(message) && hasAmountSignal(message)) return true;

  return hasReceivableOrLiabilityTerm && hasAmountSignal(message) && !hasExplicitQueryPhrase(message);
}

function isWriteAction(message: string): boolean {
  return (
    isReceivableOrLiabilityMutation(message) ||
    /\b(jual|terjual|beli|bayar|pinjam|utang\s+baru|hutang\s+baru|modal|ambil\s+uang|prive|piutang\s+baru|transfer|pindah|mutasi|geser)\b/.test(message) ||
    /\b(undo|batalkan|batalin|reverse|salah\s+catat)\b/.test(message)
  );
}

function detectAnalyticsIntent(message: string): SuraAnalyticsIntent | null {
  if (/\b(ringkas|summary|rekap)\b/.test(message)) return "daily_summary";
  if (/\b(transaksi\s+terakhir|terakhir\s+apa|riwayat\s+terakhir)\b/.test(message)) return "recent_transactions";
  if (/\b(laba|untung|profit)\b/.test(message)) return "simple_net_income";
  if (/\b(pemasukan|pendapatan|penjualan)\b/.test(message)) return "sales_total";
  if (/\b(pengeluaran|biaya|expense)\b/.test(message)) return "expense_total";
  if (/\b(total\s+uang|uang\s+usaha)\b/.test(message)) return "current_total_money";
  if (/\b(qris|qr|bank|rekening|e-?wallet|ewallet|dana|ovo|gopay|non\s*tunai)\b/.test(message)) return "current_non_cash_balance";
  if (/\bkas|tunai|cash\b/.test(message)) return "current_cash_balance";
  if (/\b(utang|hutang)\b/.test(message)) return "outstanding_liabilities";
  if (/\bpiutang\b/.test(message)) return "outstanding_receivables";
  if (/\b(stok|persediaan|inventory)\b/.test(message)) return "inventory_value";
  if (/\b(aset|asset|peralatan)\b/.test(message)) return "asset_value";
  return null;
}

export function classifySuraIntent(message: string): SuraIntentClassification {
  const normalized = normalizeMessage(message);

  if (!normalized) {
    return baseClassification("unsupported", null, normalized, 0);
  }

  if (isReportRequest(normalized)) {
    return baseClassification("report_request", null, normalized, 0.95);
  }

  if (isHelp(normalized)) {
    return baseClassification("help", null, normalized, 0.95);
  }

  if (isWriteAction(normalized)) {
    return baseClassification("write_action", null, normalized, 0.85);
  }

  const analyticsIntent = detectAnalyticsIntent(normalized);
  if (analyticsIntent) {
    return withDefaultDateRange(baseClassification("analytics_query", analyticsIntent, normalized, 0.9));
  }

  return baseClassification("unsupported", null, normalized, 0.4);
}

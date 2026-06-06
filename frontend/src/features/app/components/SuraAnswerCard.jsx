import { AlertTriangle, BarChart3, CalendarDays, HelpCircle, ReceiptText } from "lucide-react";
import { formatDateId } from "@/lib/date-format";
import { formatIdr } from "@/features/app/chat-normalizers";

const intentTitles = {
  current_cash_balance: "Saldo kas",
  current_non_cash_balance: "Saldo non-tunai",
  current_total_money: "Total uang usaha",
  sales_total: "Pemasukan",
  expense_total: "Pengeluaran",
  simple_net_income: "Laba sederhana",
  recent_transactions: "Transaksi terakhir",
  outstanding_liabilities: "Utang belum lunas",
  outstanding_receivables: "Piutang belum dibayar",
  inventory_value: "Nilai stok",
  asset_value: "Aset usaha",
  daily_summary: "Ringkasan usaha",
  help: "Bantuan Sura",
  unsupported: "Belum didukung",
};

function MetricRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg bg-secondary/25 px-3 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold text-foreground">{value}</span>
    </div>
  );
}

function renderMetrics(intent, data) {
  if (intent === "current_cash_balance") {
    return <MetricRow label="Kas sekarang" value={formatIdr(data.cashBalance)} />;
  }

  if (intent === "current_non_cash_balance") {
    return <MetricRow label="Non-tunai sekarang" value={formatIdr(data.nonCashBalance)} />;
  }

  if (intent === "current_total_money") {
    return (
      <div className="grid gap-2 sm:grid-cols-3">
        <MetricRow label="Total" value={formatIdr(data.totalMoney)} />
        <MetricRow label="Kas" value={formatIdr(data.cashBalance)} />
        <MetricRow label="Non-tunai" value={formatIdr(data.nonCashBalance)} />
      </div>
    );
  }

  if (intent === "sales_total") {
    return <MetricRow label="Total pemasukan" value={formatIdr(data.salesTotal)} />;
  }

  if (intent === "expense_total") {
    return <MetricRow label="Total pengeluaran" value={formatIdr(data.expenseTotal)} />;
  }

  if (intent === "simple_net_income" || intent === "daily_summary") {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <MetricRow label="Pemasukan" value={formatIdr(data.salesTotal)} />
        <MetricRow label="Pengeluaran" value={formatIdr(data.expenseTotal)} />
        <MetricRow label="Laba sederhana" value={formatIdr(data.netIncome)} />
        {intent === "daily_summary" ? <MetricRow label="Jumlah transaksi" value={`${data.transactionCount ?? 0}`} /> : null}
        {intent === "daily_summary" ? <MetricRow label="Kas sekarang" value={formatIdr(data.cashBalance)} /> : null}
        {intent === "daily_summary" ? <MetricRow label="Non-tunai sekarang" value={formatIdr(data.nonCashBalance)} /> : null}
      </div>
    );
  }

  if (intent === "inventory_value") {
    return <MetricRow label="Nilai stok" value={formatIdr(data.inventoryValue)} />;
  }

  if (intent === "asset_value") {
    return <MetricRow label="Nilai aset" value={formatIdr(data.assetValue)} />;
  }

  return null;
}

function renderNamedList(intent, data) {
  if (intent !== "outstanding_liabilities" && intent !== "outstanding_receivables") return null;

  const items = Array.isArray(data.items) ? data.items : [];
  if (!items.length) return null;

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between bg-secondary/30 px-3 py-2 text-xs font-medium text-muted-foreground">
        <span>{intent === "outstanding_liabilities" ? "Nama utang" : "Nama piutang"}</span>
        <span>Sisa</span>
      </div>
      <div className="divide-y divide-border">
        {items.slice(0, 5).map((item, index) => (
          <div key={`${item.name}-${index}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span className="min-w-0 truncate text-foreground">{item.name}</span>
            <span className="shrink-0 font-medium text-foreground">{formatIdr(item.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function renderRecentTransactions(data) {
  const items = Array.isArray(data.items) ? data.items : [];
  if (!items.length) return null;

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-border [&>*+*]:border-t [&>*+*]:border-border">
      {items.map((transaction) => (
        <div key={transaction.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary/40 text-primary">
            <ReceiptText className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{transaction.description}</p>
            <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden />
              <span>{formatDateId(transaction.date, { day: "2-digit", month: "short", year: "numeric" })}</span>
            </div>
          </div>
          <p className="shrink-0 text-sm font-semibold text-foreground">{formatIdr(transaction.amount)}</p>
        </div>
      ))}
    </div>
  );
}

export function SuraAnswerCard({ item }) {
  const { intent, message, data = {}, warnings = [] } = item.data;
  const isUnsupported = intent === "unsupported";
  const Icon = intent === "help" || isUnsupported ? HelpCircle : BarChart3;

  return (
    <div className="flex justify-start">
      <div className="max-w-[94%] rounded-xl border border-border bg-card px-4 py-4 shadow-sm sm:max-w-[92%]">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {intentTitles[intent] ?? "Jawaban Sura"}
            </p>
            <p className="mt-1 text-sm leading-6 text-foreground">{message}</p>
          </div>
        </div>

        {renderRecentTransactions(data)}
        {renderNamedList(intent, data)}
        <div className="mt-3">{renderMetrics(intent, data)}</div>

        {warnings.length ? (
          <div className="mt-3 space-y-2">
            {warnings.map((warning) => (
              <div key={warning} className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>{warning}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

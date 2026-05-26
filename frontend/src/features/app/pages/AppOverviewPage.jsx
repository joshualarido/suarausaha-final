import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpenText,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Coins,
  Landmark,
  MessageSquareText,
  Package,
  ReceiptText,
  RefreshCcw,
  ShieldAlert,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { useSession } from "@/features/auth/session-context";
import { cn } from "@/lib/utils";
import { ApiClientError, getOverview } from "@/lib/api-client";
import { formatDateId } from "@/lib/date-format";

const transactionTypeLabel = {
  sales_income: "Uang masuk",
  general_expense: "Uang keluar",
  inventory_purchase_value: "Pembelian persediaan",
  asset_record_or_purchase: "Aset usaha",
  liability_created: "Utang baru",
  liability_payment: "Bayar utang",
  receivable_created: "Piutang baru",
  receivable_payment: "Bayar piutang",
  owner_capital_contribution: "Tambah modal",
  owner_withdrawal: "Ambil uang usaha",
  reversal: "Pembalikan",
};

function formatCurrency(formatter, value) {
  return formatter.format(Number.isFinite(value) ? value : 0);
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getCurrentMonthRange() {
  const now = new Date();
  return {
    label: new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(now),
    fromDate: toDateInputValue(new Date(now.getFullYear(), now.getMonth(), 1)),
    toDate: toDateInputValue(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

function getSafeErrorMessage(error, fallback) {
  return error instanceof ApiClientError || error instanceof Error ? error.message || fallback : fallback;
}

function OverviewCard({ icon: Icon, label, value, helper, tone = "blue" }) {
  const toneClass = {
    blue: "border-primary/20 bg-primary/5 text-primary",
    green: "border-success/25 bg-success/5 text-success",
    red: "border-danger/25 bg-danger/5 text-danger",
    amber: "border-warning/30 bg-warning/10 text-warning",
  }[tone];

  return (
    <article className={cn("rounded-lg border bg-card p-4 shadow-sm", toneClass)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="su-type-helper font-medium text-foreground">{label}</p>
          <p className="mt-3 text-2xl font-bold leading-8 text-current">{value}</p>
          {helper ? <p className="su-type-helper mt-3 text-muted-foreground">{helper}</p> : null}
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-card/80 text-current shadow-sm">
          <Icon aria-hidden className="h-5 w-5" />
        </div>
      </div>
    </article>
  );
}

function SectionCard({ title, action, children, className }) {
  return (
    <section className={cn("rounded-lg border border-border bg-card p-5 shadow-sm", className)}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="su-type-section-title text-foreground">{title}</h2>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SectionLink({ to, children, tone = "primary" }) {
  return (
    <Link
      to={to}
      className={cn(
        "su-type-helper inline-flex items-center gap-1 font-semibold",
        tone === "danger" ? "text-danger" : "text-primary",
      )}
    >
      {children}
      <ChevronRight aria-hidden className="h-4 w-4" />
    </Link>
  );
}

function EmptyState({ children }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-background p-4">
      <p className="su-type-helper text-muted-foreground">{children}</p>
    </div>
  );
}

function BalanceRow({ icon: Icon, label, value, tone = "primary" }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-background p-4">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
            tone === "success" ? "bg-success/10 text-success" : "bg-primary/10 text-primary",
          )}
        >
          <Icon aria-hidden className="h-5 w-5" />
        </span>
        <p className="su-type-ui truncate text-foreground">{label}</p>
      </div>
      <p className="su-type-ui shrink-0 text-foreground">{value}</p>
    </div>
  );
}

function MonthlyMetric({ icon: Icon, label, value, tone }) {
  const toneClass = {
    in: "text-success bg-success/10",
    out: "text-danger bg-danger/10",
    neutral: "text-primary bg-primary/10",
  }[tone];

  return (
    <article className="rounded-md border border-border bg-background p-4">
      <div className="flex items-center gap-2">
        <span className={cn("flex h-8 w-8 items-center justify-center rounded-md", toneClass)}>
          <Icon aria-hidden className="h-4 w-4" />
        </span>
        <p className="su-type-helper font-medium text-muted-foreground">{label}</p>
      </div>
      <p className={cn("mt-3 text-xl font-bold", tone === "in" ? "text-success" : tone === "out" ? "text-danger" : "text-primary")}>
        {value}
      </p>
    </article>
  );
}

function PersonAmountList({ items, nameKey, amountKey, emptyText, formatter }) {
  if (items.length === 0) {
    return <EmptyState>{emptyText}</EmptyState>;
  }

  return (
    <div className="divide-y divide-border">
      {items.map((item) => (
        <div key={item.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
          <div className="min-w-0">
            <p className="su-type-ui truncate text-foreground">{item[nameKey]}</p>
            <p className="su-type-helper text-muted-foreground">
              Sejak {formatDateId(item.createdDate, { day: "2-digit", month: "short", year: "numeric" })}
            </p>
          </div>
          <p className="su-type-ui shrink-0 text-foreground">{formatCurrency(formatter, item[amountKey] ?? 0)}</p>
        </div>
      ))}
    </div>
  );
}

function WarningItem({ icon: Icon, title, description, tone = "warning" }) {
  const toneClass = {
    warning: "bg-warning/15 text-warning",
    danger: "bg-danger/10 text-danger",
    primary: "bg-primary/10 text-primary",
  }[tone];

  return (
    <article className="flex min-w-0 items-start gap-3 rounded-md border border-border bg-card p-3">
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-md", toneClass)}>
        <Icon aria-hidden className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="su-type-ui text-foreground">{title}</p>
        <p className="su-type-helper mt-1 text-muted-foreground">{description}</p>
      </div>
    </article>
  );
}

function TransactionRow({ transaction, formatter }) {
  const direction = transaction.cashDirection ?? "neutral";
  const isIn = direction === "in";
  const isOut = direction === "out";

  return (
    <article className="grid gap-3 border-b border-border py-3 last:border-b-0 md:grid-cols-[2.8rem_7rem_minmax(0,1fr)_9rem_7rem] md:items-center">
      <div
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-lg",
          isIn ? "bg-success/10 text-success" : isOut ? "bg-danger/10 text-danger" : "bg-muted text-muted-foreground",
        )}
      >
        {isIn ? <ArrowUpRight aria-hidden className="h-5 w-5" /> : isOut ? <ArrowDownLeft aria-hidden className="h-5 w-5" /> : <RefreshCcw aria-hidden className="h-5 w-5" />}
      </div>
      <div className="min-w-0">
        <p className="su-type-helper font-medium text-foreground">
          {formatDateId(transaction.date, { day: "2-digit", month: "short", year: "numeric" })}
        </p>
        <p className="su-type-helper text-muted-foreground">{transactionTypeLabel[transaction.type] ?? transaction.type}</p>
      </div>
      <div className="min-w-0">
        <p className="su-type-ui truncate text-foreground">{transaction.description}</p>
        {transaction.affectedObject ? (
          <p className="su-type-helper truncate text-muted-foreground">{transaction.affectedObject}</p>
        ) : null}
      </div>
      <p className={cn("su-type-ui md:text-right", isIn ? "text-success" : isOut ? "text-danger" : "text-muted-foreground")}>
        {isIn ? "+" : isOut ? "-" : ""}
        {formatCurrency(formatter, transaction.amount ?? 0)}
      </p>
      <div className="flex items-center gap-2 md:justify-end">
        <span className="rounded-md bg-secondary/60 px-2.5 py-1 text-xs font-semibold text-primary">
          {transaction.paymentAccount?.name ?? "-"}
        </span>
      </div>
    </article>
  );
}

export function AppOverviewPage() {
  const session = useSession();
  const monthRange = useMemo(() => getCurrentMonthRange(), []);
  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        maximumFractionDigits: 0,
      }),
    [],
  );

  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [overview, setOverview] = useState(null);

  useEffect(() => {
    let mounted = true;

    async function loadOverview() {
      setIsLoading(true);
      setErrorMessage("");

      try {
        const payload = await getOverview({
          fromDate: monthRange.fromDate,
          toDate: monthRange.toDate,
        });
        if (!mounted) return;
        setOverview(payload?.data ?? null);
      } catch (error) {
        if (!mounted) return;
        setErrorMessage(getSafeErrorMessage(error, "Gagal memuat overview usaha."));
        setOverview(null);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    loadOverview();

    return () => {
      mounted = false;
    };
  }, [monthRange.fromDate, monthRange.toDate]);

  if (isLoading) {
    return (
      <section className="motion-enter-up rounded-lg border border-border bg-card p-6 shadow-sm">
        <p className="su-type-helper text-muted-foreground">Memuat overview usaha...</p>
      </section>
    );
  }

  if (errorMessage || !overview) {
    return (
      <section className="motion-enter-up rounded-lg border border-border bg-card p-6 shadow-sm">
        <h1 className="su-type-page-title text-foreground">Overview</h1>
        <div className="mt-4 rounded-md border border-danger/30 bg-danger/5 p-4">
          <p className="su-type-helper text-danger">{errorMessage || "Data overview belum tersedia."}</p>
        </div>
      </section>
    );
  }

  const summary = overview.summaryCards ?? {};
  const accountBalances = overview.accountBalances ?? {};
  const monthlyActivity = overview.monthlyActivity ?? {};
  const receivables = overview.receivables ?? { items: [], activeCount: 0, totalOutstanding: 0 };
  const liabilities = overview.liabilities ?? { items: [], activeCount: 0, totalOutstanding: 0 };
  const warningState = overview.warnings ?? {};
  const latestTransactions = Array.isArray(overview.latestConfirmedTransactions) ? overview.latestConfirmedTransactions : [];

  const warnings = [
    warningState.isCashLow
      ? {
          icon: AlertTriangle,
          title: "Kas rendah",
          description: `Saldo kas sekarang ${formatCurrency(currencyFormatter, summary.cashBalance ?? 0)}.`,
          tone: "warning",
        }
      : null,
    (receivables.totalOutstanding ?? 0) > 0
      ? {
          icon: UsersRound,
          title: "Piutang belum dibayar",
          description: `${receivables.activeCount ?? 0} catatan, total ${formatCurrency(currencyFormatter, receivables.totalOutstanding ?? 0)}.`,
          tone: "primary",
        }
      : null,
    (liabilities.totalOutstanding ?? 0) > 0
      ? {
          icon: ShieldAlert,
          title: "Utang aktif",
          description: `Sisa utang ${formatCurrency(currencyFormatter, liabilities.totalOutstanding ?? 0)}.`,
          tone: "danger",
        }
      : null,
    (warningState.pendingConfirmationCount ?? 0) > 0
      ? {
          icon: Clock3,
          title: "Konfirmasi belum disimpan",
          description: `${warningState.pendingConfirmationCount} transaksi masih menunggu keputusan.`,
          tone: "warning",
        }
      : null,
    (warningState.reversedTransactionCountToday ?? 0) > 0
      ? {
          icon: RefreshCcw,
          title: "Ada transaksi dibalik",
          description: `${warningState.reversedTransactionCountToday} pembalikan tercatat hari ini.`,
          tone: "primary",
        }
      : null,
  ].filter(Boolean);

  return (
    <div className="motion-enter-up mx-auto grid w-full max-w-7xl gap-4">
      <header className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <h1 className="su-type-page-title text-foreground">Overview</h1>
          <p className="su-type-page-subtitle mt-1 text-muted-foreground">
            Hai, {session.user?.name ?? "pemilik usaha"}. Ini kondisi singkat usaha kamu hari ini.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 self-start rounded-lg border border-border bg-card px-3 py-2 text-muted-foreground shadow-sm md:self-auto">
          <Clock3 aria-hidden className="h-4 w-4" />
          <span className="su-type-helper font-medium text-foreground">{formatDateId(overview.asOfDate ?? new Date())}</span>
        </div>
      </header>

      <SectionCard title="Kondisi Usaha Saat Ini">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <OverviewCard
            icon={WalletCards}
            label="Total Uang Usaha"
            value={formatCurrency(currencyFormatter, summary.totalBusinessMoney ?? 0)}
            helper={`Kas ${formatCurrency(currencyFormatter, summary.cashBalance ?? 0)} | Non-tunai ${formatCurrency(currencyFormatter, summary.nonCashBalance ?? 0)}`}
            tone="green"
          />
          <OverviewCard
            icon={BookOpenText}
            label="Piutang Belum Dibayar"
            value={formatCurrency(currencyFormatter, summary.receivableOutstanding ?? 0)}
            helper={`${receivables.activeCount ?? 0} catatan perlu ditagih`}
            tone="blue"
          />
          <OverviewCard
            icon={ShieldAlert}
            label="Utang Belum Dibayar"
            value={formatCurrency(currencyFormatter, summary.liabilityOutstanding ?? 0)}
            helper={`${liabilities.activeCount ?? 0} utang aktif`}
            tone="red"
          />
          <OverviewCard
            icon={Package}
            label="Persediaan (Estimasi)"
            value={formatCurrency(currencyFormatter, summary.inventoryEstimated ?? 0)}
            helper="Nilai stok masih estimasi"
            tone="amber"
          />
        </div>
      </SectionCard>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <SectionCard title="Saldo Akun">
          <div className="grid gap-3">
            <BalanceRow
              icon={Coins}
              label="Kas"
              value={formatCurrency(currencyFormatter, accountBalances.cashBalance ?? 0)}
              tone="success"
            />
            <BalanceRow
              icon={Landmark}
              label="Bank / QRIS / E-wallet"
              value={formatCurrency(currencyFormatter, accountBalances.nonCashBalance ?? 0)}
            />
            <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
              <p className="su-type-helper text-muted-foreground">Total saldo</p>
              <p className="su-type-ui text-foreground">{formatCurrency(currencyFormatter, accountBalances.totalBalance ?? 0)}</p>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Ringkasan Bulan Ini"
          action={<span className="su-type-helper rounded-md border border-border bg-background px-2.5 py-1 text-muted-foreground">{monthRange.label}</span>}
        >
          <div className="grid gap-3 md:grid-cols-3">
            <MonthlyMetric
              icon={ArrowUpRight}
              label="Uang Masuk"
              value={formatCurrency(currencyFormatter, monthlyActivity.moneyIn ?? 0)}
              tone="in"
            />
            <MonthlyMetric
              icon={ArrowDownLeft}
              label="Uang Keluar"
              value={formatCurrency(currencyFormatter, monthlyActivity.moneyOut ?? 0)}
              tone="out"
            />
            <MonthlyMetric
              icon={ArrowRight}
              label="Selisih"
              value={formatCurrency(currencyFormatter, monthlyActivity.difference ?? 0)}
              tone="neutral"
            />
          </div>
          <p className="su-type-helper mt-3 text-muted-foreground">
            {overview.notes?.monthlyActivity ?? "Ringkasan aktivitas uang bulan ini. Ini bukan laba."}
          </p>
        </SectionCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Piutang Belum Dibayar" action={<SectionLink to="/app/receivables">Lihat semua</SectionLink>}>
          <PersonAmountList
            items={Array.isArray(receivables.items) ? receivables.items : []}
            nameKey="customerName"
            amountKey="remainingAmount"
            emptyText="Belum ada piutang yang perlu ditagih."
            formatter={currencyFormatter}
          />
          {(receivables.totalOutstanding ?? 0) > 0 ? (
            <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
              <p className="su-type-helper text-muted-foreground">Total sisa piutang</p>
              <p className="su-type-ui text-primary">{formatCurrency(currencyFormatter, receivables.totalOutstanding ?? 0)}</p>
            </div>
          ) : null}
        </SectionCard>

        <SectionCard title="Utang Aktif" action={<SectionLink to="/app/liabilities" tone="danger">Lihat semua</SectionLink>}>
          <PersonAmountList
            items={Array.isArray(liabilities.items) ? liabilities.items : []}
            nameKey="lenderName"
            amountKey="outstandingAmount"
            emptyText="Belum ada utang aktif."
            formatter={currencyFormatter}
          />
          {(liabilities.totalOutstanding ?? 0) > 0 ? (
            <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
              <p className="su-type-helper text-muted-foreground">Total sisa utang</p>
              <p className="su-type-ui text-danger">{formatCurrency(currencyFormatter, liabilities.totalOutstanding ?? 0)}</p>
            </div>
          ) : null}
        </SectionCard>
      </div>

      <SectionCard title="Perlu Dicek">
        {warnings.length === 0 ? (
          <div className="flex items-center gap-3 rounded-md border border-success/20 bg-success/5 p-4">
            <CheckCircle2 aria-hidden className="h-5 w-5 text-success" />
            <p className="su-type-helper text-muted-foreground">Tidak ada hal penting yang perlu dicek sekarang.</p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {warnings.map((warning) => (
              <WarningItem key={warning.title} {...warning} />
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Transaksi Terakhir" action={<SectionLink to="/app/transactions">Lihat semua</SectionLink>}>
        {latestTransactions.length === 0 ? (
          <EmptyState>Belum ada transaksi terkonfirmasi untuk ditampilkan.</EmptyState>
        ) : (
          <div className="grid">
            {latestTransactions.map((transaction) => (
              <TransactionRow key={transaction.id} transaction={transaction} formatter={currencyFormatter} />
            ))}
          </div>
        )}
      </SectionCard>

      <section className="grid gap-4 rounded-lg border border-primary/20 bg-primary/5 p-5 shadow-sm md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div>
          <h2 className="su-type-section-title text-foreground">Catat transaksi sekarang</h2>
          <p className="su-type-helper mt-1 text-muted-foreground">
            Cukup ketik transaksi harian. SuaraUsaha akan bantu baca dan menyiapkan catatan.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 md:min-w-[26rem]">
          <Link
            to="/app"
            className="su-type-ui inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-primary-foreground transition hover:-translate-y-px hover:bg-primary/90 hover:shadow-sm"
          >
            <MessageSquareText aria-hidden className="h-4 w-4" />
            Catat Transaksi
          </Link>
          <Link
            to="/app/transactions"
            className="su-type-ui inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 text-foreground transition hover:-translate-y-px hover:bg-muted hover:shadow-sm"
          >
            <ReceiptText aria-hidden className="h-4 w-4" />
            Lihat Riwayat Transaksi
          </Link>
        </div>
      </section>

      <p className="su-type-helper text-center text-muted-foreground">
        Data dibaca dari saldo akun dan transaksi yang sudah tersimpan.
      </p>
    </div>
  );
}

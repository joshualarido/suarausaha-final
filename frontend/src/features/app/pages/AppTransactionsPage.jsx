import { useEffect, useMemo, useState } from "react";
import { PaginationControls } from "@/features/app/components/PaginationControls";
import { DetailJsonBlock, DetailMoneyRow, DetailRow, DetailSection, FloatingDetailPanel } from "@/features/app/components/FloatingDetailPanel";
import { TableLoadingRow } from "@/features/app/components/LoadingState";
import { RowDetailButton } from "@/features/app/components/RowDetailButton";
import { SortableTableHeader } from "@/features/app/components/SortableTableHeader";
import { getTransactionRowTone, rowToneClassName, toneBadgeClassName, toneTextClassName } from "@/features/app/components/row-state";
import { nextSortState } from "@/features/app/components/table-sort";
import { ApiClientError } from "@/lib/api-client";
import { getTransactionDetail, getTransactions } from "@/features/app/app.api";
import { formatDateId } from "@/lib/date-format";

const typeOptions = [
  { label: "Semua tipe", value: "" },
  { label: "Pemasukan penjualan", value: "sales_income" },
  { label: "Biaya usaha", value: "general_expense" },
  { label: "Pembelian stok", value: "inventory_purchase_value" },
  { label: "Aset usaha", value: "asset_record_or_purchase" },
  { label: "Utang baru", value: "liability_created" },
  { label: "Pembayaran utang", value: "liability_payment" },
  { label: "Piutang baru", value: "receivable_created" },
  { label: "Pembayaran piutang", value: "receivable_payment" },
  { label: "Modal pemilik", value: "owner_capital_contribution" },
  { label: "Prive", value: "owner_withdrawal" },
  { label: "Transfer antar akun", value: "account_transfer" },
  { label: "Pembalikan", value: "reversal" },
];

const statusLabel = {
  confirmed: "Terkonfirmasi",
  reversed: "Dibalik",
  reversal: "Transaksi pembalik",
};

export function AppTransactionsPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [total, setTotal] = useState(0);
  const [detailState, setDetailState] = useState({ status: "idle", item: null, error: "" });
  const [filters, setFilters] = useState({
    type: "",
    fromDate: "",
    toDate: "",
    sortBy: "date",
    sortDirection: "desc",
  });

  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        maximumFractionDigits: 0,
      }),
    [],
  );

  const totalPages = Math.max(1, Math.ceil(total / limit));

  useEffect(() => {
    let mounted = true;

    async function loadTransactions() {
      setIsLoading(true);
      setErrorMessage("");

      try {
        const payload = await getTransactions({
          page,
          limit,
          type: filters.type || undefined,
          fromDate: filters.fromDate || undefined,
          toDate: filters.toDate || undefined,
          sortBy: filters.sortBy,
          sortDirection: filters.sortDirection,
        });

        if (!mounted) return;

        const data = payload?.data ?? {};
        setItems(Array.isArray(data.items) ? data.items : []);
        setTotal(typeof data.total === "number" ? data.total : 0);
      } catch (error) {
        if (!mounted) return;
        const fallback = "Gagal memuat daftar transaksi.";
        const message = error instanceof ApiClientError || error instanceof Error ? error.message || fallback : fallback;
        setErrorMessage(message);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    loadTransactions();

    return () => {
      mounted = false;
    };
  }, [filters.fromDate, filters.sortBy, filters.sortDirection, filters.toDate, filters.type, limit, page]);

  function handleFilterChange(field, value) {
    setFilters((previous) => ({
      ...previous,
      [field]: value,
    }));
    setPage(1);
  }

  function handleSortChange(sortBy, defaultDirection = "desc") {
    setFilters((previous) => ({
      ...previous,
      ...nextSortState(previous, sortBy, defaultDirection),
    }));
    setPage(1);
  }

  async function openTransactionDetail(transactionId) {
    setDetailState({ status: "loading", item: null, error: "" });
    try {
      const payload = await getTransactionDetail(transactionId);
      setDetailState({ status: "loaded", item: payload?.data ?? null, error: "" });
    } catch (error) {
      const fallback = "Detail transaksi belum bisa dimuat.";
      const message = error instanceof ApiClientError || error instanceof Error ? error.message || fallback : fallback;
      setDetailState({ status: "error", item: null, error: message });
    }
  }

  return (
    <section className="motion-enter-up rounded-lg border border-border bg-card p-6 shadow-sm">
      <h2 className="su-type-section-title text-foreground">Daftar transaksi</h2>
      <p className="su-type-helper mt-1 text-muted-foreground">Halaman ini khusus untuk melihat data transaksi yang tersimpan.</p>

      <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(10rem,1fr)_minmax(10rem,1fr)_minmax(10rem,1fr)]">
        <label className="grid gap-2">
          <span className="su-type-ui text-foreground">Tipe transaksi</span>
          <select
            value={filters.type}
            onChange={(event) => handleFilterChange("type", event.target.value)}
            className="su-type-field h-11 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:ring-2 focus:ring-ring/20"
          >
            {typeOptions.map((option) => (
              <option key={option.value || "all"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-2">
          <span className="su-type-ui text-foreground">Dari tanggal</span>
          <input
            type="date"
            value={filters.fromDate}
            onChange={(event) => handleFilterChange("fromDate", event.target.value)}
            className="su-type-field h-11 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:ring-2 focus:ring-ring/20"
          />
        </label>

        <label className="grid gap-2">
          <span className="su-type-ui text-foreground">Sampai tanggal</span>
          <input
            type="date"
            value={filters.toDate}
            onChange={(event) => handleFilterChange("toDate", event.target.value)}
            className="su-type-field h-11 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:ring-2 focus:ring-ring/20"
          />
        </label>
      </div>

      {errorMessage ? (
        <div className="mt-4 rounded-md border border-danger/40 bg-background p-4">
          <p className="su-type-helper text-danger">{errorMessage}</p>
        </div>
      ) : null}

      <div className="mt-5 overflow-hidden rounded-md border border-border">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-background">
            <tr>
              <SortableTableHeader
                label="Tanggal"
                sortKey="date"
                currentSort={filters}
                onSort={handleSortChange}
              />
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Deskripsi</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Akun</th>
              <SortableTableHeader
                label="Status"
                sortKey="status"
                currentSort={filters}
                onSort={handleSortChange}
                defaultDirection="asc"
              />
              <SortableTableHeader
                label="Jumlah"
                sortKey="amount"
                align="right"
                currentSort={filters}
                onSort={handleSortChange}
              />
              <th className="w-14 px-4 py-3 text-right font-medium text-muted-foreground">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {isLoading ? (
              <TableLoadingRow colSpan={6} label="Memuat transaksi..." />
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-muted-foreground">
                  Belum ada transaksi sesuai filter.
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const tone = getTransactionRowTone(item);

                return (
                  <tr key={item.id} className={rowToneClassName(tone, "group")}>
                    <td className="px-4 py-3 text-muted-foreground">{formatDateId(item.date)}</td>
                    <td className="px-4 py-3 text-foreground">
                      <p>{item.description}</p>
                      {item.affectedObject ? (
                        <p className="mt-1 text-xs text-muted-foreground">Objek: {item.affectedObject}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{item.paymentAccount?.name ?? "-"}</td>
                    <td className="px-4 py-3">
                      <span className={toneBadgeClassName(tone)}>{statusLabel[item.status] ?? item.status}</span>
                    </td>
                    <td className={toneTextClassName(tone, "px-4 py-3 text-right font-semibold")}>
                      {currencyFormatter.format(item.amount ?? 0)}
                    </td>
                    <td className="w-14 px-4 py-3 text-right">
                      <RowDetailButton onClick={() => openTransactionDetail(item.id)} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {detailState.status !== "idle" ? (
        <FloatingDetailPanel
          title="Detail transaksi"
          subtitle={detailState.item?.description ?? (detailState.status === "loading" ? "Memuat detail..." : "Detail tidak tersedia")}
          onClose={() => setDetailState({ status: "idle", item: null, error: "" })}
        >
          {detailState.status === "loading" ? <p className="su-type-helper text-muted-foreground">Memuat detail transaksi...</p> : null}
          {detailState.status === "error" ? <p className="su-type-helper text-danger">{detailState.error}</p> : null}
          {detailState.item ? <TransactionDetailContent detail={detailState.item} /> : null}
        </FloatingDetailPanel>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="su-type-helper text-muted-foreground">
          Halaman {page} dari {totalPages} ({total} transaksi)
        </p>
        <PaginationControls page={page} totalPages={totalPages} isLoading={isLoading} onPageChange={setPage} />
      </div>
    </section>
  );
}

export function TransactionDetailContent({ detail }) {
  return (
    <div className="grid gap-1">
      <DetailSection title="Ringkasan">
        <DetailRow label="Status" value={statusLabel[detail.status] ?? detail.status} />
        <DetailRow label="Mode pencatatan" value={detail.captureMode === "auto_fast" ? "Tersimpan otomatis / fast-saved" : "Lewat konfirmasi"} />
        <DetailMoneyRow label="Jumlah" value={detail.amount} />
        <DetailRow label="Tanggal" value={formatDateId(detail.date)} />
        <DetailRow label="Akun pembayaran" value={detail.paymentAccount?.name ?? "-"} />
        <DetailRow label="Objek" value={detail.affectedObject ?? "-"} />
      </DetailSection>

      <DetailSection title="Audit input">
        <DetailRow label="Raw input" value={detail.rawInputText ?? "-"} />
        <DetailRow label="Deskripsi" value={detail.description} />
        <DetailJsonBlock value={detail.interpretedAction} />
      </DetailSection>

      <DetailSection title="Efek transaksi">
        {Array.isArray(detail.effects) && detail.effects.length ? (
          detail.effects.map((effect, index) => (
            <DetailRow
              key={`${effect.targetType}-${effect.effectType}-${index}`}
              label={`${effect.targetType} / ${effect.effectType}`}
              value={`${effect.direction === "increase" ? "Bertambah" : "Berkurang"} ${currencyFormatterPlain(effect.amount)} (${currencyFormatterPlain(effect.beforeAmount)} -> ${currencyFormatterPlain(effect.afterAmount)})`}
            />
          ))
        ) : (
          <p className="su-type-helper text-muted-foreground">Tidak ada efek tersimpan.</p>
        )}
        <DetailRow
          label="Penurunan stok"
          value={detail.inventoryDecrease?.hasDecrease ? currencyFormatterPlain(detail.inventoryDecrease.amount) : "Tidak ada penurunan stok"}
        />
      </DetailSection>

      {Array.isArray(detail.expectedEffects) && detail.expectedEffects.length ? (
        <DetailSection title="Efek yang diinterpretasikan">
          {detail.expectedEffects.map((effect) => (
            <DetailRow key={effect} label="Efek" value={effect} />
          ))}
        </DetailSection>
      ) : null}

      {Array.isArray(detail.notes) && detail.notes.length ? (
        <DetailSection title="Catatan">
          {detail.notes.map((note) => (
            <DetailRow key={note} label="Catatan" value={note} />
          ))}
        </DetailSection>
      ) : null}
    </div>
  );
}

function currencyFormatterPlain(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value ?? 0);
}

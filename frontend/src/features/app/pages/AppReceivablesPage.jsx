import { useEffect, useMemo, useState } from "react";
import { DetailMoneyRow, DetailRow, DetailSection, FloatingDetailPanel } from "@/features/app/components/FloatingDetailPanel";
import { LoadingState } from "@/features/app/components/LoadingState";
import { RowDetailButton } from "@/features/app/components/RowDetailButton";
import { SortableTableHeader } from "@/features/app/components/SortableTableHeader";
import {
  getPaymentStatusTone,
  paymentStatusLabel,
  rowToneClassName,
  toneBadgeClassName,
  toneTextClassName,
} from "@/features/app/components/row-state";
import { nextSortState, sortRows } from "@/features/app/components/table-sort";
import { ApiClientError } from "@/lib/api-client";
import { getReceivablesSummary } from "@/features/app/app.api";
import { formatDateId } from "@/lib/date-format";

const sortGetters = {
  createdDate: (item) => item.createdDate,
  customerName: (item) => item.customerName,
  originalAmount: (item) => item.originalAmount ?? 0,
  paidAmount: (item) => item.paidAmount ?? 0,
  remainingAmount: (item) => item.remainingAmount ?? item.outstandingAmount ?? 0,
  status: (item) => item.status,
};

export function AppReceivablesPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [summary, setSummary] = useState(null);
  const [sort, setSort] = useState({ sortBy: "remainingAmount", sortDirection: "desc" });
  const [detailItem, setDetailItem] = useState(null);

  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        maximumFractionDigits: 0,
      }),
    [],
  );

  useEffect(() => {
    let mounted = true;

    async function loadSummary() {
      setIsLoading(true);
      setErrorMessage("");

      try {
        const payload = await getReceivablesSummary();
        if (!mounted) return;
        setSummary(payload?.data ?? null);
      } catch (error) {
        if (!mounted) return;
        const fallback = "Gagal memuat data piutang.";
        const message = error instanceof ApiClientError || error instanceof Error ? error.message || fallback : fallback;
        setErrorMessage(message);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    loadSummary();

    return () => {
      mounted = false;
    };
  }, []);

  if (isLoading) {
    return <LoadingState title="Memuat data piutang..." description="Mohon tunggu sebentar." />;
  }

  const receivableItems = sortRows(Array.isArray(summary?.items) ? summary.items : [], sort.sortBy, sort.sortDirection, sortGetters);

  function handleSortChange(sortBy, defaultDirection = "desc") {
    setSort((previous) => nextSortState(previous, sortBy, defaultDirection));
  }

  return (
    <section className="motion-enter-up rounded-lg border border-border bg-card p-6 shadow-sm">
      <h2 className="su-type-section-title text-foreground">Piutang usaha</h2>
      <p className="su-type-helper mt-1 text-muted-foreground">
        Halaman ini menampilkan piutang pelanggan dari saldo awal dan transaksi piutang yang terkonfirmasi.
      </p>

      {errorMessage ? (
        <div className="mt-4 rounded-md border border-danger/40 bg-background p-4">
          <p className="su-type-helper text-danger">{errorMessage}</p>
        </div>
      ) : null}

      {summary ? (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <article className="rounded-md border border-border bg-background p-4">
              <p className="su-type-meta text-muted-foreground">Total piutang tercatat</p>
              <p className="su-type-ui mt-2 text-foreground">
                {currencyFormatter.format(summary.totalOriginalAmount ?? 0)}
              </p>
            </article>
            <article className="rounded-md border border-border bg-background p-4">
              <p className="su-type-meta text-muted-foreground">Sudah dibayar</p>
              <p className="su-type-ui mt-2 text-foreground">
                {currencyFormatter.format(summary.totalPaidAmount ?? 0)}
              </p>
            </article>
            <article className="rounded-md border border-border bg-background p-4">
              <p className="su-type-meta text-muted-foreground">Sisa piutang</p>
              <p className="su-type-ui mt-2 text-foreground">
                {currencyFormatter.format(summary.totalOutstandingAmount ?? 0)}
              </p>
            </article>
          </div>

          <div className="mt-5 overflow-hidden rounded-md border border-border">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-background">
                <tr>
                  <SortableTableHeader
                    label="Pelanggan"
                    sortKey="customerName"
                    currentSort={sort}
                    onSort={handleSortChange}
                    defaultDirection="asc"
                  />
                  <SortableTableHeader
                    label="Tanggal"
                    sortKey="createdDate"
                    currentSort={sort}
                    onSort={handleSortChange}
                  />
                  <SortableTableHeader
                    label="Awal"
                    sortKey="originalAmount"
                    align="right"
                    currentSort={sort}
                    onSort={handleSortChange}
                  />
                  <SortableTableHeader
                    label="Dibayar"
                    sortKey="paidAmount"
                    align="right"
                    currentSort={sort}
                    onSort={handleSortChange}
                  />
                  <SortableTableHeader
                    label="Sisa"
                    sortKey="remainingAmount"
                    align="right"
                    currentSort={sort}
                    onSort={handleSortChange}
                  />
                  <SortableTableHeader
                    label="Status"
                    sortKey="status"
                    currentSort={sort}
                    onSort={handleSortChange}
                    defaultDirection="asc"
                  />
                  <th className="w-14 px-4 py-3 text-right font-medium text-muted-foreground">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {receivableItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-muted-foreground">
                      Belum ada data piutang.
                    </td>
                  </tr>
                ) : (
                  receivableItems.map((item) => {
                    const tone = getPaymentStatusTone(item.status);

                    return (
                      <tr key={item.id} className={rowToneClassName(tone, "group")}>
                        <td className="px-4 py-3 text-foreground">{item.customerName}</td>
                        <td className="px-4 py-3 text-muted-foreground">{formatDateId(item.createdDate)}</td>
                        <td className="px-4 py-3 text-right text-foreground">
                          {currencyFormatter.format(item.originalAmount ?? 0)}
                        </td>
                        <td className="px-4 py-3 text-right text-foreground">
                          {currencyFormatter.format(item.paidAmount ?? 0)}
                        </td>
                        <td className={toneTextClassName(tone, "px-4 py-3 text-right font-semibold")}>
                          {currencyFormatter.format(item.remainingAmount ?? item.outstandingAmount ?? 0)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={toneBadgeClassName(tone)}>{paymentStatusLabel[item.status] ?? item.status}</span>
                        </td>
                        <td className="w-14 px-4 py-3 text-right">
                          <RowDetailButton onClick={() => setDetailItem(item)} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {detailItem ? (
            <FloatingDetailPanel title="Detail piutang" subtitle={detailItem.customerName} onClose={() => setDetailItem(null)}>
              <DetailSection title="Piutang">
                <DetailRow label="Pelanggan" value={detailItem.customerName} />
                <DetailRow label="Status" value={paymentStatusLabel[detailItem.status] ?? detailItem.status} />
                <DetailMoneyRow label="Jumlah awal" value={detailItem.originalAmount} />
                <DetailMoneyRow label="Sudah dibayar" value={detailItem.paidAmount} />
                <DetailMoneyRow label="Sisa piutang" value={detailItem.remainingAmount ?? detailItem.outstandingAmount} />
                <DetailRow label="Tanggal catat" value={formatDateId(detailItem.createdDate)} />
                <DetailRow label="Sumber" value={detailItem.sourceTransactionId === "opening-balance" ? "Saldo awal" : detailItem.sourceTransactionId} />
              </DetailSection>
            </FloatingDetailPanel>
          ) : null}
        </>
      ) : (
        <div className="mt-5 rounded-md border border-dashed border-border bg-background p-5">
          <p className="su-type-helper text-muted-foreground">Belum ada data piutang untuk ditampilkan.</p>
        </div>
      )}
    </section>
  );
}

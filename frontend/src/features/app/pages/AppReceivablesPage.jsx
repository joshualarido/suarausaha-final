import { useEffect, useMemo, useState } from "react";
import { ApiClientError } from "@/lib/api-client";
import { getReceivablesSummary } from "@/features/app/app.api";
import { formatDateId } from "@/lib/date-format";

export function AppReceivablesPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [summary, setSummary] = useState(null);

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
    return (
      <section className="motion-enter-up rounded-lg border border-border bg-card p-6">
        <p className="su-type-helper text-muted-foreground">Memuat data piutang...</p>
      </section>
    );
  }

  const receivableItems = Array.isArray(summary?.items) ? summary.items : [];

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
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Pelanggan</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Tanggal</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Awal</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Dibayar</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Sisa</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {receivableItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-muted-foreground">
                      Belum ada data piutang.
                    </td>
                  </tr>
                ) : (
                  receivableItems.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-3 text-foreground">{item.customerName}</td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDateId(item.createdDate)}</td>
                      <td className="px-4 py-3 text-right text-foreground">
                        {currencyFormatter.format(item.originalAmount ?? 0)}
                      </td>
                      <td className="px-4 py-3 text-right text-foreground">
                        {currencyFormatter.format(item.paidAmount ?? 0)}
                      </td>
                      <td className="px-4 py-3 text-right text-foreground">
                        {currencyFormatter.format(item.remainingAmount ?? item.outstandingAmount ?? 0)}
                      </td>
                      <td className="px-4 py-3 capitalize text-muted-foreground">{item.status}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="mt-5 rounded-md border border-dashed border-border bg-background p-5">
          <p className="su-type-helper text-muted-foreground">Belum ada data piutang untuk ditampilkan.</p>
        </div>
      )}
    </section>
  );
}

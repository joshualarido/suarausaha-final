import { useEffect, useMemo, useState } from "react";
import { ApiClientError } from "@/lib/api-client";
import { getInventorySummary } from "@/features/app/app.api";
import { formatDateTimeId } from "@/lib/date-format";

export function AppStockPage() {
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
        const payload = await getInventorySummary();
        if (!mounted) return;
        setSummary(payload?.data ?? null);
      } catch (error) {
        if (!mounted) return;
        const fallback = "Gagal memuat ringkasan stok.";
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
        <p className="su-type-helper text-muted-foreground">Memuat data stok...</p>
      </section>
    );
  }

  return (
    <section className="motion-enter-up rounded-lg border border-border bg-card p-6 shadow-sm">
      <h2 className="su-type-section-title text-foreground">Stok usaha</h2>
      <p className="su-type-helper mt-1 text-muted-foreground">
        Tampilan ini hanya baca data dari transaksi terkonfirmasi dan saldo awal.
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
              <p className="su-type-meta text-muted-foreground">Saldo awal persediaan</p>
              <p className="su-type-ui mt-2 text-foreground">{currencyFormatter.format(summary.openingValue ?? 0)}</p>
            </article>
            <article className="rounded-md border border-border bg-background p-4">
              <p className="su-type-meta text-muted-foreground">Pembelian stok</p>
              <p className="su-type-ui mt-2 text-foreground">{currencyFormatter.format(summary.purchasedValue ?? 0)}</p>
            </article>
            <article className="rounded-md border border-border bg-background p-4">
              <p className="su-type-meta text-muted-foreground">Estimasi stok saat ini</p>
              <p className="su-type-ui mt-2 text-foreground">{currencyFormatter.format(summary.estimatedValue ?? 0)}</p>
            </article>
          </div>

          <div className="mt-4 rounded-md border border-border bg-background p-4">
            <p className="su-type-helper text-muted-foreground">{summary.note}</p>
            {summary.lastUpdatedAt ? (
              <p className="su-type-helper mt-2 text-muted-foreground">
                Terakhir diperbarui: {formatDateTimeId(summary.lastUpdatedAt)}
              </p>
            ) : null}
          </div>
        </>
      ) : (
        <div className="mt-5 rounded-md border border-dashed border-border bg-background p-5">
          <p className="su-type-helper text-muted-foreground">Belum ada data stok untuk ditampilkan.</p>
        </div>
      )}
    </section>
  );
}

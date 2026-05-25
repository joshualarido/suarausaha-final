import { useEffect, useMemo, useState } from "react";
import { ApiClientError, getAssetSummary } from "@/lib/api-client";
import { formatDateId } from "@/lib/date-format";

export function AppAssetsPage() {
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
        const payload = await getAssetSummary();
        if (!mounted) return;
        setSummary(payload?.data ?? null);
      } catch (error) {
        if (!mounted) return;
        const fallback = "Gagal memuat ringkasan aset.";
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
        <p className="su-type-helper text-muted-foreground">Memuat data aset...</p>
      </section>
    );
  }

  const assetItems = Array.isArray(summary?.items) ? summary.items : [];

  return (
    <section className="motion-enter-up rounded-lg border border-border bg-card p-6 shadow-sm">
      <h2 className="su-type-section-title text-foreground">Aset usaha</h2>
      <p className="su-type-helper mt-1 text-muted-foreground">
        Data aset diambil dari saldo awal dan transaksi tipe aset yang sudah dikonfirmasi.
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
              <p className="su-type-meta text-muted-foreground">Saldo awal aset</p>
              <p className="su-type-ui mt-2 text-foreground">{currencyFormatter.format(summary.openingValue ?? 0)}</p>
            </article>
            <article className="rounded-md border border-border bg-background p-4">
              <p className="su-type-meta text-muted-foreground">Penambahan dari transaksi</p>
              <p className="su-type-ui mt-2 text-foreground">
                {currencyFormatter.format(summary.purchasedOrRecordedValue ?? 0)}
              </p>
            </article>
            <article className="rounded-md border border-border bg-background p-4">
              <p className="su-type-meta text-muted-foreground">Total nilai aset</p>
              <p className="su-type-ui mt-2 text-foreground">{currencyFormatter.format(summary.totalAssetValue ?? 0)}</p>
            </article>
          </div>

          <div className="mt-5 overflow-hidden rounded-md border border-border">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-background">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Nama aset</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Tanggal</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Nilai</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {assetItems.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-muted-foreground">
                      Belum ada transaksi aset yang tersimpan.
                    </td>
                  </tr>
                ) : (
                  assetItems.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-3 text-foreground">{item.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDateId(item.recordedDate)}</td>
                      <td className="px-4 py-3 text-right text-foreground">{currencyFormatter.format(item.value ?? 0)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="mt-5 rounded-md border border-dashed border-border bg-background p-5">
          <p className="su-type-helper text-muted-foreground">Belum ada data aset untuk ditampilkan.</p>
        </div>
      )}
    </section>
  );
}

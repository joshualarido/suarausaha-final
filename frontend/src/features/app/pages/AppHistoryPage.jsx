import { useEffect, useMemo, useState } from "react";
import { ApiClientError } from "@/lib/api-client";
import { getTransactions } from "@/features/app/app.api";
import { formatDateId } from "@/lib/date-format";

const statusLabel = {
  confirmed: "Terkonfirmasi",
  reversed: "Dibalik",
  reversal: "Transaksi pembalik",
};

const typeLabel = {
  sales_income: "Pemasukan penjualan",
  general_expense: "Biaya usaha",
  inventory_purchase_value: "Pembelian stok",
  asset_record_or_purchase: "Aset usaha",
  liability_created: "Utang baru",
  liability_payment: "Bayar utang",
  receivable_created: "Piutang baru",
  receivable_payment: "Bayar piutang",
  owner_capital_contribution: "Modal pemilik",
  owner_withdrawal: "Prive",
  reversal: "Pembalikan",
};

export function AppHistoryPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [items, setItems] = useState([]);

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

    async function loadHistory() {
      setIsLoading(true);
      setErrorMessage("");

      try {
        const payload = await getTransactions({ page: 1, limit: 50 });
        if (!mounted) return;
        setItems(Array.isArray(payload?.data?.items) ? payload.data.items : []);
      } catch (error) {
        if (!mounted) return;
        const fallback = "Gagal memuat riwayat transaksi.";
        const message = error instanceof ApiClientError || error instanceof Error ? error.message || fallback : fallback;
        setErrorMessage(message);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    loadHistory();

    return () => {
      mounted = false;
    };
  }, []);

  if (isLoading) {
    return (
      <section className="motion-enter-up rounded-lg border border-border bg-card p-6">
        <p className="su-type-helper text-muted-foreground">Memuat riwayat...</p>
      </section>
    );
  }

  return (
    <section className="motion-enter-up rounded-lg border border-border bg-card p-6 shadow-sm">
      <h2 className="su-type-section-title text-foreground">Riwayat transaksi</h2>
      <p className="su-type-helper mt-1 text-muted-foreground">
        Menampilkan transaksi terbaru yang sudah disimpan.
      </p>

      {errorMessage ? (
        <div className="mt-4 rounded-md border border-danger/40 bg-background p-4">
          <p className="su-type-helper text-danger">{errorMessage}</p>
        </div>
      ) : null}

      <div className="mt-5 grid gap-3">
        {items.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-background p-5">
            <p className="su-type-helper text-muted-foreground">Belum ada transaksi tersimpan.</p>
          </div>
        ) : (
          items.map((item) => (
            <article key={item.id} className="rounded-md border border-border bg-background p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="su-type-ui text-foreground">{typeLabel[item.type] ?? item.type}</p>
                  <p className="su-type-helper mt-1 text-muted-foreground">{item.description}</p>
                </div>
                <p className="su-type-ui text-foreground">{currencyFormatter.format(item.amount ?? 0)}</p>
              </div>

              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>{formatDateId(item.date)}</span>
                <span>{statusLabel[item.status] ?? item.status}</span>
                <span>{item.paymentAccount?.name ?? "Tanpa akun pembayaran"}</span>
                {item.affectedObject ? <span>Objek: {item.affectedObject}</span> : null}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiClientError, getTransactions } from "@/lib/api-client";
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
  const [filters, setFilters] = useState({
    type: "",
    fromDate: "",
    toDate: "",
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
  }, [filters.fromDate, filters.toDate, filters.type, limit, page]);

  function handleFilterChange(field, value) {
    setFilters((previous) => ({
      ...previous,
      [field]: value,
    }));
    setPage(1);
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
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Tanggal</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Deskripsi</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Akun</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Jumlah</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {isLoading ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-muted-foreground">
                  Memuat transaksi...
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-muted-foreground">
                  Belum ada transaksi sesuai filter.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 text-muted-foreground">{formatDateId(item.date)}</td>
                  <td className="px-4 py-3 text-foreground">
                    <p>{item.description}</p>
                    {item.affectedObject ? (
                      <p className="mt-1 text-xs text-muted-foreground">Objek: {item.affectedObject}</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{item.paymentAccount?.name ?? "-"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{statusLabel[item.status] ?? item.status}</td>
                  <td className="px-4 py-3 text-right text-foreground">{currencyFormatter.format(item.amount ?? 0)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="su-type-helper text-muted-foreground">
          Halaman {page} dari {totalPages} ({total} transaksi)
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" disabled={page <= 1 || isLoading} onClick={() => setPage((current) => current - 1)}>
            Sebelumnya
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={page >= totalPages || isLoading}
            onClick={() => setPage((current) => current + 1)}
          >
            Berikutnya
          </Button>
        </div>
      </div>
    </section>
  );
}

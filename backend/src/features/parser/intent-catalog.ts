import type { ProposedAction } from "./parser.types.js";

export interface IntentCatalogItem {
  intent: ProposedAction["intent"];
  label: string;
  meaning: string;
  requiredFields: string[];
  examples: string[];
  moneyDirection: "in" | "out" | "none_or_contextual";
}

export const SUPPORTED_INTENT_CATALOG: IntentCatalogItem[] = [
  {
    intent: "sales_income",
    label: "Pemasukan penjualan",
    meaning: "Uang masuk dari penjualan barang atau jasa.",
    requiredFields: ["amount", "date", "description"],
    examples: ["jual ayam geprek 50000 tunai", "terima uang jualan 200 ribu"],
    moneyDirection: "in",
  },
  {
    intent: "general_expense",
    label: "Biaya usaha",
    meaning: "Uang keluar untuk biaya operasional usaha.",
    requiredFields: ["amount", "date", "description"],
    examples: ["bayar listrik 100 ribu", "beli bensin untuk antar pesanan 50000"],
    moneyDirection: "out",
  },
  {
    intent: "inventory_purchase_value",
    label: "Beli stok/persediaan",
    meaning: "Uang keluar untuk membeli stok atau persediaan berdasarkan nilai rupiah.",
    requiredFields: ["amount", "date", "description", "affectedObject"],
    examples: ["beli stok ayam 300 ribu", "belanja bahan baku 150000"],
    moneyDirection: "out",
  },
  {
    intent: "asset_record_or_purchase",
    label: "Catat/beli aset usaha",
    meaning: "Mencatat aset usaha atau pembelian aset usaha.",
    requiredFields: ["amount", "date", "description", "affectedObject"],
    examples: ["beli kompor usaha 800 ribu", "catat etalase sebagai aset 1 juta"],
    moneyDirection: "none_or_contextual",
  },
  {
    intent: "liability_created",
    label: "Tambah utang",
    meaning: "Mencatat utang baru yang harus dibayar nanti.",
    requiredFields: ["amount", "date", "description", "affectedObject"],
    examples: ["utang ke supplier 500 ribu", "ambil pinjaman usaha 2 juta"],
    moneyDirection: "none_or_contextual",
  },
  {
    intent: "liability_payment",
    label: "Bayar utang",
    meaning: "Uang keluar untuk mengurangi utang yang sudah ada.",
    requiredFields: ["amount", "date", "description", "affectedObject"],
    examples: ["bayar utang supplier 200 ribu", "cicil pinjaman 300000"],
    moneyDirection: "out",
  },
  {
    intent: "receivable_created",
    label: "Tambah piutang",
    meaning: "Mencatat penjualan atau uang yang belum dibayar pelanggan.",
    requiredFields: ["amount", "date", "description", "affectedObject"],
    examples: ["pelanggan utang 100 ribu", "jual tempo ke Budi 250000"],
    moneyDirection: "none_or_contextual",
  },
  {
    intent: "receivable_payment",
    label: "Terima pembayaran piutang",
    meaning: "Uang masuk dari pelanggan yang membayar piutang.",
    requiredFields: ["amount", "date", "description", "affectedObject"],
    examples: ["Budi bayar piutang 100 ribu", "terima pembayaran utang pelanggan 250000"],
    moneyDirection: "in",
  },
  {
    intent: "owner_capital_contribution",
    label: "Tambah modal pemilik",
    meaning: "Pemilik memasukkan uang pribadi ke usaha.",
    requiredFields: ["amount", "date", "description"],
    examples: ["tambah modal 1 juta", "masukkan uang pribadi ke usaha 500 ribu"],
    moneyDirection: "in",
  },
  {
    intent: "owner_withdrawal",
    label: "Ambil uang usaha/prive",
    meaning: "Pemilik mengambil uang usaha untuk keperluan pribadi.",
    requiredFields: ["amount", "date", "description"],
    examples: ["ambil uang usaha 100 ribu", "prive 250000"],
    moneyDirection: "out",
  },
  {
    intent: "account_transfer",
    label: "Transfer antar akun",
    meaning: "Memindahkan uang dari satu akun pembayaran usaha ke akun pembayaran usaha lain.",
    requiredFields: ["amount", "date", "description", "paymentAccountId", "destinationPaymentAccountId"],
    examples: ["pindah 500 ribu dari Kas ke BCA", "transfer 1 juta dari QRIS ke Bank"],
    moneyDirection: "none_or_contextual",
  },
  {
    intent: "reversal",
    label: "Batalkan/balik transaksi",
    meaning: "Membatalkan atau membalik transaksi yang sudah pernah dicatat.",
    requiredFields: ["amount", "date", "description", "affectedObject"],
    examples: ["batalkan transaksi jualan tadi", "balik transaksi salah catat 50000"],
    moneyDirection: "none_or_contextual",
  },
];

export const intentOptions = SUPPORTED_INTENT_CATALOG.map(({ label, intent }) => ({
  label,
  value: intent,
}));

export const intentCodes = SUPPORTED_INTENT_CATALOG.map(({ intent }) => intent);

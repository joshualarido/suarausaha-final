export type SuraInputGuideRouteType =
  | "write_action"
  | "report_request"
  | "analytics_query"
  | "pending_sales_edit";

export interface SuraInputGuideItem {
  label: string;
  keywords: string[];
  example: string;
  routeType: SuraInputGuideRouteType;
  note?: string;
}

export interface SuraInputGuideSection {
  title: string;
  items: SuraInputGuideItem[];
}

export const SURA_INPUT_GUIDE: SuraInputGuideSection[] = [
  {
    title: "Pencatatan transaksi",
    items: [
      {
        label: "Penjualan",
        keywords: ["jual", "terjual"],
        example: "jual 2 ayam geprek tunai",
        routeType: "write_action",
      },
      {
        label: "Biaya usaha",
        keywords: ["bayar", "biaya", "listrik"],
        example: "bayar listrik 100 ribu pakai kas",
        routeType: "write_action",
      },
      {
        label: "Beli stok",
        keywords: ["beli stok", "bahan", "persediaan"],
        example: "beli stok ayam 300 ribu pakai kas",
        routeType: "write_action",
      },
      {
        label: "Aset usaha",
        keywords: ["beli"],
        example: "beli kompor usaha 800 ribu pakai kas",
        routeType: "write_action",
      },
      {
        label: "Utang baru",
        keywords: ["pinjam", "utang"],
        example: "pinjam uang usaha 2 juta masuk kas",
        routeType: "write_action",
      },
      {
        label: "Bayar utang",
        keywords: ["bayar utang"],
        example: "bayar utang supplier 200 ribu pakai kas",
        routeType: "write_action",
      },
      {
        label: "Piutang baru",
        keywords: ["belum bayar", "jual tempo"],
        example: "Budi belum bayar 100 ribu",
        routeType: "write_action",
      },
      {
        label: "Bayar piutang",
        keywords: ["bayar piutang"],
        example: "Budi bayar piutang 100 ribu tunai",
        routeType: "write_action",
      },
      {
        label: "Tambah modal",
        keywords: ["modal"],
        example: "tambah modal 1 juta masuk kas",
        routeType: "write_action",
      },
      {
        label: "Ambil uang/prive",
        keywords: ["ambil uang", "prive"],
        example: "ambil uang usaha 300 ribu untuk pribadi",
        routeType: "write_action",
      },
      {
        label: "Transfer akun",
        keywords: ["pindah", "transfer", "dari", "ke"],
        example: "pindah 200 ribu dari Kas ke BCA",
        routeType: "write_action",
      },
    ],
  },
  {
    title: "Koreksi",
    items: [
      {
        label: "Undo transaksi",
        keywords: ["undo", "batalkan", "salah catat"],
        example: "undo transaksi terakhir",
        routeType: "write_action",
      },
      {
        label: "Ubah kartu penjualan",
        keywords: ["tambah"],
        example: "tambah 2 es teh",
        routeType: "pending_sales_edit",
        note: "Dipakai saat kartu konfirmasi penjualan masih aktif.",
      },
    ],
  },
  {
    title: "Laporan dan tanya data",
    items: [
      {
        label: "Neraca",
        keywords: ["neraca", "laporan neraca"],
        example: "buat neraca bulan ini",
        routeType: "report_request",
      },
      {
        label: "Tanya data",
        keywords: ["kas", "pemasukan", "pengeluaran", "laba", "utang", "piutang", "stok", "aset"],
        example: "berapa kas sekarang",
        routeType: "analytics_query",
      },
    ],
  },
];

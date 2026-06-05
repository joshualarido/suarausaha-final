import { randomUUID } from "node:crypto";
import { db, type NeracaReportRow, type OpeningBalanceRow } from "../../lib/database.js";
import { runFinancialWrite, type FinancialWriteTx } from "../../lib/financial-write.js";
import { toNumber } from "../transactions/transaction-types.js";

const ASSUMPTIONS = [
  "Laporan dibuat dari data transaksi yang sudah dikonfirmasi.",
  "Laporan ini bukan laporan audit formal.",
  "Nilai persediaan masih berupa estimasi dan tidak otomatis berkurang saat penjualan.",
  "Aset dicatat sebesar nilai yang tersimpan tanpa depresiasi.",
  "Utang belum dipisahkan menjadi utang lancar dan utang jangka panjang.",
  "Data yang belum dicatat pengguna tidak muncul dalam laporan.",
];

const UNBALANCED_WARNING =
  "Total aktiva dan total pasiva belum seimbang. Laporan ini tetap disimpan sebagai snapshot, tetapi perlu diperiksa kembali karena kemungkinan ada data awal atau transaksi yang belum lengkap.";

export class OpeningBalanceRequiredError extends Error {
  constructor() {
    super("Lengkapi saldo awal dulu sebelum membuat neraca.");
  }
}

export class NeracaReportNotFoundError extends Error {
  constructor() {
    super("Laporan neraca tidak ditemukan.");
  }
}

export interface NeracaPreviewInput {
  businessId: string;
  userId?: string;
  reportDate: string;
  generatedAt?: Date;
  generatedByName?: string | null;
}

export interface CreateNeracaReportInput extends NeracaPreviewInput {
  userId: string;
  confirmationRequestId?: string | null;
}

export interface NeracaLineItem {
  label: string;
  amount: number;
}

interface KeyedNeracaLineItem extends NeracaLineItem {
  key?: string;
}

export interface NeracaSectionGroup {
  label: string;
  total: number;
  items: NeracaLineItem[];
}

export interface NeracaSnapshotData {
  id?: string;
  reportDate: string;
  generatedAt: Date;
  generatedBy: {
    id: string | null;
    name: string | null;
  };
  aktiva: {
    total: number;
    currentAssets: NeracaSectionGroup;
    inventory: NeracaSectionGroup;
    fixedAssets: NeracaSectionGroup;
  };
  utang: {
    total: number;
    groups: NeracaSectionGroup[];
  };
  ekuitas: {
    total: number;
    openingEquity: number;
    ownerCapital: number;
    ownerWithdrawal: number;
    runningProfit: number;
    income: number;
    expense: number;
    items: NeracaLineItem[];
  };
  equation: {
    totalAktiva: number;
    totalUtang: number;
    totalEkuitas: number;
    totalPasiva: number;
    difference: number;
    reconciliationStatus: "seimbang" | "tidak_seimbang";
    isBalanced: boolean;
  };
  warningText: string | null;
  assumptions: string[];
  notes: {
    snapshot: string;
    source: string;
  };
}

export interface NeracaReportResponse extends NeracaSnapshotData {
  id: string;
  createdAt: Date;
}

export interface NeracaEffectRow {
  targetType: string;
  targetId: string;
  effectType: string;
  direction: "increase" | "decrease";
  amount: string;
  transactionDate: string;
  paymentAccountName: string | null;
  paymentAccountType: "cash" | "non_cash" | null;
  inventoryName: string | null;
  assetName: string | null;
  liabilityName: string | null;
  receivableName: string | null;
}

interface OpeningDetailRows {
  inventoryItems: KeyedNeracaLineItem[];
  assetItems: KeyedNeracaLineItem[];
  liabilityItems: KeyedNeracaLineItem[];
  receivableItems: KeyedNeracaLineItem[];
}

function signedAmount(direction: "increase" | "decrease", amount: string): number {
  const numeric = toNumber(amount);
  return direction === "increase" ? numeric : -numeric;
}

function positiveItems<T>(items: T[], getAmount: (item: T) => number): T[] {
  return items.filter((item) => getAmount(item) !== 0);
}

function fallbackOpeningDate(openingBalance: OpeningBalanceRow): string {
  return openingBalance.confirmedAt?.toISOString().slice(0, 10) ?? openingBalance.createdAt.toISOString().slice(0, 10);
}

async function getOpeningBalanceOrThrow(businessId: string): Promise<OpeningBalanceRow> {
  const openingBalance = await db
    .selectFrom("opening_balances")
    .selectAll()
    .where("businessId", "=", businessId)
    .where("status", "=", "confirmed")
    .executeTakeFirst();

  if (!openingBalance) {
    throw new OpeningBalanceRequiredError();
  }

  return openingBalance;
}

async function getEffectRows(input: { businessId: string; reportDate: string }): Promise<NeracaEffectRow[]> {
  return db
    .selectFrom("transaction_effects as effect")
    .innerJoin("transactions as transaction", "transaction.id", "effect.transactionId")
    .leftJoin("payment_accounts as paymentAccount", "paymentAccount.id", "effect.targetId")
    .leftJoin("inventory_summaries as inventory", "inventory.id", "effect.targetId")
    .leftJoin("asset_summaries as asset", "asset.id", "effect.targetId")
    .leftJoin("liabilities as liability", "liability.id", "effect.targetId")
    .leftJoin("receivables as receivable", "receivable.id", "effect.targetId")
    .select([
      "effect.targetType",
      "effect.targetId",
      "effect.effectType",
      "effect.direction",
      "effect.amount",
      "transaction.transactionDate",
      "paymentAccount.name as paymentAccountName",
      "paymentAccount.type as paymentAccountType",
      "inventory.name as inventoryName",
      "asset.name as assetName",
      "liability.lenderName as liabilityName",
      "receivable.customerName as receivableName",
    ])
    .where("effect.businessId", "=", input.businessId)
    .where("transaction.transactionDate", "<=", input.reportDate)
    .execute() as Promise<NeracaEffectRow[]>;
}

async function getOpeningDetailRows(openingBalanceId: string): Promise<OpeningDetailRows> {
  const [inventoryRows, assetRows, liabilityRows, receivableRows] = await Promise.all([
    db
      .selectFrom("inventory_summaries")
      .select(["name", "estimatedValue"])
      .where("sourceOpeningBalanceId", "=", openingBalanceId)
      .where("status", "=", "active")
      .execute(),
    db
      .selectFrom("asset_summaries")
      .select(["name", "value"])
      .where("sourceOpeningBalanceId", "=", openingBalanceId)
      .where("status", "=", "active")
      .execute(),
    db
      .selectFrom("liabilities")
      .select(["id", "lenderName", "originalAmount", "outstandingAmount"])
      .where("sourceOpeningBalanceId", "=", openingBalanceId)
      .where("status", "in", ["open", "partial", "paid"])
      .execute(),
    db
      .selectFrom("receivables")
      .select(["id", "customerName", "originalAmount", "outstandingAmount"])
      .where("sourceOpeningBalanceId", "=", openingBalanceId)
      .where("status", "in", ["open", "partial", "paid"])
      .execute(),
  ]);

  return toOpeningDetailRows({ inventoryRows, assetRows, liabilityRows, receivableRows });
}

export function toOpeningDetailRows(input: {
  inventoryRows: Array<{ name: string; estimatedValue: string }>;
  assetRows: Array<{ name: string; value: string }>;
  liabilityRows: Array<{ id?: string; lenderName: string; originalAmount: string; outstandingAmount: string }>;
  receivableRows: Array<{ id?: string; customerName: string; originalAmount: string; outstandingAmount: string }>;
}): OpeningDetailRows {
  const keyedLineItem = (key: string | undefined, label: string, amount: number): KeyedNeracaLineItem =>
    key ? { key, label, amount } : { label, amount };

  return {
    inventoryItems: input.inventoryRows.map((row) => ({ label: row.name, amount: toNumber(row.estimatedValue) })),
    assetItems: input.assetRows.map((row) => ({ label: row.name, amount: toNumber(row.value) })),
    liabilityItems: input.liabilityRows.map((row) => keyedLineItem(row.id, row.lenderName, toNumber(row.originalAmount))),
    receivableItems: input.receivableRows.map((row) => keyedLineItem(row.id, row.customerName, toNumber(row.originalAmount))),
  };
}

function addToMap(map: Map<string, NeracaLineItem>, key: string, label: string, amount: number): void {
  const current = map.get(key);
  map.set(key, {
    label,
    amount: (current?.amount ?? 0) + amount,
  });
}

function mapItems(map: Map<string, NeracaLineItem>): NeracaLineItem[] {
  return positiveItems([...map.values()], (item) => item.amount).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

function parseSnapshotJson(value: unknown): NeracaSnapshotData {
  if (value && typeof value === "object") return value as NeracaSnapshotData;
  if (typeof value === "string") return JSON.parse(value) as NeracaSnapshotData;
  throw new Error("Invalid neraca snapshot JSON.");
}

export async function previewNeraca(input: NeracaPreviewInput): Promise<NeracaSnapshotData> {
  const openingBalance = await getOpeningBalanceOrThrow(input.businessId);
  const [effectRows, openingDetails] = await Promise.all([
    getEffectRows({ businessId: input.businessId, reportDate: input.reportDate }),
    getOpeningDetailRows(openingBalance.id),
  ]);
  return buildNeracaSnapshot(openingBalance, effectRows, input, openingDetails);
}

export function buildNeracaSnapshot(
  openingBalance: OpeningBalanceRow,
  effectRows: NeracaEffectRow[],
  input: NeracaPreviewInput,
  openingDetails?: OpeningDetailRows,
): NeracaSnapshotData {
  const openingDate = fallbackOpeningDate(openingBalance);

  let cash = toNumber(openingBalance.cashBalance);
  let nonCash = toNumber(openingBalance.nonCashBalance);
  const receivableMap = new Map<string, NeracaLineItem>();
  const inventoryMap = new Map<string, NeracaLineItem>();
  const assetMap = new Map<string, NeracaLineItem>();
  const liabilityMap = new Map<string, NeracaLineItem>();

  const hasOpeningReceivableItems = Boolean(openingDetails?.receivableItems.length);
  const hasOpeningInventoryItems = Boolean(openingDetails?.inventoryItems.length);
  const hasOpeningAssetItems = Boolean(openingDetails?.assetItems.length);
  const hasOpeningLiabilityItems = Boolean(openingDetails?.liabilityItems.length);

  if (hasOpeningReceivableItems) {
    openingDetails?.receivableItems.forEach((item, index) => addToMap(receivableMap, item.key ?? `opening-receivable-${index}`, item.label, item.amount));
  } else {
    addToMap(receivableMap, "opening-receivable", "Saldo awal piutang", toNumber(openingBalance.receivableValue));
  }
  if (hasOpeningInventoryItems) {
    openingDetails?.inventoryItems.forEach((item, index) => addToMap(inventoryMap, `opening-inventory-${index}`, item.label, item.amount));
  } else {
    addToMap(inventoryMap, "opening-inventory", "Saldo awal persediaan", toNumber(openingBalance.inventoryValue));
  }
  if (hasOpeningAssetItems) {
    openingDetails?.assetItems.forEach((item, index) => addToMap(assetMap, `opening-asset-${index}`, item.label, item.amount));
  } else {
    addToMap(assetMap, "opening-assets", "Saldo awal aset usaha", toNumber(openingBalance.assetValue));
  }
  if (hasOpeningLiabilityItems) {
    openingDetails?.liabilityItems.forEach((item, index) => addToMap(liabilityMap, item.key ?? `opening-liability-${index}`, item.label, item.amount));
  } else {
    addToMap(liabilityMap, "opening-liability", "Saldo awal utang", toNumber(openingBalance.debtValue));
  }

  let income = 0;
  let expense = 0;
  let ownerCapital = 0;
  let ownerWithdrawal = 0;

  for (const row of effectRows) {
    const delta = signedAmount(row.direction, row.amount);
    switch (row.targetType) {
      case "payment_account":
        if (row.paymentAccountType === "non_cash") {
          nonCash += delta;
        } else {
          cash += delta;
        }
        break;
      case "receivable":
        addToMap(receivableMap, row.targetId, row.receivableName ?? "Piutang usaha", delta);
        break;
      case "inventory":
        addToMap(inventoryMap, row.targetId, row.inventoryName ?? "Persediaan", delta);
        break;
      case "asset":
        addToMap(assetMap, row.targetId, row.assetName ?? "Aset usaha", delta);
        break;
      case "liability":
        addToMap(liabilityMap, row.targetId, row.liabilityName ?? "Utang usaha", delta);
        break;
      case "business_bucket":
        if (row.effectType === "income") income += delta;
        if (row.effectType === "expense") expense += delta;
        if (row.effectType === "owner_capital") ownerCapital += delta;
        if (row.effectType === "owner_withdrawal") ownerWithdrawal += delta;
        break;
    }
  }

  const receivableItems = mapItems(receivableMap);
  const inventoryItems = mapItems(inventoryMap);
  const assetItems = mapItems(assetMap);
  const liabilityItems = mapItems(liabilityMap);
  const receivable = receivableItems.reduce((sum, item) => sum + item.amount, 0);
  const inventory = inventoryItems.reduce((sum, item) => sum + item.amount, 0);
  const asset = assetItems.reduce((sum, item) => sum + item.amount, 0);
  const debt = liabilityItems.reduce((sum, item) => sum + item.amount, 0);
  const runningProfit = income - expense;
  const openingEquity = toNumber(openingBalance.openingEquity);
  const totalEkuitas = openingEquity + ownerCapital - ownerWithdrawal + runningProfit;
  const totalAktiva = cash + nonCash + receivable + inventory + asset;
  const totalPasiva = debt + totalEkuitas;
  const difference = totalAktiva - totalPasiva;
  const isBalanced = difference === 0;

  return {
    reportDate: input.reportDate,
    generatedAt: input.generatedAt ?? new Date(),
    generatedBy: {
      id: input.userId ?? null,
      name: input.generatedByName ?? null,
    },
    aktiva: {
      total: totalAktiva,
      currentAssets: {
        label: "Aktiva Lancar",
        total: cash + nonCash + receivable,
        items: [
          { label: "Kas", amount: cash },
          { label: "Bank / QRIS / E-wallet", amount: nonCash },
          { label: "Piutang Usaha", amount: receivable },
        ],
      },
      inventory: {
        label: "Persediaan",
        total: inventory,
        items: inventoryItems.length ? inventoryItems : [{ label: "Persediaan (nilai)", amount: 0 }],
      },
      fixedAssets: {
        label: "Aktiva Tetap",
        total: asset,
        items: assetItems.length ? assetItems : [{ label: "Peralatan & Aset", amount: 0 }],
      },
    },
    utang: {
      total: debt,
      groups: [
        {
          label: "Utang Usaha",
          total: debt,
          items: liabilityItems.length ? liabilityItems : [{ label: "Tidak ada utang tercatat", amount: 0 }],
        },
      ],
    },
    ekuitas: {
      total: totalEkuitas,
      openingEquity,
      ownerCapital,
      ownerWithdrawal,
      runningProfit,
      income,
      expense,
      items: [
        { label: "Modal Awal", amount: openingEquity },
        { label: "Setoran Modal", amount: ownerCapital },
        { label: "Prive / Penarikan", amount: -ownerWithdrawal },
        { label: "Laba Berjalan", amount: runningProfit },
        { label: "Total Pendapatan", amount: income },
        { label: "Total Beban", amount: -expense },
      ],
    },
    equation: {
      totalAktiva,
      totalUtang: debt,
      totalEkuitas,
      totalPasiva,
      difference,
      reconciliationStatus: isBalanced ? "seimbang" : "tidak_seimbang",
      isBalanced,
    },
    warningText: isBalanced ? null : UNBALANCED_WARNING,
    assumptions: ASSUMPTIONS,
    notes: {
      snapshot: "Laporan ini bersifat snapshot dan tidak berubah setelah dibuat.",
      source: `Dihitung dari saldo awal per ${openingDate} dan transaksi terkonfirmasi sampai ${input.reportDate}.`,
    },
  };
}

export async function createNeracaReportInTransaction(
  tx: FinancialWriteTx,
  input: CreateNeracaReportInput,
): Promise<NeracaReportRow> {
  const snapshot = await previewNeraca(input);
  const id = randomUUID();
  const snapshotJson = {
    ...snapshot,
    id,
  };

  return tx
    .insertInto("neraca_reports")
    .values({
      id,
      businessId: input.businessId,
      confirmationRequestId: input.confirmationRequestId ?? null,
      reportDate: input.reportDate,
      generatedAt: snapshot.generatedAt,
      generatedBy: input.userId,
      totalAktiva: snapshot.equation.totalAktiva.toString(),
      totalPasiva: snapshot.equation.totalPasiva.toString(),
      totalUtang: snapshot.equation.totalUtang.toString(),
      totalEkuitas: snapshot.equation.totalEkuitas.toString(),
      reconciliationStatus: snapshot.equation.reconciliationStatus,
      difference: snapshot.equation.difference.toString(),
      cash: snapshot.aktiva.currentAssets.items[0]?.amount.toString() ?? "0",
      nonCash: snapshot.aktiva.currentAssets.items[1]?.amount.toString() ?? "0",
      receivable: snapshot.aktiva.currentAssets.items[2]?.amount.toString() ?? "0",
      inventory: snapshot.aktiva.inventory.total.toString(),
      asset: snapshot.aktiva.fixedAssets.total.toString(),
      debt: snapshot.utang.total.toString(),
      openingEquity: snapshot.ekuitas.openingEquity.toString(),
      ownerCapital: snapshot.ekuitas.ownerCapital.toString(),
      ownerWithdrawal: snapshot.ekuitas.ownerWithdrawal.toString(),
      income: snapshot.ekuitas.income.toString(),
      expense: snapshot.ekuitas.expense.toString(),
      runningProfit: snapshot.ekuitas.runningProfit.toString(),
      warningText: snapshot.warningText,
      assumptionsJson: JSON.stringify(snapshot.assumptions),
      snapshotJson: JSON.stringify(snapshotJson),
      createdAt: snapshot.generatedAt,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function createNeracaReport(input: CreateNeracaReportInput): Promise<NeracaReportResponse> {
  const report = await runFinancialWrite((tx) => createNeracaReportInTransaction(tx, input));
  return toNeracaReportResponse(report);
}

export function toNeracaReportResponse(report: NeracaReportRow): NeracaReportResponse {
  const snapshot = parseSnapshotJson(report.snapshotJson);
  return {
    ...snapshot,
    id: report.id,
    createdAt: report.createdAt,
  };
}

export async function listNeracaReports(input: { businessId: string; page: number; limit: number }) {
  const offset = (input.page - 1) * input.limit;
  const baseQuery = db.selectFrom("neraca_reports").where("businessId", "=", input.businessId);
  const totalRow = await baseQuery.select(({ fn }) => fn.countAll<string>().as("count")).executeTakeFirst();
  const rows = await baseQuery
    .selectAll()
    .orderBy("reportDate", "desc")
    .orderBy("generatedAt", "desc")
    .limit(input.limit)
    .offset(offset)
    .execute();

  return {
    items: rows.map(toNeracaReportResponse),
    page: input.page,
    limit: input.limit,
    total: toNumber(totalRow?.count ?? 0),
  };
}

export async function getNeracaReportForBusiness(input: {
  businessId: string;
  neracaReportId: string;
}): Promise<NeracaReportResponse> {
  const report = await db
    .selectFrom("neraca_reports")
    .selectAll()
    .where("businessId", "=", input.businessId)
    .where("id", "=", input.neracaReportId)
    .executeTakeFirst();

  if (!report) throw new NeracaReportNotFoundError();
  return toNeracaReportResponse(report);
}

function escapePdfText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function formatIdr(value: number): string {
  const absolute = Math.abs(value).toLocaleString("id-ID");
  return value < 0 ? `(Rp ${absolute})` : `Rp ${absolute}`;
}

function wrapText(value: string, maxLength = 82): string[] {
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function pdfLine(lines: string[], x: number, y: number, size: number, text: string): number {
  lines.push(`BT /F1 ${size} Tf ${x} ${y} Td (${escapePdfText(text)}) Tj ET`);
  return y - Math.round(size * 1.55);
}

function addSection(lines: string[], yStart: number, title: string, items: NeracaLineItem[], totalLabel: string, total: number): number {
  let y = pdfLine(lines, 54, yStart, 13, title);
  for (const item of items) {
    y = pdfLine(lines, 70, y, 10, `${item.label}: ${formatIdr(item.amount)}`);
  }
  return pdfLine(lines, 70, y - 4, 11, `${totalLabel}: ${formatIdr(total)}`);
}

export function renderNeracaPdf(report: NeracaReportResponse): Buffer {
  const contentLines: string[] = [];
  let y = 790;
  y = pdfLine(contentLines, 54, y, 20, "Laporan Neraca");
  y = pdfLine(contentLines, 54, y, 11, `Tanggal laporan: ${report.reportDate}`);
  y = pdfLine(contentLines, 54, y, 11, `Status: ${report.equation.reconciliationStatus === "seimbang" ? "Seimbang" : "Tidak seimbang"}`);
  y -= 10;
  y = addSection(
    contentLines,
    y,
    "AKTIVA",
    [
      ...report.aktiva.currentAssets.items,
      ...report.aktiva.inventory.items,
      ...report.aktiva.fixedAssets.items,
    ],
    "TOTAL AKTIVA",
    report.aktiva.total,
  );
  y -= 10;
  y = addSection(contentLines, y, "UTANG", report.utang.groups.flatMap((group) => group.items), "TOTAL UTANG", report.utang.total);
  y -= 10;
  y = addSection(contentLines, y, "EKUITAS", report.ekuitas.items, "TOTAL EKUITAS", report.ekuitas.total);
  y -= 10;
  y = pdfLine(
    contentLines,
    54,
    y,
    12,
    `Persamaan: ${formatIdr(report.equation.totalAktiva)} = ${formatIdr(report.equation.totalUtang)} + ${formatIdr(report.equation.totalEkuitas)}`,
  );
  if (report.warningText) {
    y -= 4;
    for (const line of wrapText(report.warningText)) {
      y = pdfLine(contentLines, 54, y, 9, line);
    }
  }
  y -= 6;
  y = pdfLine(contentLines, 54, y, 11, "Asumsi");
  for (const assumption of report.assumptions) {
    for (const line of wrapText(`- ${assumption}`, 90)) {
      y = pdfLine(contentLines, 64, y, 9, line);
    }
  }
  y -= 4;
  pdfLine(contentLines, 54, y, 9, `Dibuat: ${new Date(report.generatedAt).toISOString()} oleh ${report.generatedBy.name ?? report.generatedBy.id ?? "-"}`);

  const stream = contentLines.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

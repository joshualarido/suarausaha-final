import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, Download, FileText, RefreshCw, Save, Scale, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DetailMoneyRow, DetailRow, DetailSection, FloatingDetailPanel } from "@/features/app/components/FloatingDetailPanel";
import { LoadingState } from "@/features/app/components/LoadingState";
import { RowDetailButton } from "@/features/app/components/RowDetailButton";
import { formatIdr } from "@/features/app/chat-normalizers";
import {
  createNeracaSnapshot,
  downloadNeracaPdf,
  listNeracaSnapshots,
  previewNeraca,
} from "@/features/neraca/neraca.api";
import { useSession } from "@/features/auth/session-context";
import { formatDateId, formatDateTimeId } from "@/lib/date-format";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function signedIdr(value) {
  if ((value ?? 0) < 0) {
    return `(${formatIdr(Math.abs(value))})`;
  }
  return formatIdr(value);
}

function isNegative(value) {
  return (value ?? 0) < 0;
}

function ReportGroup({ group }) {
  return (
    <section className="border-t border-border pt-4 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-4">
        <h4 className="su-type-ui text-foreground">{group.label}</h4>
        <p className="su-type-ui text-foreground">{signedIdr(group.total)}</p>
      </div>
      <dl className="mt-3 grid gap-2">
        {group.items.map((item) => (
          <div key={`${group.label}-${item.label}`} className="flex items-center justify-between gap-4 text-sm">
            <dt className="text-muted-foreground">{item.label}</dt>
            <dd className={isNegative(item.amount) ? "text-danger" : "text-foreground"}>{signedIdr(item.amount)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ReportColumn({ tone, title, total, groups, footerLabel }) {
  const toneClasses = {
    blue: "border-[#C7DAF1] bg-[#F6FAFF] text-primary",
    orange: "border-[#F7D8B9] bg-[#FFF8F0] text-[#A94D00]",
    green: "border-[#CFE7DA] bg-[#F4FBF6] text-[#176C45]",
  };

  return (
    <section className="flex min-h-[28rem] flex-col overflow-hidden rounded-lg border border-border bg-card">
      <header className={`flex items-center justify-between gap-4 border-b px-5 py-4 ${toneClasses[tone]}`}>
        <h3 className="su-type-ui uppercase">{title}</h3>
        <p className="text-lg font-semibold">{formatIdr(total)}</p>
      </header>
      <div className="grid flex-1 gap-4 p-5">
        {groups.map((group) => (
          <ReportGroup key={group.label} group={group} />
        ))}
      </div>
      <footer className={`flex items-center justify-between gap-4 border-t px-5 py-4 ${toneClasses[tone]}`}>
        <p className="su-type-ui uppercase">{footerLabel}</p>
        <p className="text-lg font-semibold">{formatIdr(total)}</p>
      </footer>
    </section>
  );
}

function buildColumns(report) {
  if (!report) return null;
  return {
    aktiva: [
      report.aktiva.currentAssets,
      report.aktiva.inventory,
      report.aktiva.fixedAssets,
    ],
    utang: report.utang.groups,
    ekuitas: [
      {
        label: "Ekuitas Pemilik",
        total: report.ekuitas.openingEquity + report.ekuitas.ownerCapital - report.ekuitas.ownerWithdrawal,
        items: report.ekuitas.items.slice(0, 3),
      },
      {
        label: "Laba Berjalan",
        total: report.ekuitas.runningProfit,
        items: report.ekuitas.items.slice(3),
      },
    ],
  };
}

export function AppReportsPage() {
  const session = useSession();
  const [reportDate, setReportDate] = useState(todayIso());
  const [activeReport, setActiveReport] = useState(null);
  const [savedReports, setSavedReports] = useState([]);
  const [selectedReportId, setSelectedReportId] = useState("");
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [status, setStatus] = useState("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  const columns = useMemo(() => buildColumns(activeReport), [activeReport]);
  const isSavedReport = Boolean(activeReport?.id);
  const isBalanced = Boolean(activeReport?.equation?.isBalanced);

  async function loadSavedReports() {
    const payload = await listNeracaSnapshots({ page: 1, limit: 20 });
    const items = Array.isArray(payload?.data?.items) ? payload.data.items : [];
    setSavedReports(items);
    return items;
  }

  async function handlePreview(nextReportDate = reportDate) {
    setStatus("loading");
    setErrorMessage("");
    try {
      const payload = await previewNeraca(nextReportDate);
      setActiveReport(payload.data);
      setSelectedReportId("");
      setStatus("idle");
    } catch (error) {
      setErrorMessage(error.message || "Preview neraca belum bisa dibuat.");
      setStatus("idle");
    }
  }

  async function handleSaveSnapshot() {
    setStatus("saving");
    setErrorMessage("");
    try {
      const payload = await createNeracaSnapshot(reportDate);
      setActiveReport(payload.data);
      setSelectedReportId(payload.data.id);
      await loadSavedReports();
      setStatus("idle");
    } catch (error) {
      setErrorMessage(error.message || "Laporan neraca belum bisa disimpan.");
      setStatus("idle");
    }
  }

  async function handleSelectReport(reportId) {
    setSelectedReportId(reportId);
    const selected = savedReports.find((item) => item.id === reportId);
    if (selected) {
      setActiveReport(selected);
      setReportDate(selected.reportDate);
    }
  }

  async function handleDownloadPdf() {
    if (!activeReport?.id || isDownloading) return;
    setIsDownloading(true);
    setErrorMessage("");
    try {
      await downloadNeracaPdf(activeReport);
    } catch (error) {
      setErrorMessage(error.message || "PDF belum bisa diunduh.");
    } finally {
      setIsDownloading(false);
    }
  }

  useEffect(() => {
    let mounted = true;

    async function loadInitial() {
      setIsInitialLoading(true);
      try {
        const items = await loadSavedReports();
        if (!mounted) return;
        if (items[0]) {
          setActiveReport(items[0]);
          setSelectedReportId(items[0].id);
          setReportDate(items[0].reportDate);
        } else {
          const previewPayload = await previewNeraca(todayIso());
          if (!mounted) return;
          setActiveReport(previewPayload.data);
          setSelectedReportId("");
        }
      } catch (error) {
        if (mounted) {
          setErrorMessage(error.message || "Laporan neraca belum bisa dimuat.");
        }
      } finally {
        if (mounted) {
          setIsInitialLoading(false);
        }
      }
    }

    loadInitial();

    return () => {
      mounted = false;
    };
  }, []);

  if (isInitialLoading) {
    return <LoadingState title="Memuat laporan neraca..." description="Mohon tunggu sebentar." />;
  }

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-4">
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="su-type-page-title text-foreground">Laporan Neraca</h1>
          <p className="su-type-body mt-1 text-muted-foreground">
            Ringkasan posisi keuangan usahamu pada tanggal laporan.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => window.location.assign("/app")}>
          Kembali ke Chat
        </Button>
      </header>

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <p className="su-type-ui text-foreground">Pilih Laporan Neraca</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <label className="flex h-12 items-center gap-2 rounded-lg border border-border bg-background px-3">
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                <input
                  type="date"
                  value={reportDate}
                  onChange={(event) => setReportDate(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
                />
              </label>
              <select
                value={selectedReportId}
                onChange={(event) => handleSelectReport(event.target.value)}
                className="h-12 rounded-lg border border-border bg-background px-3 text-sm font-medium outline-none"
              >
                <option value="">Preview belum tersimpan</option>
                {savedReports.map((report) => (
                  <option key={report.id} value={report.id}>
                    {formatDateId(report.reportDate)} - tersimpan
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={status === "loading"} onClick={() => handlePreview()}>
              <RefreshCw className="h-4 w-4" />
              Preview
            </Button>
            <Button type="button" disabled={status === "saving"} onClick={handleSaveSnapshot}>
              <Save className="h-4 w-4" />
              Simpan
            </Button>
            <Button type="button" variant="outline" disabled={!isSavedReport || isDownloading} onClick={handleDownloadPdf}>
              <Download className="h-4 w-4" />
              Unduh PDF
            </Button>
          </div>
        </div>
      </section>

      {errorMessage ? (
        <p className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger" role="alert">
          {errorMessage}
        </p>
      ) : null}

      {activeReport && columns ? (
        <section className="group rounded-lg border border-border bg-card p-4 shadow-sm md:p-5">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="su-type-section-title text-foreground">Ringkasan Neraca</h2>
              <p className="su-type-body mt-1 text-muted-foreground">Per {formatDateId(activeReport.reportDate)}</p>
            </div>
            <div className="flex items-start gap-2 md:justify-end">
              <div className="grid gap-1 text-left md:text-right">
                <span className={`inline-flex w-fit items-center gap-1 rounded-md px-3 py-1 text-sm md:ml-auto ${isBalanced ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>
                  <Check className="h-4 w-4" />
                  {isBalanced ? "Seimbang" : "Tidak seimbang"}
                </span>
                <p className="su-type-body text-muted-foreground">Total Aktiva = Total Utang + Total Ekuitas</p>
              </div>
              <RowDetailButton onClick={() => setIsDetailOpen(true)} />
            </div>
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-3">
            <ReportColumn tone="blue" title="Aktiva" total={activeReport.aktiva.total} groups={columns.aktiva} footerLabel="Total Aktiva" />
            <ReportColumn tone="orange" title="Utang" total={activeReport.utang.total} groups={columns.utang} footerLabel="Total Utang" />
            <ReportColumn tone="green" title="Ekuitas" total={activeReport.ekuitas.total} groups={columns.ekuitas} footerLabel="Total Ekuitas" />
          </div>

          <div className="mt-4 grid gap-4 rounded-lg border border-[#D4E1F0] bg-secondary/30 p-4 lg:grid-cols-[1.2fr_1fr_auto_1fr_auto_1fr] lg:items-center">
            <div className="flex items-center gap-3">
              <Scale className="h-8 w-8 text-primary" />
              <div>
                <p className="su-type-ui text-foreground">Persamaan Neraca</p>
                <p className="su-type-helper text-muted-foreground">
                  {isBalanced ? "Neraca seimbang." : "Neraca belum seimbang."}
                </p>
              </div>
            </div>
            <div>
              <p className="su-type-meta text-primary">Total Aktiva</p>
              <p className="text-lg font-semibold text-primary">{formatIdr(activeReport.equation.totalAktiva)}</p>
            </div>
            <p className="text-2xl font-semibold text-muted-foreground">=</p>
            <div>
              <p className="su-type-meta text-[#A94D00]">Total Utang</p>
              <p className="text-lg font-semibold text-[#A94D00]">{formatIdr(activeReport.equation.totalUtang)}</p>
            </div>
            <p className="text-2xl font-semibold text-muted-foreground">+</p>
            <div>
              <p className="su-type-meta text-success">Total Ekuitas</p>
              <p className="text-lg font-semibold text-success">{formatIdr(activeReport.equation.totalEkuitas)}</p>
            </div>
          </div>

          {activeReport.warningText ? (
            <p className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
              {activeReport.warningText}
            </p>
          ) : null}

          <div className="mt-4 grid gap-4 rounded-lg border border-border p-4 md:grid-cols-3">
            <div className="flex gap-3">
              <CalendarDays className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="su-type-helper text-muted-foreground">Tanggal Laporan</p>
                <p className="su-type-body text-foreground">{formatDateId(activeReport.reportDate)}</p>
                <p className="su-type-helper text-muted-foreground">{formatDateTimeId(activeReport.generatedAt)}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="su-type-helper text-muted-foreground">Catatan</p>
                <p className="su-type-body text-foreground">{activeReport.notes?.source}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <UserRound className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="su-type-helper text-muted-foreground">Dibuat oleh</p>
                <p className="su-type-body text-foreground">{activeReport.generatedBy?.name ?? session.user?.name ?? "-"}</p>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {isDetailOpen && activeReport ? (
        <FloatingDetailPanel title="Detail laporan neraca" subtitle={`Per ${formatDateId(activeReport.reportDate)}`} onClose={() => setIsDetailOpen(false)}>
          <DetailSection title="Snapshot">
            <DetailRow label="Status" value={isBalanced ? "Seimbang" : "Tidak seimbang"} />
            <DetailRow label="Tanggal laporan" value={formatDateId(activeReport.reportDate)} />
            <DetailRow label="Dibuat" value={formatDateTimeId(activeReport.generatedAt)} />
            <DetailRow label="Dibuat oleh" value={activeReport.generatedBy?.name ?? session.user?.name ?? "-"} />
          </DetailSection>
          <DetailSection title="Nilai utama">
            <DetailMoneyRow label="Total aktiva" value={activeReport.equation?.totalAktiva ?? activeReport.aktiva?.total} />
            <DetailMoneyRow label="Total utang" value={activeReport.equation?.totalUtang ?? activeReport.utang?.total} />
            <DetailMoneyRow label="Total ekuitas" value={activeReport.equation?.totalEkuitas ?? activeReport.ekuitas?.total} />
            <DetailMoneyRow label="Total pasiva" value={activeReport.equation?.totalPasiva} />
            <DetailMoneyRow label="Selisih" value={activeReport.equation?.difference ?? 0} />
          </DetailSection>
          <DetailSection title="Catatan">
            <DetailRow label="Sumber" value={activeReport.notes?.source ?? "Data terkonfirmasi"} />
            <DetailRow label="Peringatan" value={activeReport.warningText ?? "Tidak ada peringatan."} />
          </DetailSection>
        </FloatingDetailPanel>
      ) : null}
    </div>
  );
}

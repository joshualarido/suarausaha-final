import { Check, FileText, ReceiptText, Scale, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatIdr, getIntentLabel } from "@/features/app/chat-normalizers";
import { formatDateId } from "@/lib/date-format";

export function ConfirmationCard({
  isBusy,
  item,
  onCancel,
  onConfirm,
  pendingConfirmationRequestId,
}) {
  const proposedAction = item.data.proposedAction;
  const proposedNeracaReport = item.data.proposedNeracaReport;
  const isNeracaReport = item.data.type === "neraca_report" || Boolean(proposedNeracaReport);
  const isCardActive = item.data.id === pendingConfirmationRequestId;
  const targetLabels = {
    sales_income: "Menu",
    inventory_purchase_value: "Persediaan",
    asset_record_or_purchase: "Aset",
    liability_created: "Pemberi utang",
    liability_payment: "Utang",
    receivable_created: "Pelanggan",
    receivable_payment: "Piutang",
  };
  const targetLabel = targetLabels[proposedAction?.intent] ?? "Target";

  function renderFooter(saveLabel = "Simpan") {
    return (
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button
          type="button"
          size="lg"
          disabled={isBusy || !isCardActive}
          onClick={() => onConfirm(item)}
          className="h-14 text-base"
        >
          <Check className="h-5 w-5" />
          {saveLabel}
        </Button>
        <Button
          type="button"
          size="lg"
          variant="destructive"
          disabled={isBusy || !isCardActive}
          onClick={() => onCancel(item)}
          className="h-14 text-base"
        >
          <X className="h-5 w-5" />
          Batalkan
        </Button>
      </div>
    );
  }

  if (isNeracaReport) {
    const report = proposedNeracaReport ?? {};
    const equation = report.equation ?? {};
    const isBalanced = Boolean(equation.isBalanced);

    return (
      <div className="motion-chat-card flex justify-start">
        <div className="w-full max-w-[96%] rounded-2xl border border-border bg-card px-4 py-4 sm:max-w-[92%]">
          <p className="text-xs font-medium text-primary">Butuh konfirmasi</p>
          {!isCardActive ? (
            <p className="mt-1 text-xs text-muted-foreground">Konfirmasi ini sudah tidak aktif.</p>
          ) : null}
          <div className="mt-2 flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <p className="text-base font-semibold text-foreground">Simpan laporan neraca</p>
              </div>
              <p className="text-xs text-muted-foreground">Per {formatDateId(report.reportDate)}</p>
            </div>
            <p className="text-right text-lg font-semibold text-foreground">{formatIdr(equation.totalAktiva)}</p>
          </div>

          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Total Aktiva</dt>
              <dd>{formatIdr(equation.totalAktiva)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Total Utang</dt>
              <dd>{formatIdr(equation.totalUtang)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Total Ekuitas</dt>
              <dd>{formatIdr(equation.totalEkuitas)}</dd>
            </div>
          </dl>

          <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm">
            <Scale className="h-4 w-4 text-primary" />
            <span className={isBalanced ? "text-success" : "text-danger"}>
              {isBalanced ? "Neraca seimbang" : "Neraca belum seimbang"}
            </span>
          </div>

          {report.warningText ? (
            <p className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{report.warningText}</p>
          ) : null}

          {renderFooter("Simpan")}
        </div>
      </div>
    );
  }

  const isPosSales = proposedAction?.intent === "sales_income" && proposedAction.salesOrder?.lines?.length;

  return (
    <div className="motion-chat-card flex justify-start">
      <div className="w-full max-w-[96%] rounded-2xl border border-border bg-card px-4 py-4 sm:max-w-[92%]">
        <p className="text-xs font-medium text-primary">Butuh konfirmasi</p>
        {!isCardActive ? (
          <p className="mt-1 text-xs text-muted-foreground">Konfirmasi ini sudah tidak aktif.</p>
        ) : null}
        <div className="mt-2 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <ReceiptText className="h-4 w-4 text-primary" />
              <p className="text-base font-semibold text-foreground">{getIntentLabel(proposedAction.intent)}</p>
            </div>
            <p className="text-xs text-muted-foreground">Ubah lewat input teks atau suara sebelum disimpan.</p>
          </div>
          <p className="text-right text-lg font-semibold text-foreground">{formatIdr(proposedAction.amount)}</p>
        </div>

        {isPosSales ? (
          <div className="mt-4 overflow-hidden rounded-lg border border-border">
            {proposedAction.salesOrder.lines.map((line) => (
              <div key={`${line.productId}-${line.productName}-${line.quantity}`} className="motion-chat-line grid grid-cols-[1fr_auto] gap-3 border-b border-border px-3 py-2.5 last:border-b-0">
                <div>
                  <p className="text-sm font-medium text-foreground">{line.productName}</p>
                  <p className="text-xs text-muted-foreground">
                    {line.quantity} x {formatIdr(line.unitPrice)}
                  </p>
                </div>
                <p className="text-sm font-semibold text-foreground">{formatIdr(line.subtotal)}</p>
              </div>
            ))}
          </div>
        ) : null}

        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Tanggal</dt>
            <dd>{formatDateId(proposedAction.date)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{proposedAction.intent === "account_transfer" ? "Dari akun" : "Akun"}</dt>
            <dd>{proposedAction.paymentAccountName ?? "Kas"}</dd>
          </div>
          {proposedAction.intent === "account_transfer" ? (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Ke akun</dt>
              <dd>{proposedAction.destinationPaymentAccountName ?? "-"}</dd>
            </div>
          ) : null}
          {proposedAction.affectedObject ? (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{targetLabel}</dt>
              <dd className="text-right">{proposedAction.affectedObject}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Keterangan</dt>
            <dd className="text-right">{proposedAction.description}</dd>
          </div>
        </dl>

        <ul className="mt-3 space-y-1 text-sm">
          {proposedAction.expectedEffects.map((effect) => (
            <li key={effect} className="flex gap-2 text-muted-foreground">
              <Check className="mt-0.5 h-4 w-4 text-primary" />
              <span>{effect}</span>
            </li>
          ))}
        </ul>

        {proposedAction.warning ? (
          <p className="mt-3 rounded-lg border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
            {proposedAction.warning}
          </p>
        ) : null}

        {renderFooter()}
      </div>
    </div>
  );
}

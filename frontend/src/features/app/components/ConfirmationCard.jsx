import { Check, FileText, Pencil, Scale, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatIdr, getIntentLabel } from "@/features/app/chat-normalizers";
import { formatDateId } from "@/lib/date-format";

export function ConfirmationCard({
  activeConfirmation,
  editFields,
  isBusy,
  isEditing,
  item,
  onCancel,
  onCancelEdit,
  onConfirm,
  onEditFieldChange,
  onEditSubmit,
  onStartEdit,
  pendingConfirmationRequestId,
}) {
  const proposedAction = item.data.proposedAction;
  const proposedNeracaReport = item.data.proposedNeracaReport;
  const isNeracaReport = item.data.type === "neraca_report" || Boolean(proposedNeracaReport);
  const editingThisCard = isEditing && activeConfirmation?.id === item.data.id;
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

  if (isNeracaReport) {
    const report = proposedNeracaReport ?? {};
    const equation = report.equation ?? {};
    const isBalanced = Boolean(equation.isBalanced);

    return (
      <div className="flex justify-start">
        <div className="max-w-[94%] rounded-2xl border border-[#D4E1F0] bg-card px-4 py-4 sm:max-w-[92%]">
          <p className="text-xs text-primary">Butuh konfirmasi</p>
          {!isCardActive ? (
            <p className="mt-1 text-xs text-muted-foreground">Konfirmasi ini sudah tidak aktif.</p>
          ) : null}
          <div className="mt-2 flex items-start gap-2">
            <FileText className="mt-0.5 h-4 w-4 text-primary" />
            <div>
              <p className="text-sm font-semibold text-foreground">Simpan laporan neraca</p>
              <p className="text-xs text-muted-foreground">Per {formatDateId(report.reportDate)}</p>
            </div>
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

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              size="default"
              disabled={isBusy || !isCardActive}
              onClick={() => onConfirm(item)}
              className="px-4 py-2.5"
            >
              <Check className="h-4 w-4" />
              Simpan Neraca
            </Button>
            <Button
              type="button"
              size="default"
              variant="destructive"
              disabled={isBusy || !isCardActive}
              onClick={() => onCancel(item)}
              className="px-4 py-2.5"
            >
              <X className="h-4 w-4" />
              Batalkan
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[94%] rounded-2xl border border-[#D4E1F0] bg-card px-4 py-4 sm:max-w-[92%]">
        <p className="text-xs text-primary">Butuh konfirmasi</p>
        {!isCardActive ? (
          <p className="mt-1 text-xs text-muted-foreground">Konfirmasi ini sudah tidak aktif.</p>
        ) : null}
        <p className="mt-1 text-sm text-foreground">
          {getIntentLabel(proposedAction.intent)}
        </p>

        {editingThisCard ? (
          <form onSubmit={(event) => onEditSubmit(event, item)} className="mt-3 grid gap-2">
            <input
              type="number"
              min="1"
              value={editFields.amount}
              onChange={(event) => onEditFieldChange("amount", event.target.value)}
              className="h-10 rounded-lg border border-border px-3 text-sm"
            />
            <input
              type="date"
              value={editFields.date}
              onChange={(event) => onEditFieldChange("date", event.target.value)}
              className="h-10 rounded-lg border border-border px-3 text-sm"
            />
            <input
              type="text"
              value={editFields.description}
              onChange={(event) => onEditFieldChange("description", event.target.value)}
              className="h-10 rounded-lg border border-border px-3 text-sm"
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={isBusy}>
                Simpan edit
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={onCancelEdit}>
                Batal
              </Button>
            </div>
          </form>
        ) : (
          <>
            <dl className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Jumlah</dt>
                <dd>{formatIdr(proposedAction.amount)}</dd>
              </div>
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
              <p className="mt-3 rounded-lg border border-[#D4E1F0] bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
                {proposedAction.warning}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                size="default"
                disabled={isBusy || !isCardActive}
                onClick={() => onConfirm(item)}
                className="px-4 py-2.5"
              >
                <Check className="h-4 w-4" />
                Simpan
              </Button>
              <Button
                type="button"
                size="default"
                variant="outline"
                disabled={isBusy || !isCardActive}
                onClick={() => onStartEdit(item)}
                className="px-4 py-2.5"
              >
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
              <Button
                type="button"
                size="default"
                variant="destructive"
                disabled={isBusy || !isCardActive}
                onClick={() => onCancel(item)}
                className="px-4 py-2.5"
              >
                <X className="h-4 w-4" />
                Batalkan
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

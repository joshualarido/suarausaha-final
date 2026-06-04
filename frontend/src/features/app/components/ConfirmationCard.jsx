import { Check, Pencil, X } from "lucide-react";
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
  const editingThisCard = isEditing && activeConfirmation?.id === item.data.id;
  const isCardActive = item.data.id === pendingConfirmationRequestId;

  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] rounded-2xl border border-[#D4E1F0] bg-card px-4 py-4">
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
                <dt className="text-muted-foreground">Akun</dt>
                <dd>{proposedAction.paymentAccountName ?? "Kas"}</dd>
              </div>
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

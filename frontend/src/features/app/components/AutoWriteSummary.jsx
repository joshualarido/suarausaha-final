import { formatDateId } from "@/lib/date-format";
import { formatIdr, getIntentLabel } from "@/features/app/chat-normalizers";

export function AutoWriteSummary({ item }) {
  const action = item.data.proposedAction;

  return (
    <div className="flex justify-start">
      <div className="max-w-[94%] rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-4 sm:max-w-[92%]">
        <p className="text-xs font-medium text-emerald-700">Tersimpan otomatis</p>
        <p className="mt-1 text-sm text-foreground">{item.data.message}</p>
        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Jenis</dt>
            <dd>{getIntentLabel(action.intent)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Jumlah</dt>
            <dd>{formatIdr(action.amount)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Tanggal</dt>
            <dd>{formatDateId(action.date)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Akun</dt>
            <dd>{action.paymentAccountName ?? "Kas"}</dd>
          </div>
          {action.affectedObject ? (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Objek</dt>
              <dd className="text-right">{action.affectedObject}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Keterangan</dt>
            <dd className="text-right">{action.description}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

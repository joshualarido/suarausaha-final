import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatIdr } from "@/features/app/chat-normalizers";

export function FloatingDetailPanel({ title, subtitle, children, onClose }) {
  const previouslyFocusedElement = useRef(null);

  useEffect(() => {
    previouslyFocusedElement.current = document.activeElement;
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocusedElement.current instanceof HTMLElement) {
        previouslyFocusedElement.current.focus();
      }
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/35 p-0 sm:items-center sm:p-4" onMouseDown={onClose}>
      <section
        className="motion-enter-scale max-h-[92vh] w-full overflow-hidden rounded-t-xl border border-border bg-card shadow-xl sm:max-w-2xl sm:rounded-xl"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="su-type-section-title truncate text-foreground">{title}</h2>
            {subtitle ? <p className="su-type-helper mt-1 text-muted-foreground">{subtitle}</p> : null}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onClose} className="h-9 w-9 shrink-0 p-0" aria-label="Tutup detail">
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </header>
        <div className="su-scrollbar max-h-[calc(92vh-5rem)] overflow-y-auto px-5 py-4">{children}</div>
      </section>
    </div>
  );
}

export function DetailSection({ title, children }) {
  return (
    <section className="border-t border-border py-4 first:border-t-0 first:pt-0">
      <h3 className="su-type-ui text-foreground">{title}</h3>
      <div className="mt-3 grid gap-2">{children}</div>
    </section>
  );
}

export function DetailRow({ label, value }) {
  return (
    <div className="grid gap-1 rounded-lg bg-secondary/25 px-3 py-2 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm font-medium text-foreground">{value ?? "-"}</dd>
    </div>
  );
}

export function DetailMoneyRow({ label, value }) {
  return <DetailRow label={label} value={formatIdr(value ?? 0)} />;
}

export function DetailJsonBlock({ value }) {
  if (!value) return <p className="su-type-helper text-muted-foreground">Tidak ada data.</p>;
  return (
    <pre className="max-h-72 overflow-auto rounded-lg border border-border bg-background p-3 text-xs leading-5 text-foreground">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

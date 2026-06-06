import { Eye } from "lucide-react";

export function RowDetailButton({ onClick, label = "Lihat detail" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground opacity-100 shadow-sm transition hover:border-primary/40 hover:text-primary focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring/30 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
    >
      <Eye className="h-4 w-4" aria-hidden />
    </button>
  );
}

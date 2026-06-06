import { Hourglass } from "lucide-react";

export function LoadingState({ title, description, className = "" }) {
  return (
    <section className={`motion-enter-up rounded-lg border border-border bg-card p-6 shadow-sm ${className}`}>
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <Hourglass className="h-8 w-8 animate-spin text-primary" aria-hidden />
        <div>
          <p className="su-type-ui text-foreground">{title}</p>
          {description ? <p className="su-type-helper mt-1 text-muted-foreground">{description}</p> : null}
        </div>
      </div>
    </section>
  );
}

export function TableLoadingRow({ colSpan, label }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-6">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Hourglass className="h-4 w-4 animate-spin text-primary" aria-hidden />
          <span>{label}</span>
        </div>
      </td>
    </tr>
  );
}

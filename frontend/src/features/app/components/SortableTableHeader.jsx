import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

export function SortableTableHeader({
  label,
  sortKey,
  currentSort,
  onSort,
  align = "left",
  defaultDirection = "desc",
}) {
  const isActive = currentSort.sortBy === sortKey;
  const Icon = !isActive ? ArrowUpDown : currentSort.sortDirection === "asc" ? ArrowUp : ArrowDown;
  const headerClass =
    align === "right"
      ? "px-4 py-3 text-right font-medium text-muted-foreground"
      : "px-4 py-3 text-left font-medium text-muted-foreground";
  const buttonClass =
    align === "right"
      ? "inline-flex w-full items-center justify-end gap-1.5 rounded-sm text-right text-current hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
      : "inline-flex w-full items-center justify-start gap-1.5 rounded-sm text-left text-current hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

  return (
    <th className={headerClass}>
      <button
        type="button"
        onClick={() => onSort(sortKey, defaultDirection)}
        className={buttonClass}
      >
        <span>{label}</span>
        <Icon aria-hidden className="h-3.5 w-3.5" />
      </button>
    </th>
  );
}

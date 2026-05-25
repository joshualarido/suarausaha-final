import { Button } from "@/components/ui/button";

function buildNearestPages(currentPage, totalPages) {
  const safeCurrentPage = Math.max(1, Math.min(currentPage, totalPages));
  const count = Math.min(3, totalPages);
  let start = Math.max(1, safeCurrentPage - 1);
  let end = start + count - 1;

  if (end > totalPages) {
    end = totalPages;
    start = Math.max(1, end - count + 1);
  }

  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

export function PaginationControls({ page, totalPages, isLoading, onPageChange }) {
  const pages = buildNearestPages(page, totalPages);

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={page <= 1 || isLoading}
        onClick={() => onPageChange(page - 1)}
        aria-label="Halaman sebelumnya"
      >
        {"<-"}
      </Button>

      {pages.map((pageNumber) => (
        <Button
          key={pageNumber}
          type="button"
          variant={pageNumber === page ? "default" : "outline"}
          size="sm"
          disabled={isLoading}
          onClick={() => onPageChange(pageNumber)}
          aria-current={pageNumber === page ? "page" : undefined}
        >
          {pageNumber}
        </Button>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={page >= totalPages || isLoading}
        onClick={() => onPageChange(page + 1)}
        aria-label="Halaman berikutnya"
      >
        {"->"}
      </Button>
    </div>
  );
}

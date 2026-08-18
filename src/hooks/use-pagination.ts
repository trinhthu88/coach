import { useEffect, useState } from "react";

const DEFAULT_PAGE_SIZE = 25;

/**
 * Client-side pagination over an already-filtered array. Resets to page 1
 * whenever any value in `resetKeys` changes (pass the search/filter state
 * that produced `items`, so changing a filter doesn't leave the user
 * stranded on a now out-of-range page).
 */
export function usePagination<T>(items: T[], resetKeys: unknown[], pageSize = DEFAULT_PAGE_SIZE) {
  const [page, setPage] = useState(1);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1); }, resetKeys);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const pageSafe = Math.min(page, totalPages);
  const paged = items.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);

  return { page: pageSafe, setPage, totalPages, paged };
}

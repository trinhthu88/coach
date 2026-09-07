import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shared full-page loading placeholder — replaces the centered Loader2
 * spinner previously duplicated across several top-level pages. `showHeader`
 * is off for pages that already render their real header/filters before the
 * loading branch (e.g. Coaches.tsx keeps search/filter chips interactive
 * while results load) — there, only the content-row skeleton applies.
 */
export function PageSkeleton({ rows = 4, showHeader = true }: { rows?: number; showHeader?: boolean }) {
  return (
    <div className="space-y-4">
      {showHeader && (
        <>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-72" />
        </>
      )}
      <div className="space-y-3 mt-6">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}

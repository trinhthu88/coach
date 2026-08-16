import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { Client } from "@/hooks/coach/types";
import { paletteFor, initialsOf, programmeLabel } from "./clientDisplay";

export function ClientRow({ client, onOpen }: { client: Client; onOpen: () => void }) {
  const av = paletteFor(client.id);
  const pct = client.milestonesTotal
    ? Math.round((client.milestonesDone / client.milestonesTotal) * 100)
    : 0;

  const avatar = (
    <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold", av)}>
      {client.avatar_url ? (
        <img src={client.avatar_url} alt={client.full_name} className="h-full w-full rounded-full object-cover" />
      ) : (
        initialsOf(client.full_name)
      )}
    </div>
  );

  const programmeBadge = (
    <span className="w-fit shrink-0 rounded-full bg-primary-soft px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">
      {programmeLabel(client)}
    </span>
  );

  const progressBar = (
    <div className="min-w-0">
      <p className="mb-1.5 text-[11px] text-muted-foreground">
        {client.totalSessions} session{client.totalSessions === 1 ? "" : "s"} · {pct}%
      </p>
      <div className="h-1.5 w-full max-w-[160px] overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );

  const nextSession = client.nextSession ? (
    <span className="text-sm font-semibold text-foreground">
      {format(new Date(client.nextSession), "EEE HH:mm")}
    </span>
  ) : (
    <span className="text-sm font-semibold text-accent">Not scheduled</span>
  );

  return (
    <button type="button" onClick={onOpen} className="block w-full text-left transition-colors hover:bg-muted/30">
      {/* Mobile: stacked card */}
      <div className="flex flex-col gap-3 px-4 py-4 md:hidden">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {avatar}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{client.full_name}</p>
              <p className="truncate text-[11px] text-muted-foreground">{client.email}</p>
            </div>
          </div>
          {programmeBadge}
        </div>
        {progressBar}
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>Next session</span>
          {nextSession}
        </div>
      </div>

      {/* Desktop: grid row */}
      <div className="hidden grid-cols-[1.6fr_0.9fr_1.3fr_0.9fr] items-center gap-4 px-5 py-4 md:grid">
        <div className="flex min-w-0 items-center gap-3">
          {avatar}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{client.full_name}</p>
            <p className="truncate text-[11px] text-muted-foreground">{client.email}</p>
          </div>
        </div>
        {programmeBadge}
        {progressBar}
        {nextSession}
      </div>
    </button>
  );
}

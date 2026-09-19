import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { formatProfileDateTime, ratioPct } from "@/lib/programmeProfile";
import { sessionDetailPath } from "@/lib/sessionPaths";
import type { DevelopmentSessionItem } from "@/hooks/journey/developmentSessionTypes";
import { ProfileLoadError } from "../primitives";
import { sessionStatusTone } from "@/lib/moduleSessions";

/**
 * Shared presentation for the four "My development" module pages (Coaching,
 * Peer coaching, Mentoring, Triads), following the Coachee prototype's
 * module layout: page header → two-card grid → session list. These
 * components only render what they are given: progress comes from the
 * canonical progress row, sessions from learner_session_history, people from
 * their canonical sources. Nothing here counts or derives completion.
 */

export function ModulePageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  const { t } = useTranslation("dashboard");
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="text-[9.5px] font-extrabold uppercase tracking-[.18em] text-[#2c8fa8]">{t("learnerModules.eyebrow")}</div>
        <h1 className="mt-[9px] font-serif text-[30px] font-light leading-[1.1] tracking-[-.025em] text-[#062f3e]">{title}</h1>
        <p className="mt-2 max-w-[70ch] text-[12.5px] text-[#7d7468]">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

/** Primary navy pill CTA (design: "Book session", "Book peer session", …). */
export function ModulePrimaryAction({ to, href, children }: { to?: string; href?: string; children: ReactNode }) {
  const className = "rounded-full bg-[#062f3e] px-[19px] py-[11px] text-[12px] font-bold text-white transition-colors hover:bg-[#0a3f53]";
  if (to) {
    return (
      <Link to={to} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

export function ModuleCard({ children, className, id, testId }: { children: ReactNode; className?: string; id?: string; testId?: string }) {
  return (
    <section id={id} data-testid={testId} className={cn("rounded-[16px] border border-[#e6e0d6] bg-[#fffdf9] p-5", className)}>
      {children}
    </section>
  );
}

export function ModuleEyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("text-[9.5px] font-extrabold uppercase tracking-[.18em] text-[#2c8fa8]", className)}>{children}</div>;
}

export function ModuleChip({ children }: { children: ReactNode }) {
  return <span className="rounded-full border border-[#efeae1] bg-[#fbf8f2] px-3 py-2 text-[11px] text-[#062f3e]">{children}</span>;
}

function initialsOf(name: string | null | undefined) {
  return (name || "?")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/** "My coach" / "My mentor" card — the person comes from its canonical source (allowlist / session counterpart). */
export function ModulePersonCard({
  eyebrow,
  name,
  subtitle,
  avatarUrl,
  chips,
  empty,
  action,
  testId,
}: {
  eyebrow: string;
  name: string | null;
  subtitle?: string | null;
  avatarUrl?: string | null;
  chips?: ReactNode;
  empty?: string;
  action?: ReactNode;
  testId?: string;
}) {
  return (
    <ModuleCard testId={testId}>
      {name ? (
        <>
          <div className="flex items-center gap-[15px]">
            <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-[18px] bg-[#e4f1f5] font-serif text-[20px] text-[#226d80]">
              {avatarUrl ? <img src={avatarUrl} alt={name} className="h-full w-full object-cover" /> : initialsOf(name)}
            </div>
            <div className="min-w-0">
              <ModuleEyebrow>{eyebrow}</ModuleEyebrow>
              <h2 className="mt-[5px] truncate font-serif text-[19px] font-normal tracking-[-.02em] text-[#062f3e]">{name}</h2>
              {subtitle && <p className="mt-1 truncate text-[11.5px] text-[#7d7468]">{subtitle}</p>}
            </div>
          </div>
          {chips && <div className="mt-4 flex flex-wrap gap-2">{chips}</div>}
          {action && <div className="mt-4">{action}</div>}
        </>
      ) : (
        <>
          <ModuleEyebrow>{eyebrow}</ModuleEyebrow>
          <p className="mt-3 text-[12px] leading-relaxed text-[#7d7468]">{empty}</p>
          {action && <div className="mt-4">{action}</div>}
        </>
      )}
    </ModuleCard>
  );
}

/**
 * Module progress — renders the canonical module ratio from the progress row
 * (e.g. coaching_completed_units / coaching_required_units). The bar is the
 * display width of that same ratio.
 */
export function ModuleProgressCard({
  title,
  completed,
  required,
  label,
  note,
  loading,
  testId = "module-progress-card",
}: {
  title?: string;
  completed: number | null | undefined;
  required: number | null | undefined;
  label: string;
  note?: string;
  loading?: boolean;
  testId?: string;
}) {
  const known = completed != null && required != null;
  const pct = ratioPct(completed, required) ?? 0;
  return (
    <ModuleCard testId={testId}>
      {title && <h2 className="mb-4 font-serif text-[19px] font-normal tracking-[-.02em] text-[#062f3e]">{title}</h2>}
      {loading ? (
        <div className="h-12 animate-pulse rounded-lg bg-[#eee8de]" />
      ) : (
        <>
          <div data-testid="module-progress-value" className="font-serif text-[30px] font-light leading-none text-[#062f3e]">
            {known ? `${completed} / ${required}` : "—"}
          </div>
          <div className="mt-2 text-[9px] font-extrabold uppercase tracking-[.14em] text-[#7d7468]">{label}</div>
          <div className="mt-[14px] h-1.5 overflow-hidden rounded-full bg-[#efeae1]">
            <i className="block h-full rounded-full bg-[#2c8fa8]" style={{ width: `${pct}%` }} />
          </div>
        </>
      )}
      {note && <p className="mt-[13px] text-[11px] leading-[1.6] text-[#7d7468]">{note}</p>}
    </ModuleCard>
  );
}

/** A quoted piece of learner-visible feedback (design: "Feedback received"). */
export function ModuleFeedbackQuote({ eyebrow, quote, byline, empty }: { eyebrow: string; quote: string | null; byline?: string; empty: string }) {
  return (
    <ModuleCard>
      <ModuleEyebrow>{eyebrow}</ModuleEyebrow>
      {quote ? (
        <>
          <p className="mt-[11px] font-serif text-[13.5px] leading-[1.55] text-[#3f3a33]">“{quote}”</p>
          {byline && <div className="mt-[11px] text-[10px] text-[#9a9287]">{byline}</div>}
        </>
      ) : (
        <p className="mt-[11px] text-[11.5px] text-[#7d7468]">{empty}</p>
      )}
    </ModuleCard>
  );
}

/**
 * One canonical session record as a design "session row": type eyebrow (with
 * the learner's role), title, counterpart · when · context, real lifecycle
 * status. Opens the session detail resolved from its source table.
 */
export function ModuleSessionRow({ session, context }: { session: DevelopmentSessionItem; context?: string | null }) {
  const { t } = useTranslation("journey");
  const path = sessionDetailPath(session);
  const people = session.counterpartNames?.length ? session.counterpartNames.join(" · ") : session.counterpartName;
  const when = session.startTime ? formatProfileDateTime(session.startTime) : t("developmentSessions.timeTbd");
  const body = (
    <>
      <div className="min-w-0">
        <div className="text-[8.5px] font-extrabold uppercase tracking-[.14em] text-[#2c8fa8]">
          {t(`developmentSessions.types.${session.type}`)}
          {session.participantRole && ` · ${t(`developmentSessions.roles.${session.participantRole}`, { defaultValue: session.participantRole })}`}
        </div>
        <div className="mt-[5px] truncate text-[13px] font-semibold text-[#062f3e]">
          {session.title || t(`developmentSessions.types.${session.type}`)}
        </div>
        <div className="mt-[3px] text-[10.5px] text-[#7d7468]">{[people, when, context].filter(Boolean).join(" · ")}</div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {session.isProgrammeEvidence && (
          <span data-testid="programme-evidence" className="rounded-full bg-[#e8f1ec] px-2.5 py-1.5 text-[8.5px] font-extrabold uppercase tracking-[.08em] text-[#17663f]">
            {t("developmentSessions.countsTowardProgramme")}
          </span>
        )}
        <span className={cn("rounded-full px-[11px] py-1.5 text-[9px] font-extrabold uppercase tracking-[.08em]", sessionStatusTone(session.status))}>
          {t(`developmentSessions.status.${session.status}`, { defaultValue: session.status })}
        </span>
      </div>
    </>
  );
  const className = "flex w-full flex-wrap items-center justify-between gap-[14px] rounded-[14px] border border-[#e6e0d6] bg-[#fffdf9] p-4 text-left transition-colors hover:border-[#8bd3e3]";
  return path ? (
    <Link to={path} data-testid="session-row" data-source={session.sourceType} data-status={session.status} className={className}>
      {body}
    </Link>
  ) : (
    <div data-testid="session-row" data-source={session.sourceType} data-status={session.status} className={className}>
      {body}
    </div>
  );
}

/** Design "… sessions" list — canonical history, with distinct empty and error states. */
export function ModuleSessionList({
  label,
  sessions,
  loading,
  error,
  empty,
  errorText,
  context,
  testId,
}: {
  label: string;
  sessions: DevelopmentSessionItem[];
  loading: boolean;
  error: string | null;
  empty: string;
  errorText: string;
  context?: (session: DevelopmentSessionItem) => string | null;
  testId?: string;
}) {
  return (
    <div data-testid={testId} className="flex flex-col gap-2.5">
      <div className="text-[9px] font-extrabold uppercase tracking-[.2em] text-[#9a9287]">{label}</div>
      {loading ? (
        <div className="h-16 animate-pulse rounded-[14px] bg-[#eee8de]" />
      ) : error ? (
        <ProfileLoadError text={errorText} />
      ) : sessions.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-[#ddd6cc] bg-[#fffdf9] p-4 text-center text-[12px] text-[#7d7468]">{empty}</div>
      ) : (
        sessions.map((session) => <ModuleSessionRow key={session.id} session={session} context={context?.(session) ?? null} />)
      )}
    </div>
  );
}

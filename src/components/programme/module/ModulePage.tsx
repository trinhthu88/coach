import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { formatProfileDate, formatProfileDateTime, ratioPct } from "@/lib/programmeProfile";
import { sessionDetailPath } from "@/lib/sessionPaths";
import type { DevelopmentSessionItem } from "@/hooks/journey/developmentSessionTypes";
import { ProfileLoadError } from "../primitives";
import { sessionStatusTone } from "@/lib/moduleSessions";
import { deliverableKey, type DeliverableKey, type SessionDeliverable } from "@/lib/postSessionDeliverables";
import type { PendingDeliverable } from "@/lib/pendingReflections";
import type { ModuleRequirementState } from "@/hooks/journey/useModuleRequirements";
import type { ModuleAction, ModuleGoal } from "@/hooks/journey/useModuleGoalsActions";

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
export function ModuleSessionRow({
  session,
  context,
  outstanding,
}: {
  session: DevelopmentSessionItem;
  context?: string | null;
  /** Post-session items still owed on this (held) session, from learner_session_deliverables. */
  outstanding?: DeliverableKey[];
}) {
  const { t: tDash } = useTranslation("dashboard");
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
        {outstanding && outstanding.length > 0 && (
          <span
            data-testid="session-followup-outstanding"
            title={outstanding.map((key) => tDash(`learnerModules.shared.items.${key}`)).join(" · ")}
            className="rounded-full bg-[#fbeee5] px-2.5 py-1.5 text-[8.5px] font-extrabold uppercase tracking-[.08em] text-[#a8541c]"
          >
            {tDash("learnerModules.shared.followUpOutstanding", { count: outstanding.length })}
          </span>
        )}
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
  outstandingBySession,
  testId,
}: {
  label: string;
  sessions: DevelopmentSessionItem[];
  loading: boolean;
  error: string | null;
  empty: string;
  errorText: string;
  context?: (session: DevelopmentSessionItem) => string | null;
  /** deliverableKey(sourceTable, sessionId) -> outstanding post-session items. */
  outstandingBySession?: Map<string, DeliverableKey[]>;
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
        sessions.map((session) => (
          <ModuleSessionRow
            key={session.id}
            session={session}
            context={context?.(session) ?? null}
            outstanding={outstandingBySession?.get(deliverableKey(session.sourceType, session.sourceId))}
          />
        ))
      )}
    </div>
  );
}

/**
 * Progress, next requirement and booking — the first section of every module
 * page. Counts come from the canonical module row (completed / required / due
 * / overdue), the next requirement and its deadline from the canonical
 * fulfilment functions. `booking` is the page's own booking action, rendered
 * under the goal gate (BookingGoalGate) the caller passes as `gate`.
 */
export function ModuleRequirementCard({
  moduleLabel,
  state,
  loading,
  error,
  gate,
  booking,
  testId = "module-requirements",
}: {
  /** Singular label for a unit of this module, e.g. "Coaching" ("Coaching 2"). */
  moduleLabel: string;
  state: ModuleRequirementState | null;
  loading: boolean;
  error: string | null;
  gate?: ReactNode;
  booking?: ReactNode;
  testId?: string;
}) {
  const { t } = useTranslation("dashboard");
  const next = state?.next ?? null;
  return (
    <ModuleCard testId={testId}>
      <ModuleEyebrow>{t("learnerModules.shared.progressEyebrow")}</ModuleEyebrow>
      {loading ? (
        <div className="mt-3 h-12 animate-pulse rounded-lg bg-[#eee8de]" />
      ) : error ? (
        <div className="mt-3"><ProfileLoadError text={t("learnerModules.shared.requirementsError")} /></div>
      ) : !state || state.required == null || state.required === 0 ? (
        <p className="mt-3 text-[12px] text-[#7d7468]" data-testid="module-not-required">{t("learnerModules.shared.notRequired")}</p>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="module-requirement-counts">
            {([
              ["completed", `${state.completed ?? 0} / ${state.required}`],
              ["due", String(state.due ?? 0)],
              ["overdue", String(state.overdue ?? 0)],
              ["booked", String(state.booked ?? 0)],
            ] as const).map(([key, value]) => (
              <div key={key} data-testid={`module-count-${key}`} className="rounded-[10px] border border-[#efeae1] bg-white px-3 py-2">
                <dt className="text-[9px] font-extrabold uppercase tracking-[.12em] text-[#9a9287]">{t(`learnerModules.shared.counts.${key}`)}</dt>
                <dd className={cn("mt-1 font-serif text-[20px] text-[#062f3e]", key === "overdue" && Number(value) > 0 && "text-[#a8541c]")}>{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4" data-testid="module-next-requirement">
            {next ? (
              <p className="text-[12px] text-[#3f3a33]">
                <strong>{t("learnerModules.shared.nextRequirement", { module: moduleLabel, n: next.ordinal })}</strong>
                {" · "}
                <span className={cn(next.overdue && !next.bookedOn && "font-semibold text-[#a8541c]")}>
                  {t(next.overdue ? "learnerModules.shared.wasDue" : "learnerModules.shared.dueBy", { date: formatProfileDate(next.dueOn) })}
                </span>
                {" · "}
                <span data-testid="module-next-state">
                  {next.bookedOn
                    ? t("learnerModules.shared.bookedFor", { date: formatProfileDate(next.bookedOn) })
                    : t("learnerModules.shared.notBooked")}
                </span>
              </p>
            ) : (
              <p className="text-[12px] text-[#17663f]">{t("learnerModules.shared.allRequirementsMet")}</p>
            )}
          </div>
        </>
      )}
      {gate && <div className="mt-4">{gate}</div>}
      {booking && <div className="mt-4 flex flex-wrap gap-2">{booking}</div>}
    </ModuleCard>
  );
}

/**
 * Post-session evidence — held sessions whose deliverables are still
 * outstanding, highlighted, each linked to where they are completed. Rows are
 * learner_session_deliverables for this module; nothing is recomputed here.
 */
export function ModuleEvidenceCard({
  pending,
  total,
  loading,
  error,
  testId = "module-evidence",
}: {
  pending: PendingDeliverable[];
  /** Held sessions with deliverables (complete or not). */
  total: number;
  loading: boolean;
  error: string | null;
  testId?: string;
}) {
  const { t } = useTranslation("dashboard");
  return (
    <ModuleCard testId={testId}>
      <ModuleEyebrow>{t("learnerModules.shared.evidenceEyebrow")}</ModuleEyebrow>
      <h2 className="mt-[7px] font-serif text-[19px] font-normal tracking-[-.02em] text-[#062f3e]">{t("learnerModules.shared.evidenceTitle")}</h2>
      {loading ? (
        <div className="mt-3 h-12 animate-pulse rounded-lg bg-[#eee8de]" />
      ) : error ? (
        <div className="mt-3"><ProfileLoadError text={t("learnerModules.shared.evidenceError")} /></div>
      ) : pending.length === 0 ? (
        <p className="mt-2 text-[11.5px] text-[#17663f]" data-testid="module-evidence-complete">
          {total > 0 ? t("learnerModules.shared.evidenceAllDone", { count: total }) : t("learnerModules.shared.evidenceNone")}
        </p>
      ) : (
        <>
          <p className="mt-2 text-[11.5px] font-semibold text-[#a8541c]">
            {t("learnerModules.shared.evidenceOutstanding", { count: pending.length })}
          </p>
          <ul className="mt-3 space-y-2">
            {pending.map(({ deliverable, outstanding, path }) => (
              <li key={`${deliverable.sourceTable}:${deliverable.sessionId}`}>
                <Link
                  to={path}
                  data-testid="module-evidence-item"
                  className="block rounded-[12px] border border-[#f0d5cc] bg-[#fdf6f2] px-3 py-2 text-[12px] transition-colors hover:border-[#8bd3e3]"
                >
                  <span className="font-semibold text-[#062f3e]">
                    {deliverable.title || t("learnerModules.shared.untitledSession")}
                  </span>
                  {deliverable.startTime && <span className="text-[#9a938a]"> · {formatProfileDate(deliverable.startTime)}</span>}
                  {deliverable.participantRole && ["provider", "receiver"].includes(deliverable.participantRole) && (
                    <span className="text-[#9a938a]"> · {t(`learnerModules.shared.roles.${deliverable.participantRole}`)}</span>
                  )}
                  <span className="mt-0.5 block text-[10.5px] text-[#a8541c]">
                    {outstanding.map((key) => t(`learnerModules.shared.items.${key}`)).join(" · ")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </ModuleCard>
  );
}

/**
 * Goals and actions connected to this module's sessions: how many held
 * sessions carry a goal check-in and a follow-up action (same canonical rows),
 * the goals checked in on during them and the actions written on them, with
 * the way to the goals themselves.
 */
export function ModuleGoalsActionsCard({
  deliverables,
  goalsHref,
  goals = [],
  actions = [],
  testId = "module-goals-actions",
}: {
  deliverables: SessionDeliverable[];
  goalsHref: string;
  goals?: ModuleGoal[];
  actions?: ModuleAction[];
  testId?: string;
}) {
  const { t } = useTranslation("dashboard");
  const checkins = deliverables.filter((d) => d.hasGoalCheckin).length;
  const withAction = deliverables.filter((d) => d.hasAction).length;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <ModuleCard testId={testId}>
      <ModuleEyebrow>{t("learnerModules.shared.goalsEyebrow")}</ModuleEyebrow>
      <div className="mt-3 flex flex-wrap gap-2">
        <ModuleChip>
          <strong data-testid="module-checkin-count">{checkins}</strong> / {deliverables.length} {t("learnerModules.shared.withCheckin")}
        </ModuleChip>
        <ModuleChip>
          <strong data-testid="module-action-count">{withAction}</strong> / {deliverables.length} {t("learnerModules.shared.withAction")}
        </ModuleChip>
      </div>
      {goals.length > 0 && (
        <ul className="mt-3 space-y-1.5" data-testid="module-goals">
          {goals.map((g) => (
            <li key={g.id} className="text-[12px] text-[#062f3e]">
              <span className="font-semibold">{g.title}</span>
              <span className="text-[#9a938a]"> · {t("learnerModules.shared.goalCheckins", { count: g.checkins })}</span>
            </li>
          ))}
        </ul>
      )}
      {actions.length > 0 && (
        <ul className="mt-3 space-y-1.5" data-testid="module-actions">
          {actions.map((a) => {
            const done = a.status === "completed";
            const overdue = !done && !!a.dueDate && a.dueDate < today;
            return (
              <li key={a.id} data-testid="module-action" data-status={a.status} className="flex items-start gap-2 text-[12px]">
                <span aria-hidden className={cn("mt-1 inline-block h-2 w-2 shrink-0 rounded-full", done ? "bg-[#17663f]" : overdue ? "bg-[#a8541c]" : "bg-[#2c8fa8]")} />
                <span className={cn("text-[#062f3e]", done && "text-[#9a938a] line-through")}>
                  {a.title}
                  {a.dueDate && !done && (
                    <span className={cn("no-underline", overdue ? "text-[#a8541c]" : "text-[#9a938a]")}>
                      {" "}· {t(overdue ? "learnerModules.shared.actionWasDue" : "learnerModules.shared.actionDue", { date: formatProfileDate(a.dueDate) })}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <Link to={goalsHref} className="mt-3 inline-block text-[11px] font-bold text-[#2c8fa8] hover:underline">
        {t("learnerModules.shared.openGoals")}
      </Link>
    </ModuleCard>
  );
}

function UpcomingSessionLink({ session }: { session: DevelopmentSessionItem }) {
  const { t } = useTranslation("dashboard");
  const path = sessionDetailPath(session);
  const className = "mt-3 block rounded-[12px] border border-[#e6e0d6] bg-white px-3 py-2 text-[12px] transition-colors hover:border-[#8bd3e3]";
  const body = (
    <>
      <span className="font-semibold text-[#062f3e]">{session.title || t("learnerModules.shared.untitledSession")}</span>
      {session.startTime && <span className="text-[#9a938a]"> · {formatProfileDateTime(session.startTime)}</span>}
      {session.counterpartName && <span className="text-[#9a938a]"> · {session.counterpartName}</span>}
    </>
  );
  return path ? (
    <Link to={path} data-testid="module-upcoming-session" className={className}>{body}</Link>
  ) : (
    <div data-testid="module-upcoming-session" className={className}>{body}</div>
  );
}

/** The next open session of the module (one shape on every module page). */
export function ModuleUpcomingCard({
  session,
  loading,
  testId = "module-upcoming",
}: {
  session: DevelopmentSessionItem | null;
  loading: boolean;
  testId?: string;
}) {
  const { t } = useTranslation("dashboard");
  return (
    <ModuleCard testId={testId}>
      <ModuleEyebrow>{t("learnerModules.shared.upcomingEyebrow")}</ModuleEyebrow>
      {loading ? (
        <div className="mt-3 h-10 animate-pulse rounded-lg bg-[#eee8de]" />
      ) : session ? (
        <UpcomingSessionLink session={session} />
      ) : (
        <p className="mt-2 text-[11.5px] text-[#7d7468]" data-testid="module-upcoming-none">{t("learnerModules.noneBooked")}</p>
      )}
    </ModuleCard>
  );
}

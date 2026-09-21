import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useMyTriads, useMyTriadStatus, type TriadGroupEntry, type TriadMilestoneView, type TriadStatusView } from "@/hooks/triads/useMyTriads";
import { useModuleWorkspace } from "@/hooks/journey/useModuleWorkspace";
import type { DevelopmentSessionItem } from "@/hooks/journey/developmentSessionTypes";
import { formatProfileDate } from "@/lib/programmeProfile";
import { sessionStatusTone } from "@/lib/moduleSessions";
import { sessionDetailPath } from "@/lib/sessionPaths";
import { ModuleCard, ModuleEyebrow, ModulePageHeader } from "@/components/programme/module/ModulePage";
import { ModuleWorkspaceSections } from "@/components/programme/module/ModuleWorkspaceSections";
import { deliverableKey, type DeliverableKey } from "@/lib/postSessionDeliverables";
import { ProfileLoadError } from "@/components/programme/primitives";
import { TriadSessionCard } from "./components/TriadSessionCard";
import { TriadAlternativeProposal } from "./components/TriadAlternativeProposal";

/**
 * Triads (Coachee prototype → Triads). EVERY REQUIRED TRIAD HAS ITS OWN
 * GROUP ASSIGNMENT, so the page is one section per required Triad
 * ("Triad 1", "Triad 2", …). Every fact comes from a canonical source:
 *  1. Progress — programme required units, each Triad's own deadline and
 *     the canonical fulfilment (learner_triad_status: a Triad is fulfilled by
 *     a completed session of ITS group, capped at required).
 *  2. Per Triad — the learner's group for that requirement (membership from
 *     triad_group_members, names via learner_triad_members) and its session;
 *     "Group assignment pending" until Admin assigns one. Everyone rotates
 *     roles, so no member owns one.
 *  3. Sessions — every Triad session of the enrollment's groups (active and
 *     closed) from learner_session_history, labelled "Triad N", with the
 *     learner's own reflection state from learner_triad_overview.
 */
export default function TriadsPage() {
  const { t } = useTranslation("triads");
  const { t: tDash } = useTranslation("dashboard");
  const ws = useModuleWorkspace("triads");
  const { groups, loading: groupsLoading, error: groupsError, refetch } = useMyTriads(ws.enrollmentId ?? null);
  const { status, loading: statusLoading, error: statusError } = useMyTriadStatus(ws.enrollmentId ?? null);

  const history = [...ws.sessions].sort((a, b) => new Date(a.startTime ?? 0).getTime() - new Date(b.startTime ?? 0).getTime());
  const reflectionBySession = new Map(
    groups.flatMap((g) => g.sessions.map((s) => [s.id, { submitted: s.reflectionSubmitted, selfRating: s.reflectionSatisfaction }] as const))
  );
  const unitBySession = new Map(groups.flatMap((g) => g.sessions.map((s) => [s.id, g.unitNumber] as const)));
  // The group shown for a requirement: its active group, else the latest one.
  const groupFor = (requirementId: string) =>
    groups.filter((g) => g.requirementId === requirementId).sort((a, b) => Number(b.isActive) - Number(a.isActive) || b.createdAt.localeCompare(a.createdAt))[0] ?? null;

  return (
    <div className="flex flex-col gap-[18px]">
      <ModulePageHeader
        title={tDash("learnerModules.triads.title")}
        subtitle={tDash("learnerModules.triads.subtitle")}
        action={
          <span
            data-testid="triad-progress-pill"
            className="rounded-full bg-[#e4f1f5] px-[13px] py-2 text-[9px] font-extrabold uppercase tracking-[.08em] text-[#226d80]"
          >
            {status && status.requiredUnits > 0
              ? tDash("learnerModules.triads.progressPill", { completed: status.completedUnits, required: status.requiredUnits })
              : status
                ? tDash("learnerModules.triads.noRequirementPill")
                : "—"}
          </span>
        }
      />

      <TriadProgressCard status={status} loading={statusLoading} error={statusError} />

      {/* Shared module structure: progress & next requirement, post-session
          evidence, goals & actions. Scheduling stays per requirement below. */}
      <ModuleWorkspaceSections ws={ws} module="triads" />

      {groupsLoading || statusLoading ? (
        <div className="flex items-center justify-center rounded-[16px] bg-[#062f3e] p-5">
          <Loader2 className="h-5 w-5 animate-spin text-white" />
        </div>
      ) : groupsError ? (
        <ModuleCard>
          <div role="alert" className="flex flex-col items-center gap-3 text-center text-sm">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <p className="text-muted-foreground">{t("loadError")}</p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              {t("retry")}
            </Button>
          </div>
        </ModuleCard>
      ) : (
        (status?.schedule ?? []).map((m) => <TriadRequirementSection key={m.requirementId} milestone={m} entry={groupFor(m.requirementId)} />)
      )}

      <ModuleCard testId="triad-history">
        <h2 className="font-serif text-[19px] font-normal tracking-[-.02em] text-[#062f3e]">{tDash("learnerModules.triads.roundsTitle")}</h2>
        <p className="mb-4 mt-[5px] text-[11.5px] text-[#7d7468]">
          {tDash("learnerModules.triads.roundsSubtitle")}
          {status && status.requiredUnits > 0 && (
            <>
              {" · "}
              <span data-testid="triad-progress">{t("history.progress", { completed: status.completedUnits, required: status.requiredUnits })}</span>
            </>
          )}
        </p>
        {ws.sessionsLoading ? (
          <div className="h-16 animate-pulse rounded-[13px] bg-[#eee8de]" />
        ) : ws.sessionsError ? (
          <ProfileLoadError text={t("history.loadError")} />
        ) : history.length === 0 ? (
          <p className="rounded-[13px] border border-dashed border-[#ddd6cc] bg-[#fbf8f2] p-4 text-center text-[12px] text-[#7d7468]">{t("history.empty")}</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {history.map((session) => (
              <TriadSessionRow
                key={session.id}
                session={session}
                unitNumber={session.requirementUnitNumber ?? unitBySession.get(session.sourceId) ?? null}
                status={reflectionBySession.get(session.sourceId) ?? null}
                statusLoading={groupsLoading}
                outstanding={ws.outstandingBySession.get(deliverableKey(session.sourceType, session.sourceId))}
              />
            ))}
          </div>
        )}
      </ModuleCard>
    </div>
  );
}

/** One required Triad: its deadline, its own group and that group's session. */
function TriadRequirementSection({ milestone, entry }: { milestone: TriadMilestoneView; entry: TriadGroupEntry | null }) {
  const { t } = useTranslation("triads");
  const n = milestone.milestone;
  const openSession = entry?.isActive && entry.session && (entry.session.status === "proposed" || entry.session.status === "confirmed");
  const state = milestone.satisfied ? "completed" : milestone.overdue ? "overdue" : entry?.isActive ? "assigned" : "pending";
  return (
    <section data-testid="triad-requirement" data-unit={n} data-state={state} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-[19px] font-normal tracking-[-.02em] text-[#062f3e]" data-testid="triad-requirement-title">
          {t("requirement.title", { n })}
        </h2>
        <p className="text-[11.5px] text-[#7d7468]">
          {t("requirement.due", { date: formatProfileDate(milestone.dueOn) })}
          {" · "}
          <span
            data-testid="triad-requirement-state"
            className={cn(
              "font-semibold",
              state === "completed" ? "text-[#17663f]" : state === "overdue" ? "text-[#a8541c]" : "text-[#4a463f]",
            )}
          >
            {state === "completed"
              ? t("requirement.completed", { date: milestone.fulfilledOn ? formatProfileDate(milestone.fulfilledOn) : "" })
              : t(`requirement.${state}`)}
          </span>
        </p>
      </div>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(290px,1fr))]">
        <TriadGroupCard entry={entry} unit={n} />
        {milestone.satisfied ? (
          <ModuleCard testId="triad-requirement-done">
            <p className="text-[12px] text-[#17663f]">{t("requirement.completedBody", { n })}</p>
          </ModuleCard>
        ) : !entry || !entry.isActive ? (
          <PendingAssignmentCard unit={n} />
        ) : openSession ? (
          // Accept / propose another time / mark completed live on the existing card.
          <TriadSessionCard entry={entry} untilDate={milestone.dueOn} />
        ) : (
          <ScheduleNextCard entry={entry} untilDate={milestone.dueOn} />
        )}
      </div>
    </section>
  );
}

function TriadProgressCard({ status, loading, error }: { status: TriadStatusView | null; loading: boolean; error: boolean }) {
  const { t } = useTranslation("triads");
  if (loading) return <div className="h-20 animate-pulse rounded-[16px] bg-[#eee8de]" />;
  if (error) return <ProfileLoadError text={t("loadError")} />;
  if (!status) return null;
  if (status.requiredUnits === 0) {
    return (
      <ModuleCard testId="triad-status">
        <p className="text-[12px] text-[#7d7468]">{t("progress.notRequired")}</p>
      </ModuleCard>
    );
  }
  const extra = Math.max(status.rawCompletedSessions - status.requiredUnits, 0);
  return (
    <ModuleCard testId="triad-status">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p data-testid="triad-status-progress" className="font-serif text-[22px] font-normal text-[#062f3e]">
          {t("progress.label", { completed: status.completedUnits, required: status.requiredUnits })}
        </p>
        <p className="text-[11.5px] text-[#7d7468]">
          {status.completedUnits >= status.requiredUnits
            ? t("progress.allDone")
            : status.nextDueOn
              ? <span data-testid="triad-next-deadline">{t("progress.nextDeadline", { date: formatProfileDate(status.nextDueOn) })}</span>
              : null}
        </p>
      </div>
      {status.overdueUnits > 0 && (
        <p data-testid="triad-overdue" className="mt-1 text-[11.5px] font-semibold text-[#a8541c]">{t("progress.overdue", { count: status.overdueUnits })}</p>
      )}
      {extra > 0 && <p className="mt-1 text-[11px] text-[#7d7468]">{t("progress.extra", { count: extra })}</p>}
      <ol className="mt-3 flex flex-wrap gap-2" data-testid="triad-schedule">
        {status.schedule.map((m) => (
          <li
            key={m.milestone}
            className={cn(
              "rounded-full border px-3 py-1.5 text-[11px]",
              m.satisfied ? "border-[#cfe6d8] bg-[#e8f1ec] text-[#17663f]" : m.isDue ? "border-[#f0d6c4] bg-[#fbeee5] text-[#a8541c]" : "border-[#efeae1] bg-white text-[#4a463f]",
            )}
          >
            {`${t("requirement.title", { n: m.milestone })} · ${formatProfileDate(m.dueOn)}`}
          </li>
        ))}
      </ol>
    </ModuleCard>
  );
}

function TriadGroupCard({ entry, unit }: { entry: TriadGroupEntry | null; unit: number }) {
  const { t } = useTranslation("triads");
  const { t: tDash } = useTranslation("dashboard");
  return (
    <ModuleCard testId="triad-group">
      <ModuleEyebrow>{t("requirement.group", { n: unit })}</ModuleEyebrow>
      {!entry ? (
        <p className="mt-3 text-[12px] text-[#7d7468]" data-testid="triad-group-pending">{t("requirement.pending")}</p>
      ) : (
        <>
          {!entry.isActive && <p className="mt-[7px] text-[11.5px] text-[#7d7468]">{t("closedGroup")}</p>}
          {entry.memberCount === 2 && <p className="mt-1.5 text-[11.5px] text-[#7d7468]">{t("dyadNote")}</p>}
          <div className="mt-4 grid gap-[9px] [grid-template-columns:repeat(auto-fit,minmax(130px,1fr))]">
            {entry.members.map((member) => (
              <div
                key={member.id}
                data-testid="triad-member"
                className={cn("rounded-[12px] border border-[#efeae1] p-[13px]", member.isSelf ? "bg-[#f2fafc]" : "bg-white")}
              >
                <div className="text-[9px] font-extrabold uppercase tracking-[.12em] text-[#9a9287]">
                  {member.isSelf ? t("you") : tDash("learnerModules.triads.member")}
                </div>
                <strong className="mt-1.5 block text-[12.5px] text-[#062f3e]">{member.full_name}</strong>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[10.5px] text-[#7d7468]">{tDash("learnerModules.triads.rotateRoles")}</p>
        </>
      )}
    </ModuleCard>
  );
}

/** The active group has no open session: propose the next one. */
function ScheduleNextCard({ entry, untilDate }: { entry: TriadGroupEntry; untilDate: string | null }) {
  const { t } = useTranslation("triads");
  const [open, setOpen] = useState(false);
  return (
    <section data-testid="triad-schedule-next" className="rounded-[16px] bg-[#062f3e] p-5 text-white">
      <div className="text-[9.5px] font-extrabold uppercase tracking-[.18em] text-[#3db4d0]">{t("schedule.noOpenTitle")}</div>
      <p className="mt-2 text-[11.5px] leading-relaxed text-white/65">{t("schedule.noOpenBody")}</p>
      {open ? (
        <div className="mt-4 rounded-xl bg-white p-4 text-foreground">
          <TriadAlternativeProposal entry={entry} mode="schedule" untilDate={untilDate} onDone={() => setOpen(false)} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-[18px] inline-block rounded-full bg-[#3db4d0] px-[18px] py-[11px] text-[11.5px] font-bold text-[#062f3e]"
        >
          {t("schedule.cta")}
        </button>
      )}
    </section>
  );
}

function PendingAssignmentCard({ unit }: { unit: number }) {
  const { t } = useTranslation("triads");
  return (
    <section data-testid="triad-no-group" className="rounded-[16px] bg-[#062f3e] p-5 text-white">
      <div className="text-[9.5px] font-extrabold uppercase tracking-[.18em] text-[#3db4d0]">{t("requirement.title", { n: unit })}</div>
      <div className="mt-3 font-serif text-[22px] font-light leading-snug">{t("requirement.pending")}</div>
      <p className="mt-2 text-[11.5px] leading-relaxed text-white/65">{t("requirement.pendingBody", { n: unit })}</p>
    </section>
  );
}

function TriadSessionRow({
  session,
  unitNumber,
  status,
  statusLoading,
  outstanding,
}: {
  session: DevelopmentSessionItem;
  unitNumber: number | null;
  status: { submitted: boolean; selfRating: number | null } | null;
  statusLoading: boolean;
  /** Post-session items still owed (learner_session_deliverables). */
  outstanding?: DeliverableKey[];
}) {
  const { t } = useTranslation("journey");
  const { t: tTriads } = useTranslation("triads");
  const { t: tDash } = useTranslation("dashboard");
  const path = sessionDetailPath(session);
  const completed = session.status === "completed";
  const cancelled = session.status === "cancelled";
  const tone = (kind: "done" | "due" | "later" | "none") =>
    kind === "done" ? "text-[#17663f]" : kind === "due" ? "text-[#a8541c]" : "text-[#9a9287]";
  const reflectionKind: "done" | "due" | "later" | "none" = status?.submitted ? "done" : cancelled ? "none" : completed ? "due" : "later";
  const reflectionText =
    reflectionKind === "done"
      ? tDash("learnerModules.triads.submitted")
      : reflectionKind === "due"
        ? tDash("learnerModules.triads.due")
        : reflectionKind === "later"
          ? tDash("learnerModules.triads.afterSession")
          : "—";
  const ratingText = status?.selfRating != null ? `${status.selfRating} / 5` : reflectionText;

  return (
    <div data-testid="session-row" data-source={session.sourceType} data-status={session.status} className="rounded-[13px] border border-[#efeae1] bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-[14px]">
        <div className="min-w-0">
          <div className="text-[8.5px] font-extrabold uppercase tracking-[.14em] text-[#2c8fa8]">
            {unitNumber != null ? tTriads("sessionLabel", { n: unitNumber }) : tDash("learnerModules.triads.sessionPractice")}
          </div>
          <div className="mt-[5px] text-[13px] font-semibold text-[#062f3e]">{session.title || t("developmentSessions.types.triad")}</div>
          {session.counterpartNames?.length ? (
            <div className="mt-[3px] text-[10.5px] text-[#7d7468]">{session.counterpartNames.join(", ")}</div>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {outstanding && outstanding.length > 0 && (
            <Link
              to={path ?? `/triads/${session.sourceId}`}
              data-testid="session-followup-outstanding"
              title={outstanding.map((key) => tDash(`learnerModules.shared.items.${key}`)).join(" · ")}
              className="rounded-full bg-[#fbeee5] px-2.5 py-1.5 text-[8.5px] font-extrabold uppercase tracking-[.08em] text-[#a8541c]"
            >
              {tDash("learnerModules.shared.followUpOutstanding", { count: outstanding.length })}
            </Link>
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
      </div>
      <div className="mt-[13px] grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
        <Fact label={tDash("learnerModules.triads.session")}>
          {path ? (
            <Link to={path} className="hover:underline">
              {session.startTime ? formatProfileDate(session.startTime) : "—"}
            </Link>
          ) : session.startTime ? (
            formatProfileDate(session.startTime)
          ) : (
            "—"
          )}
        </Fact>
        <Fact label={tDash("learnerModules.triads.selfRating")} className={statusLoading ? "text-[#9a9287]" : tone(status?.selfRating != null ? "done" : reflectionKind)}>
          {statusLoading ? "…" : ratingText}
        </Fact>
        <Fact label={tDash("learnerModules.triads.selfReflection")} className={statusLoading ? "text-[#9a9287]" : tone(reflectionKind)}>
          {statusLoading ? (
            "…"
          ) : reflectionKind === "due" ? (
            <Link to={`/triads/${session.sourceId}/reflect`} className="hover:underline">
              {reflectionText}
            </Link>
          ) : (
            reflectionText
          )}
        </Fact>
      </div>
    </div>
  );
}

function Fact({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className="flex justify-between gap-2.5 rounded-[9px] border border-[#efeae1] bg-[#fffdf9] px-3 py-[9px] text-[11px]">
      <span className="text-[#7d7468]">{label}</span>
      <strong className={className}>{children}</strong>
    </div>
  );
}

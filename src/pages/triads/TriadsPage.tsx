import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { useMyTriads, useTriadSessionEntry, type TriadRoundEntry } from "@/hooks/triads/useMyTriads";
import { useMyTriadReflectionStatuses } from "@/hooks/triads/useTriadReflection";
import { useModuleWorkspace } from "@/hooks/journey/useModuleWorkspace";
import type { DevelopmentSessionItem } from "@/hooks/journey/developmentSessionTypes";
import { formatProfileDate, formatProfileDateTime } from "@/lib/programmeProfile";
import { nextOpenSession, sessionStatusTone } from "@/lib/moduleSessions";
import { sessionDetailPath } from "@/lib/sessionPaths";
import { ModuleCard, ModuleEyebrow, ModulePageHeader } from "@/components/programme/module/ModulePage";
import { ProfileLoadError } from "@/components/programme/primitives";
import { TriadSessionCard } from "./components/TriadSessionCard";

/**
 * Triads (Coachee prototype → Triads). Three different facts, kept apart:
 *  1. Current round / availability — admin-configured open rounds the learner
 *     is grouped into (useMyTriads). "No round open" describes ONLY this.
 *  2. My Triad group — canonical membership (triad_groups via
 *     the canonical triad member source) with each member's role in the focus session.
 *  3. Rounds / history — every Triad session in the enrollment from
 *     learner_session_history (incl. groups with no configured round), with
 *     the learner's own self-rating / self-reflection status.
 * Triads progress (x / y) is quoted from the canonical progress row.
 */
export default function TriadsPage() {
  const { t } = useTranslation("triads");
  const { t: tDash } = useTranslation("dashboard");
  const ws = useModuleWorkspace("triads");
  const { rounds, loading: roundsLoading, error: roundsError, refetch } = useMyTriads();

  const openRounds = rounds.filter((r) => !r.session || r.session.status === "proposed" || r.session.status === "confirmed");
  const openRound = openRounds[0] ?? null;
  const history = [...ws.sessions].sort((a, b) => new Date(a.startTime ?? 0).getTime() - new Date(b.startTime ?? 0).getTime());
  const next = nextOpenSession(ws.sessions);
  const focusSessionId = openRound?.session?.id ?? next?.sourceId ?? history[history.length - 1]?.sourceId;
  const focus = useTriadSessionEntry(focusSessionId);
  const statuses = useMyTriadReflectionStatuses(history.map((s) => s.sourceId));

  return (
    <div className="flex flex-col gap-[18px]">
      <ModulePageHeader
        title={tDash("learnerModules.triads.title")}
        subtitle={tDash("learnerModules.triads.subtitle")}
        action={
          <span
            data-testid="triad-round-pill"
            className="rounded-full bg-[#e4f1f5] px-[13px] py-2 text-[9px] font-extrabold uppercase tracking-[.08em] text-[#226d80]"
          >
            {openRound ? tDash("learnerModules.triads.roundCurrent", { n: openRound.roundNumber ?? "—" }) : tDash("learnerModules.triads.noRoundPill")}
          </span>
        }
      />

      <div data-testid="triad-current-rounds" className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(290px,1fr))]">
        <TriadGroupCard entry={focus.entry ?? openRound} loading={focus.loading || roundsLoading} />
        {roundsLoading ? (
          <div className="flex items-center justify-center rounded-[16px] bg-[#062f3e] p-5">
            <Loader2 className="h-5 w-5 animate-spin text-white" />
          </div>
        ) : roundsError ? (
          <ModuleCard>
            <div role="alert" className="flex flex-col items-center gap-3 text-center text-sm">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <p className="text-muted-foreground">{t("loadError")}</p>
              <Button size="sm" variant="outline" onClick={() => refetch()}>
                {t("retry")}
              </Button>
            </div>
          </ModuleCard>
        ) : openRound?.session ? (
          // Accept / propose another time / mark completed live on the existing card.
          <TriadSessionCard entry={openRound} />
        ) : (
          <NextTriadCard next={next} />
        )}
      </div>

      <ModuleCard testId="triad-history">
        <h2 className="font-serif text-[19px] font-normal tracking-[-.02em] text-[#062f3e]">{tDash("learnerModules.triads.roundsTitle")}</h2>
        <p className="mb-4 mt-[5px] text-[11.5px] text-[#7d7468]">
          {tDash("learnerModules.triads.roundsSubtitle")}
          {ws.required != null && (
            <>
              {" · "}
              <span data-testid="triad-progress">{t("history.progress", { completed: ws.completed, required: ws.required })}</span>
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
              <TriadRoundRow key={session.id} session={session} status={statuses.statuses.get(session.sourceId) ?? null} statusLoading={statuses.loading} />
            ))}
          </div>
        )}
      </ModuleCard>
    </div>
  );
}

function TriadGroupCard({ entry, loading }: { entry: TriadRoundEntry | null; loading: boolean }) {
  const { t } = useTranslation("triads");
  const { user } = useAuth();
  const { t: tDash } = useTranslation("dashboard");
  return (
    <ModuleCard testId="triad-group">
      <ModuleEyebrow>{tDash("learnerModules.triads.myGroup")}</ModuleEyebrow>
      {loading ? (
        <div className="mt-4 h-20 animate-pulse rounded-[12px] bg-[#eee8de]" />
      ) : !entry ? (
        <p className="mt-3 text-[12px] text-[#7d7468]">{tDash("learnerModules.triads.noGroup")}</p>
      ) : (
        <>
          <h2 className="mt-[7px] font-serif text-[19px] font-normal tracking-[-.02em] text-[#062f3e]">
            {entry.round?.title || (entry.roundNumber != null ? t("roundLabel", { n: entry.roundNumber }) : tDash("learnerModules.triads.myGroup"))}
          </h2>
          {!entry.group.member_3_id && <p className="mt-1.5 text-[11.5px] text-[#7d7468]">{t("dyadNote")}</p>}
          <div className="mt-4 grid gap-[9px] [grid-template-columns:repeat(auto-fit,minmax(130px,1fr))]">
            {entry.members.map((member) => {
              const role = entry.roleByMemberId?.[member.id];
              const isSelf = member.id === user?.id;
              return (
                <div
                  key={member.id}
                  data-testid="triad-member"
                  className={cn("rounded-[12px] border border-[#efeae1] p-[13px]", isSelf ? "bg-[#f2fafc]" : "bg-white")}
                >
                  <div className="text-[9px] font-extrabold uppercase tracking-[.12em] text-[#9a9287]">
                    {isSelf ? t("you") : role ? tDash(`learnerModules.triads.roles.${role}`) : tDash("learnerModules.triads.member")}
                  </div>
                  <strong className="mt-1.5 block text-[12.5px] text-[#062f3e]">{member.full_name}</strong>
                  {isSelf && role && (
                    <div className="mt-[3px] text-[10px] text-[#7d7468]">
                      {tDash("learnerModules.triads.yourRole", { role: tDash(`learnerModules.triads.roles.${role}`) })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </ModuleCard>
  );
}

function NextTriadCard({ next }: { next: DevelopmentSessionItem | null }) {
  const { t } = useTranslation("triads");
  const { t: tDash } = useTranslation("dashboard");
  const path = next ? sessionDetailPath(next) : null;
  return (
    <section data-testid="triad-next" className="rounded-[16px] bg-[#062f3e] p-5 text-white">
      <div className="text-[9.5px] font-extrabold uppercase tracking-[.18em] text-[#3db4d0]">{tDash("learnerModules.triads.nextTitle")}</div>
      {next ? (
        <>
          <div className="mt-3 font-serif text-[32px] font-light leading-none">{next.startTime ? formatProfileDate(next.startTime) : "—"}</div>
          <div className="mt-2 text-[11.5px] text-white/65">
            {[
              next.startTime ? formatProfileDateTime(next.startTime) : null,
              next.roundLabel,
              next.trainingWeekLabel,
              next.participantRole ? tDash("learnerModules.triads.yourRole", { role: tDash(`learnerModules.triads.roles.${next.participantRole}`) }) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
          {path && (
            <Link to={path} className="mt-[18px] inline-block rounded-full bg-[#3db4d0] px-[18px] py-[11px] text-[11.5px] font-bold text-[#062f3e]">
              {tDash("learnerModules.triads.openSession")}
            </Link>
          )}
          {/* Availability is a separate fact: this session exists, but no admin round is open. */}
          <p className="mt-4 border-t border-white/10 pt-3 text-[10.5px] text-white/55">{t("currentRounds.noneTitle")}</p>
        </>
      ) : (
        <>
          <div className="mt-3 font-serif text-[22px] font-light leading-snug">{t("currentRounds.noneTitle")}</div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-white/65">{t("currentRounds.noneBody")}</p>
        </>
      )}
    </section>
  );
}

function TriadRoundRow({
  session,
  status,
  statusLoading,
}: {
  session: DevelopmentSessionItem;
  status: { submittedAt: string | null; selfRating: number | null } | null;
  statusLoading: boolean;
}) {
  const { t } = useTranslation("journey");
  const { t: tDash } = useTranslation("dashboard");
  const path = sessionDetailPath(session);
  const completed = session.status === "completed";
  const cancelled = session.status === "cancelled";
  const tone = (kind: "done" | "due" | "later" | "none") =>
    kind === "done" ? "text-[#17663f]" : kind === "due" ? "text-[#a8541c]" : "text-[#9a9287]";
  const reflectionKind: "done" | "due" | "later" | "none" = status ? "done" : cancelled ? "none" : completed ? "due" : "later";
  const ratingText =
    status?.selfRating != null
      ? `${status.selfRating} / 5`
      : reflectionKind === "done"
        ? tDash("learnerModules.triads.submitted")
        : reflectionKind === "due"
          ? tDash("learnerModules.triads.due")
          : reflectionKind === "later"
            ? tDash("learnerModules.triads.afterSession")
            : "—";
  const reflectionText =
    reflectionKind === "done"
      ? tDash("learnerModules.triads.submitted")
      : reflectionKind === "due"
        ? tDash("learnerModules.triads.due")
        : reflectionKind === "later"
          ? tDash("learnerModules.triads.afterSession")
          : "—";

  return (
    <div data-testid="session-row" data-source={session.sourceType} data-status={session.status} className="rounded-[13px] border border-[#efeae1] bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-[14px]">
        <div className="min-w-0">
          <div className="text-[8.5px] font-extrabold uppercase tracking-[.14em] text-[#2c8fa8]">
            {[session.roundLabel ?? tDash("learnerModules.triads.earlierPractice"), session.trainingWeekLabel].filter(Boolean).join(" · ")}
          </div>
          <div className="mt-[5px] text-[13px] font-semibold text-[#062f3e]">{session.title || t("developmentSessions.types.triad")}</div>
          <div className="mt-[3px] text-[10.5px] text-[#7d7468]">
            {session.participantRole && tDash("learnerModules.triads.yourRole", { role: tDash(`learnerModules.triads.roles.${session.participantRole}`) })}
            {session.counterpartNames?.length ? ` · ${session.counterpartNames.join(", ")}` : ""}
          </div>
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

import { AlertTriangle, ArrowLeft, CheckCircle2, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import type { SponsorRosterRow } from "@/hooks/sponsor/useSponsorDashboardData";
import type {
  SponsorLeaderExperience,
  SponsorLeaderJourneyPoint,
  SponsorLeaderProfileData,
} from "@/hooks/sponsor/useSponsorLeaderData";
import { EMPTY_PROGRAMME_EXPERIENCE, formatProfileDate } from "@/lib/programmeProfile";
import { PROFILE_COLORS } from "@/components/programme/profileTheme";
import { ProgrammeProfileHeader } from "@/components/programme/ProgrammeProfileHeader";
import { ProgrammeMetricCards } from "@/components/programme/ProgrammeMetricCards";
import { ProgrammeJourney } from "@/components/programme/ProgrammeJourney";
import { useCanonicalScheduleState } from "@/hooks/useCanonicalScheduleState";
import { ProgrammeProgressParticipation } from "@/components/programme/ProgrammeProgressParticipation";
import { ProgrammeModuleProgress } from "@/components/programme/ProgrammeModuleProgress";
import { ProgrammeExperienceRating, ProgrammeGoalSummary } from "@/components/programme/ProgrammeEngagementCards";
import { STATUS_LABEL_KEY, STATUS_TONE, effectiveSponsorStatus, storedSponsorStatus } from "./sponsorUtils";
import { SponsorFlagDialog } from "./SponsorFlagDialog";

const { CARD, LINE, NAVY } = PROFILE_COLORS;

const WITHHELD_KEYS = ["sessionNotes", "chatMessages", "reflections", "goalWording", "coachIdentity"] as const;

interface Props {
  leader: SponsorRosterRow | null;
  onClose: () => void;
}

export function SponsorLeaderDrawer({ leader, onClose }: Props) {
  const { t } = useTranslation("sponsor");
  if (!leader) return null;

  return (
    <Sheet open={!!leader} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto border-l border-[#e6dfd4] bg-[#f6f3ee] p-0">
        <SheetTitle className="sr-only">{leader.learner_display_name} — {t("leaderDrawer.srLabelSuffix")}</SheetTitle>
        <SheetDescription className="sr-only">{t("leaderDrawer.description")}</SheetDescription>
        <SponsorLeaderProfile leader={leader} onBack={onClose} />
      </SheetContent>
    </Sheet>
  );
}

export function SponsorLeaderProfile({
  leader,
  onBack,
  journey = [],
  experience = EMPTY_PROGRAMME_EXPERIENCE,
}: {
  leader: SponsorLeaderProfileData;
  onBack: () => void;
  journey?: SponsorLeaderJourneyPoint[];
  experience?: SponsorLeaderExperience;
}) {
  const { t } = useTranslation("sponsor");
  const schedule = useCanonicalScheduleState("sponsor", leader.enrollment_id);
  const attention = attentionItems(leader, t);
  const effectiveStatus = effectiveSponsorStatus(leader);
  const storedStatus = storedSponsorStatus(leader);
  const effectiveStatusKey = STATUS_LABEL_KEY[effectiveStatus];

  return (
    <div className="min-h-full overflow-hidden bg-[#f6f3ee]" style={{ color: NAVY }}>
      <div className="mx-auto max-w-[1180px] px-5 py-7 sm:px-8 lg:px-10 lg:py-9">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#6a6560] transition-colors hover:text-[#062f3e]">
          <ArrowLeft className="h-3.5 w-3.5" /> {t("leaderDrawer.backToRoster")}
        </button>

        <ProgrammeProfileHeader
          name={leader.learner_display_name}
          eyebrow={t("leaderDrawer.reference.eyebrow")}
          subtitle={`${leader.programme_label} · ${leader.cohort_label || "—"}`}
          metas={[
            { label: t("leaderDrawer.reference.sponsorStatus"), value: t(`status.${effectiveStatusKey}`) },
            ...(storedStatus ? [{ label: t("leaderDrawer.reference.recordedStatus"), value: t(`status.${STATUS_LABEL_KEY[storedStatus]}`) }] : []),
            { label: t("leaderDrawer.reference.dates"), value: `${formatProfileDate(leader.enrollment_start_date)} – ${formatProfileDate(leader.enrollment_end_date)}` },
          ]}
          status={{ tone: STATUS_TONE[effectiveStatus], label: t(`status.${effectiveStatusKey}`) }}
        />

        <h2 className="sr-only">{t("leaderDrawer.overview")}</h2>
        <ProgrammeMetricCards facts={leader} engagement={leader} viewer="sponsor" />

        <ProgrammeJourney journey={journey} start={leader.programme_start_date} end={leader.programme_end_date} viewer="sponsor" scheduleMismatches={schedule.mismatches} />

        <div className="mt-4 grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(340px,1fr))]">
          <ProgrammeProgressParticipation facts={leader} journey={journey} coachingUtilisation={experience.coachingUtilisation} viewer="sponsor" />
          <ProgrammeModuleProgress facts={leader} learningBreakdown={experience.learningBreakdown} viewer="sponsor" />
        </div>

        <div className="mt-4 grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(340px,1fr))]">
          <ProgrammeGoalSummary engagement={leader} viewer="sponsor" />
          <ProgrammeExperienceRating engagement={leader} viewer="sponsor" />
        </div>

        <AttentionSection leader={leader} items={attention} t={t} />

        <section className="mt-4 flex items-start gap-4 rounded-[14px] border border-dashed border-[#ddd6cc] px-[22px] py-[18px]">
          <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-lg bg-[#e4f3f7] text-xs font-bold text-[#2c8fa8]">◔</span>
          <div>
            <div className="text-xs font-semibold">{t("leaderDrawer.reference.confidentialityTitle")}</div>
            <p className="mt-1.5 max-w-[84ch] text-[11.5px] leading-[1.6] text-[#6a6560]">{t("leaderDrawer.reference.confidentialityBody")}</p>
          </div>
        </section>

        <section className="mt-4 rounded-[14px] border border-[#3db4d0]/25 bg-[#e4f5fa]/55 p-[22px]">
          <div className="mb-3 flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[#2c8fa8]" /><p className="text-[11px] font-bold uppercase tracking-[.16em]">{t("leaderDrawer.canSeeTitle")}</p></div>
          <p className="mb-3 text-[11px] leading-relaxed text-[#6a6560]">{t("leaderDrawer.withheldIntro")}</p>
          <ul className="grid gap-2 sm:grid-cols-2">{WITHHELD_KEYS.map((key) => <li key={key} className="flex items-start gap-2 text-[10px] text-[#6a6560]"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#d6cfc4]" />{t(`leaderDrawer.withheld.${key}`)}</li>)}</ul>
          <p className="mt-4 text-[10px] italic text-[#6a6560]">{t("leaderDrawer.sameViewNote")}</p>
        </section>
      </div>
    </div>
  );
}

function AttentionSection({ leader, items, t }: { leader: SponsorLeaderProfileData; items: string[]; t: (key: string, options?: Record<string, unknown>) => string }) {
  return <section className="mt-4 rounded-[14px] border p-[22px]" style={{ background: CARD, borderColor: LINE }}><span className="sr-only">{t("leaderDrawer.attention.title")}</span><div className="flex flex-wrap items-baseline justify-between gap-3"><h2 className="font-serif text-[17px] font-normal">{t("leaderDrawer.reference.attentionTitle")}</h2><span className="rounded-full bg-[#fbeade] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.1em] text-[#a8541c]">{t("leaderDrawer.reference.attentionCount", { count: items.length })}</span></div><div className="mt-4 flex flex-col gap-2.5">{items.length ? items.map((item) => <div key={item} className="flex items-center gap-3.5 rounded-[10px] border border-[#f0d5cc] bg-[#fdf6f2] px-4 py-3.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[#a8341c]" /><div className="min-w-0 text-[13px] font-semibold">{item}</div><SponsorFlagDialog subject={leader.learner_display_name} className="ml-auto shrink-0 rounded-full border border-[#cfc7bb] bg-transparent px-[15px] py-2 text-[11.5px] font-semibold text-[#062f3e]" /></div>) : <p className="flex items-center gap-2 text-[11px] text-[#6a6560]"><CheckCircle2 className="h-3.5 w-3.5 text-[#17663f]" />{t("leaderDrawer.attention.none")}</p>}</div></section>;
}

function attentionItems(leader: SponsorLeaderProfileData, t: (key: string, options?: Record<string, unknown>) => string) {
  return [
    effectiveSponsorStatus(leader) === "at_risk" ? t("leaderDrawer.attention.atRisk") : null,
    leader.overdue_units > 0 ? t("leaderDrawer.attention.overdue", { count: leader.overdue_units }) : null,
    leader.open_action_count > 0 ? t("leaderDrawer.attention.actions", { count: leader.open_action_count }) : null,
    leader.due_adherence_pct != null && leader.due_adherence_pct < 70 && leader.due_units > 0 ? t("leaderDrawer.attention.adherence") : null,
  ].filter((item): item is string => Boolean(item));
}

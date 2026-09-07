import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { HeroPanel } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Link, Navigate } from "react-router-dom";
import { Calendar, Sparkles, Loader2 } from "lucide-react";
import { useProgrammeModules, ProgrammeModuleType } from "@/hooks/useProgrammeModules";
import { ProgrammeProgressCard } from "@/components/ProgrammeProgressCard";
import { DashboardStatsBar } from "./dashboard/DashboardStatsBar";
import { RoleIndicator } from "./dashboard/cards/shared";
import { CoachingGiveCard } from "./dashboard/cards/CoachingGiveCard";
import { CoachingReceiveCard } from "./dashboard/cards/CoachingReceiveCard";
import { MentoringGiveCard } from "./dashboard/cards/MentoringGiveCard";
import { MentoringReceiveCard } from "./dashboard/cards/MentoringReceiveCard";
import { PeerCoachingCard } from "./dashboard/cards/PeerCoachingCard";
import { TriadsCard } from "./dashboard/cards/TriadsCard";
import { TrainingCard } from "./dashboard/cards/TrainingCard";

// Module → role-indicator badge, in a stable display order. Keeping this as a
// static lookup (rather than deriving labels from the raw module enum) keeps
// the copy translatable and lets tone stay deliberate per module.
const INDICATOR_ORDER: {
  module: ProgrammeModuleType;
  direction?: "give" | "receive";
  labelKey: string;
  tone: "primary" | "success" | "accent" | "warning";
}[] = [
  { module: "coaching", direction: "give", labelKey: "roleIndicators.coachingGive", tone: "primary" },
  { module: "coaching", direction: "receive", labelKey: "roleIndicators.coachingReceive", tone: "accent" },
  { module: "mentoring", direction: "give", labelKey: "roleIndicators.mentoringGive", tone: "primary" },
  { module: "mentoring", direction: "receive", labelKey: "roleIndicators.mentoringReceive", tone: "accent" },
  { module: "peer_coaching", labelKey: "roleIndicators.peerCoaching", tone: "success" },
  { module: "triads", labelKey: "roleIndicators.triads", tone: "success" },
  { module: "training", labelKey: "roleIndicators.training", tone: "warning" },
];

function DashboardRoleIndicators() {
  const { t } = useTranslation("dashboard");
  const { hasModule, hasDirection, loading } = useProgrammeModules();
  if (loading) return null;

  const active = INDICATOR_ORDER.filter((entry) =>
    entry.direction ? hasDirection(entry.module, entry.direction) : hasModule(entry.module)
  );
  if (active.length === 0) return null;

  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {active.map((entry) => (
        <RoleIndicator
          key={`${entry.module}-${entry.direction ?? "any"}`}
          tone={entry.tone}
          label={t(entry.labelKey)}
          desc={t(`${entry.labelKey}Desc`)}
        />
      ))}
    </section>
  );
}

export default function Dashboard() {
  const { t } = useTranslation("dashboard");
  const { user, profile, role } = useAuth();
  const firstName = (profile?.full_name || "there").split(" ")[0];

  // Admins and sponsors each have one dedicated console — /dashboard is
  // just an entry point for them, not a second copy of their home view.
  if (role === "admin") {
    return <Navigate to="/admin" replace />;
  }
  if (role === "sponsor") {
    return <Navigate to="/sponsor" replace />;
  }

  // Authenticated but no role assigned yet — shouldn't linger here normally
  if (!role) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <HeroPanel>
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[9.5px] font-bold uppercase tracking-[0.2em] backdrop-blur-sm">
            <Sparkles className="h-3 w-3" /> {t("hero.workspaceBadge")}
          </div>
          <h1 className="font-display mt-5 text-[clamp(2.2rem,4.6vw,3.4rem)] leading-[1.05]">
            {t("hero.welcomeBack")} <em className="italic text-primary-glow">{firstName}</em>.
          </h1>
          <p className="mt-3 text-base text-white/70">{t(`greetingByRole.${role}`)}</p>
          <div className="flex flex-wrap gap-3 pt-6">
            <Button
              asChild
              size="lg"
              variant="outline"
              className="rounded-xl border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            >
              <Link to="/sessions">
                <Calendar className="mr-1 h-4 w-4" /> {t("hero.viewSessionsButton")}
              </Link>
            </Button>
          </div>
        </div>
      </HeroPanel>

      <DashboardRoleIndicators />
      <DashboardStatsBar />
      <ProgrammeProgressCard />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CoachingGiveCard />
        <CoachingReceiveCard />
        <MentoringGiveCard />
        <MentoringReceiveCard />
        <PeerCoachingCard />
        <TriadsCard />
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <TrainingCard />
      </section>
    </div>
  );
}

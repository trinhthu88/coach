import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Link, Navigate } from "react-router-dom";
import { Calendar, Sparkles, Loader2, ArrowUpRight } from "lucide-react";
import { useProgrammeModules, ProgrammeModuleType } from "@/hooks/useProgrammeModules";
import { ProgrammeProgressCard } from "@/components/ProgrammeProgressCard";
import { DashboardStatsBar } from "./dashboard/DashboardStatsBar";
import { RoleIndicator } from "./dashboard/cards/shared";
import { CoachingGiveCard } from "./dashboard/cards/CoachingGiveCard";
import { CoachingReceiveCard } from "./dashboard/cards/CoachingReceiveCard";
import { MyCoachCard } from "./dashboard/cards/MyCoachCard";
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
    <div className="animate-rise space-y-5">
      <header>
        <p className="eyebrow">{t("hero.workspaceBadge")}</p>
        <h1 className="font-display mt-3 text-[clamp(2.1rem,4vw,2.9rem)] leading-[1.04]">
          {t("hero.welcomeBack")} <em>{firstName}</em>.
        </h1>
      </header>

      <section className="relative overflow-hidden rounded-[24px] gradient-hero p-7 text-secondary-foreground shadow-lg sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-28 h-80 w-80 rounded-full bg-[radial-gradient(circle,hsl(var(--primary)/.28),transparent_70%)]" />
        <div className="relative flex flex-wrap items-center gap-7">
          <div className="min-w-[240px] flex-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-[9px] font-bold uppercase tracking-[.2em] text-primary-glow">
              <Sparkles className="h-3 w-3" /> {t("hero.workspaceBadge")}
            </div>
            <h2 className="font-display mt-4 max-w-[24ch] text-[clamp(1.7rem,3vw,2.25rem)] leading-[1.12]">{t(`greetingByRole.${role}`)}</h2>
            <p className="mt-3 text-[12.5px] text-white/65">{t("hero.viewSessionsButton")}</p>
          </div>
          <Button asChild className="rounded-[13px] bg-primary px-5 text-secondary hover:bg-primary-glow">
            <Link to="/sessions"><Calendar className="mr-2 h-4 w-4" /> {t("hero.viewSessionsButton")} <ArrowUpRight className="ml-1 h-3.5 w-3.5" /></Link>
          </Button>
        </div>
      </section>

      <DashboardRoleIndicators />
      <DashboardStatsBar />
      <ProgrammeProgressCard />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CoachingGiveCard />
        <CoachingReceiveCard />
        <MyCoachCard />
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

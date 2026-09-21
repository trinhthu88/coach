import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { Navigate } from "react-router-dom";
import { ProgrammeProgressCard } from "@/components/ProgrammeProgressCard";
import { CoachingGiveCard } from "./dashboard/cards/CoachingGiveCard";
import { CoachingReceiveCard } from "./dashboard/cards/CoachingReceiveCard";
import { MyCoachCard } from "./dashboard/cards/MyCoachCard";
import { MentoringGiveCard } from "./dashboard/cards/MentoringGiveCard";
import { MentoringReceiveCard } from "./dashboard/cards/MentoringReceiveCard";
import { PeerCoachingCard } from "./dashboard/cards/PeerCoachingCard";
import { TriadsCard } from "./dashboard/cards/TriadsCard";
import { MyGoalCard } from "./dashboard/cards/MyGoalCard";
import { MyFeedbackCard } from "./dashboard/cards/MyFeedbackCard";
import { RecentDevelopmentCard } from "./dashboard/cards/RecentDevelopmentCard";
import { CoacheeDashboard } from "./dashboard/coachee/CoacheeDashboard";

export default function Dashboard() {
  const { t } = useTranslation("dashboard");
  const { profile, role } = useAuth();
  const firstName = (profile?.full_name || "there").split(" ")[0];

  // Admins and sponsors each have one dedicated console — /dashboard is
  // just an entry point for them, not a second copy of their home view.
  if (role === "admin") {
    return <Navigate to="/admin" replace />;
  }
  if (role === "sponsor") {
    return <Navigate to="/sponsor" replace />;
  }

  // ProtectedRoute already shows the "no role assigned" screen; never spin here.
  if (!role) return null;

  // The Coachee Dashboard follows the approved Coachee UX/UI prototype
  // (Programme Hero, Next up, Programme progress, Programme Journey preview,
  // Module progress, Goals & actions, Feedback & development, Upcoming
  // sessions, Recent development) — a structurally different layout from the
  // coach's own dashboard below, so it's a dedicated component rather than a
  // role-conditional sprinkled through this one. The coach dashboard is
  // unchanged.
  if (role === "coachee") {
    return <CoacheeDashboard />;
  }

  const now = new Date();
  const hour = now.getHours();
  const greetingKey = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const dateLabel = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" })
    .format(now)
    .toUpperCase();

  return (
    <div className="animate-rise space-y-5">
      <header>
        <p className="text-[10px] font-bold uppercase tracking-[.28em] text-primary">{dateLabel}</p>
        <h1 className="font-display mt-3 text-[clamp(1.9rem,3.4vw,2.9rem)] leading-[1.04] tracking-[-0.03em]">
          {t(`coachee.greeting.${greetingKey}`)}, <em>{firstName}</em>.
        </h1>
      </header>

      {/* flex, not grid: either hero can independently render nothing (module
          not enabled that direction), and a lone survivor should stretch to
          full width rather than being stuck in a half-empty grid column. */}
      <div className="flex flex-col gap-4 lg:flex-row [&>*]:min-w-0 [&>*]:flex-1">
        <CoachingReceiveCard />
        <CoachingGiveCard />
      </div>

      <ProgrammeProgressCard />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MyGoalCard />
        <MyCoachCard />
        <MentoringGiveCard />
        <MentoringReceiveCard />
        <PeerCoachingCard />
        <TriadsCard />
        <MyFeedbackCard />
        <RecentDevelopmentCard />
      </section>
    </div>
  );
}

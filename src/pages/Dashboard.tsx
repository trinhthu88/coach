import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { ProgrammeProgressCard } from "@/components/ProgrammeProgressCard";
import { CoachingGiveCard } from "./dashboard/cards/CoachingGiveCard";
import { CoachingReceiveCard } from "./dashboard/cards/CoachingReceiveCard";
import { MyCoachCard } from "./dashboard/cards/MyCoachCard";
import { MentoringGiveCard } from "./dashboard/cards/MentoringGiveCard";
import { MentoringReceiveCard } from "./dashboard/cards/MentoringReceiveCard";
import { PeerCoachingCard } from "./dashboard/cards/PeerCoachingCard";
import { TriadsCard } from "./dashboard/cards/TriadsCard";

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

  // Authenticated but no role assigned yet — shouldn't linger here normally
  if (!role) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
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
        <MyCoachCard />
        <MentoringGiveCard />
        <MentoringReceiveCard />
        <PeerCoachingCard />
        <TriadsCard />
      </section>
    </div>
  );
}

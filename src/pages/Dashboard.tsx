import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { HeroPanel } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Link, Navigate } from "react-router-dom";
import { Calendar, Sparkles, Loader2 } from "lucide-react";
import { CoacheeDashboardView } from "./dashboard/CoacheeDashboardView";
import { CoachDashboardView } from "./dashboard/CoachDashboardView";
import { AdminDashboardView } from "./dashboard/AdminDashboardView";

export default function Dashboard() {
  const { t } = useTranslation("dashboard");
  const { user, profile, role } = useAuth();
  const firstName = (profile?.full_name || "there").split(" ")[0];

  const GREETING_BY_ROLE: Record<string, string> = {
    coachee: t("greetingByRole.coachee"),
    coach: t("greetingByRole.coach"),
    admin: t("greetingByRole.admin"),
  };

  if (role === "admin" || role === "coach") {
    return (
      <div className="space-y-8">
        <HeroPanel>
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[9.5px] font-bold uppercase tracking-[0.2em] backdrop-blur-sm">
              <Sparkles className="h-3 w-3" /> {role === "admin" ? t("hero.adminWorkspaceBadge") : t("hero.coachWorkspaceBadge")}
            </div>
            <h1 className="font-display mt-5 text-[clamp(2.2rem,4.6vw,3.4rem)] leading-[1.05]">
              {t("hero.welcomeBack")}{" "}
              <em className="italic text-primary-glow">{firstName}</em>.
            </h1>
            <p className="mt-3 text-base text-white/70">{GREETING_BY_ROLE[role]}</p>
            <div className="flex flex-wrap gap-3 pt-6">
              <Button
                asChild
                size="lg"
                variant="outline"
                className="rounded-xl border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              >
                <Link to={role === "admin" ? "/admin" : "/sessions"}>
                  <Calendar className="mr-1 h-4 w-4" /> {role === "admin" ? t("hero.adminDashboardButton") : t("hero.viewSessionsButton")}
                </Link>
              </Button>
            </div>
          </div>
        </HeroPanel>
        {role === "coach" ? <CoachDashboardView userId={user!.id} /> : <AdminDashboardView />}
      </div>
    );
  }

  // Sponsors have a dedicated dashboard — redirect after hooks are called
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

  return <CoacheeDashboardView />;
}

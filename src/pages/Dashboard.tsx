import { useAuth } from "@/context/AuthContext";
import { HeroPanel } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Calendar, Sparkles, Loader2 } from "lucide-react";
import { CoacheeDashboardView } from "./dashboard/CoacheeDashboardView";
import { CoachDashboardView } from "./dashboard/CoachDashboardView";
import { AdminDashboardView } from "./dashboard/AdminDashboardView";

const GREETING_BY_ROLE: Record<string, string> = {
  coachee: "Find your next coach and keep momentum going.",
  coach: "Review session requests and inspire your coachees today.",
  admin: "Manage approvals, coaches, and platform health.",
};

export default function Dashboard() {
  const { user, profile, role } = useAuth();
  const firstName = (profile?.full_name || "there").split(" ")[0];

  if (role === "admin" || role === "coach") {
    return (
      <div className="space-y-8">
        <HeroPanel>
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[9.5px] font-bold uppercase tracking-[0.2em] backdrop-blur-sm">
              <Sparkles className="h-3 w-3" /> {role} workspace
            </div>
            <h1 className="font-display mt-5 text-[clamp(2.2rem,4.6vw,3.4rem)] leading-[1.05]">
              Welcome back,{" "}
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
                  <Calendar className="mr-1 h-4 w-4" /> {role === "admin" ? "Admin dashboard" : "View sessions"}
                </Link>
              </Button>
            </div>
          </div>
        </HeroPanel>
        {role === "coach" ? <CoachDashboardView userId={user!.id} /> : <AdminDashboardView />}
      </div>
    );
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

import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Calendar, Search, Sparkles, TrendingUp, Users, ArrowUpRight } from "lucide-react";

export default function Dashboard() {
  const { profile, role } = useAuth();
  const firstName = (profile?.full_name || "there").split(" ")[0];

  const greetingByRole: Record<string, string> = {
    coachee: "Find your next coach and keep momentum going.",
    coach: "Review session requests and inspire your coachees today.",
    admin: "Manage approvals, coaches, and platform health.",
  };

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-hero p-8 text-primary-foreground shadow-lg sm:p-12">
        <div className="absolute right-0 top-0 h-64 w-64 translate-x-1/4 -translate-y-1/4 rounded-full bg-primary-glow/30 blur-3xl" />
        <div className="relative space-y-4 max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest backdrop-blur-sm">
            <Sparkles className="h-3 w-3" /> {role} workspace
          </div>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Welcome back, {firstName}.
          </h1>
          <p className="text-lg text-white/75">
            {greetingByRole[role || "coachee"]}
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            {role === "coachee" && (
              <Button asChild size="lg" variant="secondary" className="font-semibold">
                <Link to="/coaches">
                  <Search className="mr-1 h-4 w-4" /> Browse coaches
                </Link>
              </Button>
            )}
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-white/20 bg-white/10 text-white hover:bg-white/20"
            >
              <Link to="/sessions">
                <Calendar className="mr-1 h-4 w-4" /> View sessions
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Active sessions" value="—" hint="Coming online" icon={Calendar} />
        <StatCard label="Hours coached" value="—" hint="Lifetime" icon={TrendingUp} />
        <StatCard label="Network" value="—" hint="Connections" icon={Users} />
      </section>

      {/* Quick links */}
      <section className="grid gap-4 lg:grid-cols-2">
        <QuickLink
          to="/coaches"
          title="Discover top coaches"
          subtitle="Browse a curated list of vetted leadership and executive coaches."
        />
        <QuickLink
          to="/sessions"
          title="Manage your sessions"
          subtitle="Track upcoming bookings, notes, and action items in one place."
        />
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ElementType;
}) {
  return (
    <Card className="p-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            {label}
          </p>
          <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}

function QuickLink({ to, title, subtitle }: { to: string; title: string; subtitle: string }) {
  return (
    <Link to={to} className="group">
      <Card className="flex items-center justify-between p-6 transition-all hover:border-primary/40 hover:shadow-md">
        <div>
          <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <ArrowUpRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:-translate-y-1 group-hover:translate-x-1 group-hover:text-primary" />
      </Card>
    </Link>
  );
}

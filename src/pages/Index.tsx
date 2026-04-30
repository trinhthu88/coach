import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { ArrowRight, ShieldCheck, Sparkles, Star } from "lucide-react";
import clarivaLogo from "@/assets/clariva-logo.png";

export default function Index() {
  const { user, isLoading } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
        <img src={clarivaLogo} alt="Clariva" className="h-9 w-auto object-contain" />
        {user ? (
          <Button asChild>
            <Link to="/dashboard">{isLoading ? "…" : "Open dashboard"}</Link>
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link to="/auth">Sign in</Link>
            </Button>
            <Button asChild>
              <Link to="/request-access">Request access</Link>
            </Button>
          </div>
        )}
      </header>

      <main className="relative mx-auto max-w-7xl px-6 pt-12 pb-32 sm:pt-20">
        <section className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">
            <Sparkles className="h-3 w-3" /> Premium coaching, redefined
          </div>
          <h1 className="mt-6 font-display text-5xl font-light leading-[1.05] text-secondary sm:text-7xl">
            Where leaders meet their{" "}
            <em className="text-primary">peak coach.</em>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
            A private, invite-driven platform connecting top executives with vetted
            coaches. Booking, sessions, and growth — all in one place.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" className="h-12 px-6 shadow-glow">
              <Link to={user ? "/dashboard" : "/request-access"}>
                {user ? "Open dashboard" : "Request access"} <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 px-6">
              <Link to="/auth">Sign in</Link>
            </Button>
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-xs font-bold uppercase tracking-widest text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-success" /> Verified coaches
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Star className="h-4 w-4 text-warning" /> 4.9 average rating
            </span>
          </div>
        </section>

        <section className="mt-24 grid gap-6 sm:grid-cols-3">
          {[
            { title: "Discover", body: "Browse vetted coaches by specialty, experience, and approach." },
            { title: "Book", body: "Schedule 30 / 45 / 60-minute sessions with one click." },
            { title: "Grow", body: "Take notes, track action items, and measure progress over time." },
          ].map((feat) => (
            <div key={feat.title} className="rounded-2xl border border-border bg-card p-6">
              <h3 className="text-base font-semibold">{feat.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{feat.body}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}

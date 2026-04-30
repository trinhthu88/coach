import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { ArrowRight, Loader2, ShieldCheck, Sparkles, GraduationCap, Compass } from "lucide-react";
import authHero from "@/assets/auth-hero.jpg";
import clarivaLogo from "@/assets/clariva-logo.png";
import { cn } from "@/lib/utils";

type SignupRole = "coachee" | "coach";

export default function Auth() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", fullName: "" });
  const [signupRole, setSignupRole] = useState<SignupRole>("coachee");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email: form.email,
          password: form.password,
        });
        if (error) throw error;
        toast({ title: "Welcome back", description: "You're signed in." });
        navigate("/dashboard", { replace: true });
      } else {
        const { error } = await supabase.auth.signUp({
          email: form.email,
          password: form.password,
          options: {
            emailRedirectTo: `${window.location.origin}/dashboard`,
            data: { full_name: form.fullName, role: signupRole },
          },
        });
        if (error) throw error;
        toast({
          title: "Account created",
          description:
            signupRole === "coach"
              ? "Your coach account is pending admin approval. You can fill in your profile now."
              : "Your account is pending admin approval. We'll let you know as soon as you're in.",
        });
        navigate("/dashboard", { replace: true });
      }
    } catch (err: any) {
      toast({
        title: "Authentication failed",
        description: err.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand pane */}
      <aside className="relative hidden overflow-hidden lg:flex">
        <img
          src={authHero}
          alt="Premium executive coaching"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-hero opacity-90" />
        <div className="relative z-10 flex w-full flex-col justify-between p-12 text-primary-foreground">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-white/95 px-3 py-2 shadow-glow backdrop-blur-sm">
              <img src={clarivaLogo} alt="Clariva" className="h-9 w-auto object-contain" />
            </div>
          </div>

          <div className="space-y-6 max-w-lg">
            <h1 className="font-display text-5xl font-light leading-[1.05] sm:text-6xl">
              Unlock your <em className="block text-primary-glow">peak potential.</em>
            </h1>
            <p className="text-lg text-white/70 leading-relaxed">
              The private marketplace for elite executive coaching. Vetted coaches.
              Real progress. Measurable outcomes.
            </p>
          </div>

          <div className="space-y-6 border-t border-white/10 pt-8">
            <div className="grid grid-cols-2 gap-8">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">Active coaches</p>
                <p className="mt-1 text-3xl font-semibold">500+</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">Leaders served</p>
                <p className="mt-1 text-3xl font-semibold">12k</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/60">
              <ShieldCheck className="h-4 w-4" />
              Secure verified environment
            </div>
          </div>
        </div>
      </aside>

      {/* Form pane */}
      <main className="flex items-center justify-center bg-gradient-subtle p-6 sm:p-12">
        <Card className="w-full max-w-md border-border/60 p-8 shadow-lg sm:p-10">
          <div className="mb-8 space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">
              <Sparkles className="h-3 w-3" />
              {mode === "signin" ? "Welcome back" : "Get started"}
            </div>
            <h2 className="font-display text-4xl font-light tracking-tight text-secondary">
              {mode === "signin" ? "Sign in to Clariva" : "Create your account"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {mode === "signin"
                ? "Enter your credentials to access your dashboard."
                : "Join a curated community of coaches and leaders."}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {mode === "signup" && (
              <>
                <div className="space-y-2">
                  <Label>I'm joining as</Label>
                  <div className="grid grid-cols-2 gap-3">
                    {([
                      { value: "coachee", label: "Coachee", desc: "Find and book coaches", icon: Compass },
                      { value: "coach", label: "Coach", desc: "Offer coaching sessions", icon: GraduationCap },
                    ] as const).map((opt) => {
                      const Icon = opt.icon;
                      const active = signupRole === opt.value;
                      return (
                        <button
                          type="button"
                          key={opt.value}
                          onClick={() => setSignupRole(opt.value)}
                          className={cn(
                            "flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all",
                            active
                              ? "border-primary bg-primary-soft shadow-sm"
                              : "border-border hover:border-primary/40 hover:bg-muted/40"
                          )}
                        >
                          <Icon className={cn("h-4 w-4", active ? "text-primary" : "text-muted-foreground")} />
                          <span className="text-sm font-semibold">{opt.label}</span>
                          <span className="text-[11px] text-muted-foreground">{opt.desc}</span>
                        </button>
                      );
                    })}
                  </div>
                  {signupRole === "coach" && (
                    <p className="text-[11px] text-muted-foreground">
                      Coach accounts require admin approval before appearing in the directory.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="fullName">Full name</Label>
                  <Input
                    id="fullName"
                    required
                    value={form.fullName}
                    onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                    placeholder="Marcus Aurelius"
                    className="h-11"
                  />
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="name@company.com"
                className="h-11"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={8}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="At least 8 characters"
                className="h-11"
              />
            </div>

            <Button type="submit" disabled={loading} className="h-11 w-full text-base font-semibold shadow-glow">
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  {mode === "signin" ? "Sign in" : "Create account"}
                  <ArrowRight className="ml-1 h-4 w-4" />
                </>
              )}
            </Button>
          </form>

          <div className="mt-8 border-t border-border/60 pt-6 text-center text-sm text-muted-foreground">
            {mode === "signin" ? "New to Clariva?" : "Already have an account?"}{" "}
            <button
              type="button"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              className="font-semibold text-primary hover:underline"
            >
              {mode === "signin" ? "Create an account" : "Sign in"}
            </button>
          </div>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            <Link to="/" className="hover:text-foreground">← Back to home</Link>
          </p>
        </Card>
      </main>
    </div>
  );
}

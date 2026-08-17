import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { ArrowRight, Loader2, ShieldCheck, Sparkles, GraduationCap, Compass } from "lucide-react";
import authHero from "@/assets/auth-hero.jpg";
import clarivaLogo from "@/assets/clariva-logo-dark.png";
import { cn } from "@/lib/utils";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

type SignupRole = "coachee" | "coach";

function isSameOriginRelativePath(path: string): boolean {
  try {
    const url = new URL(path, window.location.origin);
    return url.origin === window.location.origin && url.pathname !== "/auth";
  } catch {
    return false;
  }
}

export default function Auth() {
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const next = searchParams.get("next") ?? "/dashboard";
  const [mode] = useState<"signin" | "signup">("signin");
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
        toast({ title: t("toast.signInSuccess.title"), description: t("toast.signInSuccess.description") });
        navigate(isSameOriginRelativePath(next) ? next : "/dashboard", { replace: true });
      } else {
        const returnTo = isSameOriginRelativePath(next) ? `${window.location.origin}${next}` : `${window.location.origin}/dashboard`;
        const { error } = await supabase.auth.signUp({
          email: form.email,
          password: form.password,
          options: {
            emailRedirectTo: returnTo,
            data: { full_name: form.fullName, role: signupRole },
          },
        });
        if (error) throw error;
        toast({
          title: t("toast.signUpSuccess.title"),
          description:
            signupRole === "coach"
              ? t("toast.signUpSuccessCoach")
              : t("toast.signUpSuccessCoachee"),
        });
        navigate(isSameOriginRelativePath(next) ? next : "/dashboard", { replace: true });
      }
    } catch (err) {
      toast({
        title: t("toast.error.title"),
        description: err instanceof Error ? err.message : t("toast.error.genericDescription"),
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
          alt={t("heroPane.imageAlt")}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-hero opacity-90" />
        <div className="relative z-10 flex w-full flex-col justify-between p-12 text-primary-foreground">
          <div className="flex items-center gap-3">
            <img src={clarivaLogo} alt={t("heroPane.logoAlt")} className="h-11 w-auto object-contain" />
          </div>

          <div className="space-y-6 max-w-lg">
            <h1 className="font-display text-5xl font-light leading-[1.05] sm:text-6xl">
              {t("heroPane.titleLead")} <em className="block text-primary-glow">{t("heroPane.titleEmphasis")}</em>
            </h1>
            <p className="text-lg text-white/70 leading-relaxed">
              {t("heroPane.subtitle")}
            </p>
          </div>

          <div className="space-y-6 border-t border-white/10 pt-8">
            <div className="grid grid-cols-2 gap-8">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">{t("heroPane.stats.activeCoachesLabel")}</p>
                <p className="mt-1 text-3xl font-semibold">{t("heroPane.stats.activeCoachesValue")}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">{t("heroPane.stats.leadersServedLabel")}</p>
                <p className="mt-1 text-3xl font-semibold">{t("heroPane.stats.leadersServedValue")}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/60">
              <ShieldCheck className="h-4 w-4" />
              {t("heroPane.secureBadge")}
            </div>
          </div>
        </div>
      </aside>

      {/* Form pane */}
      <main className="relative flex items-center justify-center bg-gradient-subtle p-6 sm:p-12">
        <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
          <LanguageSwitcher />
        </div>
        <Card className="w-full max-w-md border-border/60 p-8 shadow-lg sm:p-10">
          <div className="mb-8 space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">
              <Sparkles className="h-3 w-3" />
              {mode === "signin" ? t("badge.signin") : t("badge.signup")}
            </div>
            <h2 className="font-display text-4xl font-light tracking-tight text-secondary">
              {mode === "signin" ? t("heading.signin") : t("heading.signup")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {mode === "signin" ? t("subheading.signin") : t("subheading.signup")}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {mode === "signup" && (
              <>
                <div className="space-y-2">
                  <Label>{t("roleSelect.label")}</Label>
                  <div className="grid grid-cols-2 gap-3">
                    {([
                      { value: "coachee", label: t("roleSelect.coachee.label"), desc: t("roleSelect.coachee.desc"), icon: Compass },
                      { value: "coach", label: t("roleSelect.coach.label"), desc: t("roleSelect.coach.desc"), icon: GraduationCap },
                    ] as const).map((opt) => {
                      const Icon = opt.icon;
                      const active = signupRole === opt.value;
                      return (
                        <button
                          type="button"
                          key={opt.value}
                          aria-pressed={active}
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
                      {t("roleSelect.coachApprovalNotice")}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="fullName">{t("fields.fullNameLabel")}</Label>
                  <Input
                    id="fullName"
                    required
                    value={form.fullName}
                    onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                    placeholder={t("fields.fullNamePlaceholder")}
                    className="h-11"
                  />
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">{t("fields.emailLabel")}</Label>
              <Input
                id="email"
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder={t("fields.emailPlaceholder")}
                className="h-11"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">{t("fields.passwordLabel")}</Label>
                <Link to="/forgot-password" className="text-xs font-semibold text-primary hover:underline">
                  {t("fields.forgotPassword")}
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                required
                minLength={8}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={t("fields.passwordPlaceholder")}
                className="h-11"
              />
            </div>

            <Button type="submit" disabled={loading} className="h-11 w-full text-base font-semibold shadow-glow">
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  {mode === "signin" ? t("submit.signin") : t("submit.signup")}
                  <ArrowRight className="ml-1 h-4 w-4" />
                </>
              )}
            </Button>
          </form>

          {mode === "signin" && (
            <div className="mt-8 border-t border-border/60 pt-6 text-center text-sm text-muted-foreground">
              {t("footer.newToClariva")}{" "}
              <Link to="/request-access" className="font-semibold text-primary hover:underline">
                {t("footer.requestAccess")}
              </Link>
            </div>
          )}

          <p className="mt-4 text-center text-xs text-muted-foreground">
            <Link to="/" className="hover:text-foreground">{t("footer.backToHome")}</Link>
          </p>
        </Card>
      </main>
    </div>
  );
}

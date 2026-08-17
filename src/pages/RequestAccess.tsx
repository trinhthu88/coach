import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import type { PostgrestError } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { ArrowLeft, CheckCircle2, Clock, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import clarivaLogo from "@/assets/clariva-logo-dark.png";
import { cn } from "@/lib/utils";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

type Role = "executive" | "coach";

// NOTE: these values are stored verbatim in access_requests.industry / .credential
// (see handleSubmit below) and are also matched against elsewhere (admin review UI).
// Translating the displayed label would either desync it from the stored value or
// require decoupling value/label — a data-modeling decision, not a mechanical
// extraction. Left untranslated for now; flagged in the Phase 5 batch-1 report.
const INDUSTRIES = [
  "Technology and Software",
  "Financial Services and Banking",
  "Consulting and Professional Services",
  "Healthcare and Life Sciences",
  "Consumer Goods and Retail",
  "Manufacturing and Industrial",
  "Media and Communications",
  "Education and Non-profit",
  "Government and Public Sector",
  "Real Estate and Infrastructure",
  "Other",
];

// Professional credential names (ICF designations) — industry-standard terms, not
// translated regardless of UI language. Also stored verbatim, same note as above.
const CREDENTIALS = [
  "ACC — Associate Certified Coach",
  "PCC — Professional Certified Coach",
  "MCC — Master Certified Coach",
  "Other",
];

export default function RequestAccess() {
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const [role, setRole] = useState<Role>("executive");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    jobTitle: "",
    company: "",
    industry: "",
    linkedin: "",
    credential: "",
    credentialOther: "",
    motivation: "",
  });

  const update = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Select isn't a native <select>, so it doesn't participate in the browser's
    // built-in `required` validation the way the text Inputs on this form do —
    // these two have to be checked explicitly.
    if (!form.industry) {
      toast({
        title: t("requestAccess.toast.error.title"),
        description: t("requestAccess.fields.selectRequiredError"),
        variant: "destructive",
      });
      return;
    }
    if (role === "coach" && !form.credential) {
      toast({
        title: t("requestAccess.toast.error.title"),
        description: t("requestAccess.fields.selectRequiredError"),
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      const email = form.email.trim().toLowerCase();
      const credential =
        form.credential === "Other"
          ? `Other — ${form.credentialOther.trim()}`
          : form.credential || null;
      const { error } = await supabase.from("access_requests").insert({
        role,
        full_name: form.fullName,
        email,
        job_title: form.jobTitle || null,
        company: form.company || null,
        industry: form.industry || null,
        linkedin_url: form.linkedin || null,
        credential: role === "coach" ? credential : null,
        motivation: form.motivation || null,
      });
      if (error) throw error;
      setDone(true);
    } catch (err) {
      const pgError = err as Partial<PostgrestError> | undefined;
      const duplicate =
        pgError?.code === "23505" ||
        String(pgError?.message ?? "").toLowerCase().includes("access_requests_email_unique");
      toast({
        title: t("requestAccess.toast.error.title"),
        description: duplicate
          ? t("requestAccess.toast.error.duplicateDescription")
          : getFriendlyErrorMessage(pgError, t, { fallback: t("toast.error.genericDescription") }),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-secondary text-primary-foreground">
      <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-white/5 bg-secondary/85 px-6 backdrop-blur sm:px-12">
        <Link to="/" className="flex items-center gap-3">
          <img src={clarivaLogo} alt={t("heroPane.logoAlt")} className="h-8 w-auto object-contain" />
        </Link>
        <div className="flex items-center gap-4">
          <LanguageSwitcher />
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-xs font-semibold tracking-wider text-white/40 transition-colors hover:text-white/80"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> {t("requestAccess.backToHome")}
          </Link>
        </div>
      </header>

      <div className="grid min-h-[calc(100vh-4rem)] lg:grid-cols-2">
        {/* Left rail */}
        <aside className="relative hidden flex-col justify-center overflow-hidden border-r border-white/5 px-12 py-20 lg:flex">
          <div className="pointer-events-none absolute -left-1/3 top-1/4 h-[600px] w-[600px] rounded-full bg-primary/10 blur-3xl" />
          <div className="relative">
            <div className="mb-9 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-primary-glow">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              {t("requestAccess.invitationBadge")}
            </div>
            <h1 className="font-display text-5xl font-light leading-[0.95] tracking-tight">
              {t("requestAccess.heroTitleLine1")}<br />
              {t("requestAccess.heroTitleLine2Lead")} <em className="text-primary-glow">{t("requestAccess.heroTitleEmphasis")}</em>
            </h1>
            <p className="mt-5 max-w-md text-sm leading-relaxed text-white/45">
              {t("requestAccess.heroSubtitle")}
            </p>
            <div className="mt-12 space-y-5">
              {([
                { icon: ShieldCheck, key: "vetted" },
                { icon: Clock, key: "response" },
                { icon: Sparkles, key: "privacy" },
              ] as const).map((p) => (
                <div key={p.key} className="flex items-start gap-3.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10">
                    <p.icon className="h-4 w-4 text-primary-glow" />
                  </div>
                  <p className="pt-1 text-sm leading-relaxed text-white/45">
                    <strong className="font-semibold text-white/80">{t(`requestAccess.vettingPoints.${p.key}.title`)}</strong> {t(`requestAccess.vettingPoints.${p.key}.body`)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Right form */}
        <main className="px-6 py-12 sm:px-12 lg:py-20">
          {done ? (
            <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-5 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full border border-success/25 bg-success/10">
                <CheckCircle2 className="h-7 w-7 text-success" />
              </div>
              <h2 className="font-display text-4xl font-light leading-none">
                {t("requestAccess.success.titleLead")} <em className="text-primary-glow">{t("requestAccess.success.titleEmphasis")}</em>
              </h2>
              <p className="max-w-sm text-sm leading-relaxed text-white/40">
                {t("requestAccess.success.body")}
              </p>
              <Button
                variant="outline"
                onClick={() => navigate("/")}
                className="mt-2 rounded-full border-white/15 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
              >
                {t("requestAccess.success.backButton")}
              </Button>
            </div>
          ) : (
            <div className="mx-auto max-w-xl">
              <div className="mb-8">
                <h2 className="text-2xl font-bold tracking-tight">{t("requestAccess.formHeading")}</h2>
                <p className="mt-2 text-sm leading-relaxed text-white/40">
                  {t("requestAccess.formSubtitle")}
                </p>
              </div>

              {/* Role toggle */}
              <div className="mb-8 grid grid-cols-2 gap-0.5 overflow-hidden rounded-xl border border-white/10 bg-white/5">
                {(
                  [
                    {
                      value: "executive",
                      key: "executive",
                      activeBg: "bg-primary/10",
                      activeLabel: "text-primary-glow",
                      dot: "bg-primary",
                    },
                    {
                      value: "coach",
                      key: "coach",
                      activeBg: "bg-accent/10",
                      activeLabel: "text-accent",
                      dot: "bg-accent",
                    },
                  ] as const
                ).map((opt) => {
                  const active = role === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setRole(opt.value)}
                      className={cn(
                        "flex flex-col items-start gap-1 px-5 py-4 text-left transition-colors",
                        active ? opt.activeBg : "hover:bg-white/[0.04]"
                      )}
                    >
                      <span
                        className={cn(
                          "mb-1 h-1.5 w-1.5 rounded-full",
                          active ? opt.dot : "bg-white/15"
                        )}
                      />
                      <span
                        className={cn(
                          "text-sm font-bold",
                          active ? opt.activeLabel : "text-white/35"
                        )}
                      >
                        {t(`requestAccess.roleToggle.${opt.key}.label`)}
                      </span>
                      <span className="text-[11px] leading-snug text-white/25">{t(`requestAccess.roleToggle.${opt.key}.sub`)}</span>
                    </button>
                  );
                })}
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id="fullName" label={t("requestAccess.fields.fullNameLabel")} required>
                    <DarkInput
                      id="fullName"
                      required
                      value={form.fullName}
                      onChange={(e) => update("fullName", e.target.value)}
                      placeholder={t("requestAccess.fields.fullNamePlaceholder")}
                    />
                  </Field>
                  <Field id="email" label={t("requestAccess.fields.emailLabel")} required>
                    <DarkInput
                      id="email"
                      type="email"
                      required
                      value={form.email}
                      onChange={(e) => update("email", e.target.value)}
                      placeholder={t("requestAccess.fields.emailPlaceholder")}
                    />
                  </Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id="jobTitle" label={t("requestAccess.fields.jobTitleLabel")} required>
                    <DarkInput
                      id="jobTitle"
                      required
                      value={form.jobTitle}
                      onChange={(e) => update("jobTitle", e.target.value)}
                      placeholder={t("requestAccess.fields.jobTitlePlaceholder")}
                    />
                  </Field>
                  <Field id="company" label={t("requestAccess.fields.companyLabel")} required>
                    <DarkInput
                      id="company"
                      required
                      value={form.company}
                      onChange={(e) => update("company", e.target.value)}
                      placeholder={t("requestAccess.fields.companyPlaceholder")}
                    />
                  </Field>
                </div>

                <Field id="industry" label={t("requestAccess.fields.industryLabel")} required>
                  <Select value={form.industry} onValueChange={(v) => update("industry", v)}>
                    <SelectTrigger className="h-12 rounded-[10px] border-white/10 bg-white/[0.05] text-sm font-medium text-white hover:bg-white/[0.07] focus:border-primary/50 focus:ring-0">
                      <SelectValue placeholder={t("requestAccess.fields.industryPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {INDUSTRIES.map((i) => (
                        <SelectItem key={i} value={i}>
                          {i}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field id="linkedin" label={t("requestAccess.fields.linkedinLabel")} optional>
                  <DarkInput
                    id="linkedin"
                    type="url"
                    value={form.linkedin}
                    onChange={(e) => update("linkedin", e.target.value)}
                    placeholder={t("requestAccess.fields.linkedinPlaceholder")}
                  />
                </Field>

                {role === "coach" && (
                  <>
                    <Field id="credential" label={t("requestAccess.fields.credentialLabel")} required>
                      <Select
                        value={form.credential}
                        onValueChange={(v) => update("credential", v)}
                      >
                        <SelectTrigger className="h-12 rounded-[10px] border-white/10 bg-white/[0.05] text-sm font-medium text-white hover:bg-white/[0.07] focus:border-primary/50 focus:ring-0">
                          <SelectValue placeholder={t("requestAccess.fields.credentialPlaceholder")} />
                        </SelectTrigger>
                        <SelectContent>
                          {CREDENTIALS.map((c) => (
                            <SelectItem key={c} value={c}>
                              {c}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    {form.credential === "Other" && (
                      <Field id="credentialOther" label={t("requestAccess.fields.credentialOtherLabel")} required>
                        <DarkInput
                          id="credentialOther"
                          required
                          value={form.credentialOther}
                          onChange={(e) => update("credentialOther", e.target.value)}
                          placeholder={t("requestAccess.fields.credentialOtherPlaceholder")}
                        />
                      </Field>
                    )}
                  </>
                )}

                <Field
                  id="motivation"
                  label={
                    role === "coach"
                      ? t("requestAccess.fields.motivationLabelCoach")
                      : t("requestAccess.fields.motivationLabelExecutive")
                  }
                  optional
                >
                  <Textarea
                    id="motivation"
                    value={form.motivation}
                    onChange={(e) => update("motivation", e.target.value)}
                    placeholder={
                      role === "coach"
                        ? t("requestAccess.fields.motivationPlaceholderCoach")
                        : t("requestAccess.fields.motivationPlaceholderExecutive")
                    }
                    className="min-h-[96px] resize-none rounded-[10px] border-white/10 bg-white/[0.05] text-sm text-white placeholder:text-white/20 focus-visible:border-primary/50 focus-visible:ring-0"
                  />
                </Field>

                <div className="border-t border-white/[0.07] pt-6">
                  <Button
                    type="submit"
                    disabled={submitting}
                    className={cn(
                      "h-12 w-full rounded-full text-sm font-bold tracking-wide shadow-glow",
                      role === "coach"
                        ? "bg-accent text-accent-foreground hover:bg-accent/90"
                        : "bg-primary text-primary-foreground hover:bg-primary/90"
                    )}
                  >
                    {submitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <ShieldCheck className="h-4 w-4" /> {t("requestAccess.submit")}
                      </>
                    )}
                  </Button>
                  <p className="mt-3.5 text-center text-[11px] leading-relaxed text-white/20">
                    {t("requestAccess.disclaimer")}
                  </p>
                  {role === "executive" && (
                    <p className="mt-2 text-center text-[11px] leading-relaxed text-white/20">
                      {t("requestAccess.sponsorDisclaimer")}
                    </p>
                  )}
                </div>
              </form>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  required,
  optional,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  optional?: boolean;
  children: React.ReactNode;
}) {
  const { t } = useTranslation("auth");
  return (
    <div className="space-y-2">
      <Label
        htmlFor={id}
        className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/30"
      >
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
        {optional && (
          <span className="ml-1 normal-case tracking-normal text-white/20">{t("requestAccess.fields.optionalSuffix")}</span>
        )}
      </Label>
      {children}
    </div>
  );
}

function DarkInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Input
      {...props}
      className={cn(
        "h-12 rounded-[10px] border-white/10 bg-white/[0.05] text-sm font-medium text-white placeholder:text-white/20 focus-visible:border-primary/50 focus-visible:ring-0",
        props.className
      )}
    />
  );
}

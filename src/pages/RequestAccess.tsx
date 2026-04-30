import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
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
import { ArrowLeft, CheckCircle2, Clock, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import clarivaLogo from "@/assets/clariva-logo-dark.png";
import { cn } from "@/lib/utils";

type Role = "executive" | "coach";

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

const CREDENTIALS = [
  "ACC — Associate Certified Coach",
  "PCC — Professional Certified Coach",
  "MCC — Master Certified Coach",
];

export default function RequestAccess() {
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
    motivation: "",
  });

  const update = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { error } = await supabase.from("access_requests").insert({
        role,
        full_name: form.fullName,
        email: form.email,
        job_title: form.jobTitle || null,
        company: form.company || null,
        industry: form.industry || null,
        linkedin_url: form.linkedin || null,
        credential: role === "coach" ? form.credential || null : null,
        motivation: form.motivation || null,
      });
      if (error) throw error;
      setDone(true);
    } catch (err: any) {
      toast({
        title: "Submission failed",
        description: err.message ?? "Please try again.",
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
          <img src={clarivaLogo} alt="Clariva" className="h-8 w-auto object-contain" />
        </Link>
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-xs font-semibold tracking-wider text-white/40 transition-colors hover:text-white/80"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to home
        </Link>
      </header>

      <div className="grid min-h-[calc(100vh-4rem)] lg:grid-cols-2">
        {/* Left rail */}
        <aside className="relative hidden flex-col justify-center overflow-hidden border-r border-white/5 px-12 py-20 lg:flex">
          <div className="pointer-events-none absolute -left-1/3 top-1/4 h-[600px] w-[600px] rounded-full bg-primary/10 blur-3xl" />
          <div className="relative">
            <div className="mb-9 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-primary-glow">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              By invitation only
            </div>
            <h1 className="font-display text-5xl font-light leading-[0.95] tracking-tight">
              Access begins<br />
              with a <em className="text-primary-glow">conversation.</em>
            </h1>
            <p className="mt-5 max-w-md text-sm leading-relaxed text-white/45">
              Clariva is a private platform. We review every application to ensure both coaches
              and executives are ready for work at the highest level.
            </p>
            <div className="mt-12 space-y-5">
              {[
                {
                  icon: ShieldCheck,
                  title: "Vetted on both sides.",
                  body: "Every coach holds an ICF credential. Every executive is reviewed for readiness and intent.",
                },
                {
                  icon: Clock,
                  title: "Response within 48 hours.",
                  body: "Our team reviews every application personally — not by algorithm.",
                },
                {
                  icon: Sparkles,
                  title: "Your data stays private.",
                  body: "Application information is never shared or used for any purpose other than your access review.",
                },
              ].map((p) => (
                <div key={p.title} className="flex items-start gap-3.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10">
                    <p.icon className="h-4 w-4 text-primary-glow" />
                  </div>
                  <p className="pt-1 text-sm leading-relaxed text-white/45">
                    <strong className="font-semibold text-white/80">{p.title}</strong> {p.body}
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
                Application <em className="text-primary-glow">received.</em>
              </h2>
              <p className="max-w-sm text-sm leading-relaxed text-white/40">
                Thank you. Our team will review your application and reach out within 48 hours.
              </p>
              <Button
                variant="outline"
                onClick={() => navigate("/")}
                className="mt-2 rounded-full border-white/15 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
              >
                Back to Clariva
              </Button>
            </div>
          ) : (
            <div className="mx-auto max-w-xl">
              <div className="mb-8">
                <h2 className="text-2xl font-bold tracking-tight">Request access</h2>
                <p className="mt-2 text-sm leading-relaxed text-white/40">
                  Tell us about yourself. We will review your application and be in touch within
                  48 hours.
                </p>
              </div>

              {/* Role toggle */}
              <div className="mb-8 grid grid-cols-2 gap-0.5 overflow-hidden rounded-xl border border-white/10 bg-white/5">
                {(
                  [
                    {
                      value: "executive",
                      label: "I am an executive",
                      sub: "Seeking a vetted coach for leadership growth",
                      activeBg: "bg-primary/10",
                      activeLabel: "text-primary-glow",
                      dot: "bg-primary",
                    },
                    {
                      value: "coach",
                      label: "I am a coach",
                      sub: "ICF-credentialed, applying to join the platform",
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
                        {opt.label}
                      </span>
                      <span className="text-[11px] leading-snug text-white/25">{opt.sub}</span>
                    </button>
                  );
                })}
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id="fullName" label="Full name" required>
                    <DarkInput
                      id="fullName"
                      required
                      value={form.fullName}
                      onChange={(e) => update("fullName", e.target.value)}
                      placeholder="Your full name"
                    />
                  </Field>
                  <Field id="email" label="Work email" required>
                    <DarkInput
                      id="email"
                      type="email"
                      required
                      value={form.email}
                      onChange={(e) => update("email", e.target.value)}
                      placeholder="you@company.com"
                    />
                  </Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id="jobTitle" label="Job title" required>
                    <DarkInput
                      id="jobTitle"
                      required
                      value={form.jobTitle}
                      onChange={(e) => update("jobTitle", e.target.value)}
                      placeholder="e.g. Chief Executive Officer"
                    />
                  </Field>
                  <Field id="company" label="Company" required>
                    <DarkInput
                      id="company"
                      required
                      value={form.company}
                      onChange={(e) => update("company", e.target.value)}
                      placeholder="Your organisation"
                    />
                  </Field>
                </div>

                <Field id="industry" label="Industry" required>
                  <Select value={form.industry} onValueChange={(v) => update("industry", v)}>
                    <SelectTrigger className="h-12 rounded-[10px] border-white/10 bg-white/[0.05] text-sm font-medium text-white hover:bg-white/[0.07] focus:border-primary/50 focus:ring-0">
                      <SelectValue placeholder="Select your industry" />
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

                <Field id="linkedin" label="LinkedIn profile URL" required>
                  <DarkInput
                    id="linkedin"
                    type="url"
                    required
                    value={form.linkedin}
                    onChange={(e) => update("linkedin", e.target.value)}
                    placeholder="https://linkedin.com/in/yourname"
                  />
                </Field>

                {role === "coach" && (
                  <Field id="credential" label="ICF credential level" required>
                    <Select
                      value={form.credential}
                      onValueChange={(v) => update("credential", v)}
                    >
                      <SelectTrigger className="h-12 rounded-[10px] border-white/10 bg-white/[0.05] text-sm font-medium text-white hover:bg-white/[0.07] focus:border-primary/50 focus:ring-0">
                        <SelectValue placeholder="Select your credential" />
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
                )}

                <Field
                  id="motivation"
                  label={
                    role === "coach"
                      ? "What draws you to Clariva?"
                      : "What are you hoping to work on?"
                  }
                  optional
                >
                  <Textarea
                    id="motivation"
                    value={form.motivation}
                    onChange={(e) => update("motivation", e.target.value)}
                    placeholder={
                      role === "coach"
                        ? "Tell us about your coaching philosophy and the clients you serve best…"
                        : "Brief context helps us find the right match for you…"
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
                        <ShieldCheck className="h-4 w-4" /> Submit application
                      </>
                    )}
                  </Button>
                  <p className="mt-3.5 text-center text-[11px] leading-relaxed text-white/20">
                    By submitting you agree to our Privacy Policy and Terms of Service. We will
                    never share your information.
                  </p>
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
  return (
    <div className="space-y-2">
      <Label
        htmlFor={id}
        className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/30"
      >
        {label}
        {optional && (
          <span className="ml-1 normal-case tracking-normal text-white/20">(optional)</span>
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

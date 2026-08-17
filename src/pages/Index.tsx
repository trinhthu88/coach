import { Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Search, Calendar, Activity, Shield, Lock, Clock, Users,
  ArrowRight, Play, ChevronRight,
} from "lucide-react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

/**
 * Clariva landing page — restyled to match the marketing HTML mock.
 * Uses semantic tokens from index.css. No hard-coded hex outside small SVG marks.
 */
export default function Index() {
  const { t } = useTranslation("landing");
  const { user } = useAuth();
  const [mockView, setMockView] = useState<"executive" | "coach">("executive");

  return (
    <div className="min-h-screen bg-background text-foreground font-sans-ui">
      {/* NAV */}
      <nav className="fixed inset-x-0 top-0 z-50 flex h-[68px] items-center justify-between gap-3 border-b border-border bg-background/90 px-4 backdrop-blur-md sm:px-12">
        <Link to="/" className="flex min-w-0 shrink items-center gap-2 sm:gap-2.5">
          <BrandMark className="h-7 w-7 shrink-0" />
          <span className="truncate text-[17px] font-bold tracking-tight text-secondary sm:text-[20px]">{t("brandName")}</span>
        </Link>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <LanguageSwitcher />
          {user ? (
            <Link
              to="/dashboard"
              className="whitespace-nowrap rounded-full bg-primary px-3.5 py-2 text-[12px] font-bold tracking-wide text-primary-foreground transition-colors hover:bg-secondary sm:px-5 sm:py-2.5 sm:text-[13px]"
            >
              {t("cta.openDashboard")}
            </Link>
          ) : (
            <>
              <Link
                to="/auth"
                className="whitespace-nowrap rounded-full border-[1.5px] border-border px-3.5 py-2 text-[12px] font-semibold text-secondary transition-colors hover:border-primary hover:text-primary sm:px-5 sm:py-2.5 sm:text-[13px]"
              >
                {t("cta.signIn")}
              </Link>
              <Link
                to="/request-access"
                className="whitespace-nowrap rounded-full bg-primary px-3.5 py-2 text-[12px] font-bold tracking-wide text-primary-foreground transition-colors hover:bg-secondary sm:px-5 sm:py-2.5 sm:text-[13px]"
              >
                <span className="sm:hidden">{t("cta.requestAccessShort")}</span>
                <span className="hidden sm:inline">{t("cta.requestAccess")}</span>
              </Link>
            </>
          )}
        </div>
      </nav>

      {/* HERO */}
      <section className="relative flex min-h-screen items-center overflow-hidden bg-secondary px-6 pb-20 pt-[140px] text-secondary-foreground sm:px-12">
        {/* grid + orbs */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px)",
            backgroundSize: "72px 72px",
            maskImage: "radial-gradient(ellipse 90% 90% at 50% 50%, black 10%, transparent 75%)",
          }}
        />
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[900px] w-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: "radial-gradient(circle, hsl(var(--primary) / 0.10) 0%, transparent 65%)" }} />
        <div className="pointer-events-none absolute -bottom-[10%] right-[5%] h-[400px] w-[400px] rounded-full"
          style={{ background: "radial-gradient(circle, hsl(var(--accent) / 0.08) 0%, transparent 70%)" }} />

        <div className="relative z-10 mx-auto grid max-w-[1200px] items-center gap-20 lg:grid-cols-2">
          <div>
            <div className="mb-8 inline-flex items-center gap-2.5 rounded-full border border-primary/25 bg-primary/10 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-primary-glow">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              {t("hero.badge")}
            </div>
            <h1 className="font-display text-[clamp(52px,6.5vw,88px)] font-light leading-[0.95] tracking-tight text-white">
              {t("hero.titleLine1")}<br />{t("hero.titleLine2")}<br />
              <em className="font-light not-italic italic text-primary-glow">{t("hero.titleEmphasis")}</em>
            </h1>
            <p className="mb-10 mt-6 max-w-[44ch] text-[16px] leading-[1.75] text-white/50">
              {t("hero.subtitle")}
            </p>
            <div className="flex flex-wrap items-center gap-3.5">
              <Link
                to={user ? "/dashboard" : "/request-access"}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-7 py-3.5 text-[14px] font-bold tracking-wide text-primary-foreground transition-all hover:-translate-y-px hover:bg-primary-glow"
              >
                <Shield className="h-4 w-4" />
                {user ? t("cta.openDashboard") : t("cta.requestAccess")}
              </Link>
              <Link
                to="#how"
                className="inline-flex items-center gap-2 rounded-full border-[1.5px] border-white/20 px-7 py-3.5 text-[14px] font-semibold text-white/70 transition-colors hover:border-white/50 hover:text-white"
              >
                <Play className="h-4 w-4" />
                {t("cta.howItWorks")}
              </Link>
            </div>
          </div>

          {/* App mockup */}
          <div className="hidden overflow-hidden rounded-[20px] border border-white/10 bg-white/[0.04] shadow-2xl lg:block">
            <div className="flex items-center justify-between border-b border-white/[0.07] bg-white/[0.06] px-4 py-2.5">
              <div className="flex gap-1 rounded-full bg-black/20 p-[3px]">
                {(["executive", "coach"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={mockView === v}
                    onClick={() => setMockView(v)}
                    className={`rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider transition-colors ${
                      mockView === v ? "bg-white/15 text-white/90" : "text-white/40"
                    }`}
                  >
                    {t(`mock.tabs.${v}`)}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <div className="text-right">
                  <div className="text-[11px] font-semibold text-white/60">
                    {mockView === "coach" ? t("mock.headerName.coach") : t("mock.headerName.executive")}
                  </div>
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-primary-glow">
                    {mockView === "coach" ? t("mock.headerRole.coach") : t("mock.headerRole.executive")}
                  </div>
                </div>
                <div
                  className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white"
                  style={{ background: mockView === "coach" ? "hsl(var(--accent))" : "hsl(var(--primary))" }}
                >
                  {mockView === "coach" ? t("mock.headerInitials.coach") : t("mock.headerInitials.executive")}
                </div>
              </div>
            </div>
            <MockBody view={mockView} />
          </div>
        </div>
      </section>

      {/* TRUST STRIP */}
      <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-3 border-y border-border bg-muted px-6 py-5">
        {[
          { Icon: Shield, label: t("trustStrip.icfCertified") },
          { Icon: Lock, label: t("trustStrip.encrypted") },
          { Icon: Clock, label: t("trustStrip.inviteOnly") },
          { Icon: Users, label: t("trustStrip.vetted") },
          { Icon: Activity, label: t("trustStrip.competencyTracking") },
        ].map(({ Icon, label }) => (
          <div key={label} className="flex items-center gap-2.5 text-[12px] font-semibold tracking-wide text-muted-foreground">
            <Icon className="h-4 w-4 opacity-50" />
            {label}
          </div>
        ))}
      </div>

      {/* HOW IT WORKS */}
      <section id="how" className="bg-card px-6 py-24 sm:px-12">
        <div className="mx-auto max-w-[1200px]">
          <Eyebrow>{t("howItWorks.eyebrow")}</Eyebrow>
          <h2 className="font-display text-[clamp(36px,4vw,56px)] font-light leading-[1.05] tracking-tight text-secondary">
            {t("howItWorks.titleLine1")}<br />{t("howItWorks.titleLine2Lead")} <em className="not-italic italic text-primary">{t("howItWorks.titleEmphasis")}</em>
          </h2>
          <p className="mt-4 max-w-[52ch] text-[16px] leading-[1.7] text-muted-foreground">
            {t("howItWorks.subtitle")}
          </p>
          <div className="mt-14 grid gap-0.5 md:grid-cols-3">
            {(["match", "book", "track"] as const).map((key, i, arr) => (
              <div
                key={key}
                className={`relative bg-background p-10 ${
                  i === 0 ? "md:rounded-l-2xl" : ""
                } ${i === arr.length - 1 ? "md:rounded-r-2xl" : ""}`}
              >
                <div className="mb-6 font-display text-[64px] font-light leading-none tracking-tight text-border">{t(`howItWorks.steps.${key}.n`)}</div>
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-primary-soft">
                  {key === "match" && <Search className="h-5 w-5 text-primary" />}
                  {key === "book" && <Calendar className="h-5 w-5 text-primary" />}
                  {key === "track" && <Activity className="h-5 w-5 text-primary" />}
                </div>
                <h3 className="mb-3 text-[18px] font-bold tracking-tight text-secondary">{t(`howItWorks.steps.${key}.title`)}</h3>
                <p className="text-[14px] leading-[1.7] text-muted-foreground">{t(`howItWorks.steps.${key}.desc`)}</p>
                {i < arr.length - 1 && (
                  <div className="absolute right-[-16px] top-1/2 z-10 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border-[1.5px] border-border bg-card text-primary md:flex">
                    <ChevronRight className="h-4 w-4" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FOR BOTH */}
      <section className="bg-background px-6 py-24 sm:px-12">
        <div className="mx-auto max-w-[1200px]">
          <Eyebrow>{t("forBoth.eyebrow")}</Eyebrow>
          <h2 className="font-display text-[clamp(36px,4vw,56px)] font-light leading-[1.05] tracking-tight text-secondary">
            {t("forBoth.titleLine1Lead")} <em className="not-italic italic text-primary">{t("forBoth.titleLine1Emphasis")}</em><br />
            {t("forBoth.titleLine2Lead")} <em className="not-italic italic text-primary">{t("forBoth.titleLine2Emphasis")}</em> {t("forBoth.titleLine2Trail")}
          </h2>
          <div className="mt-14 grid gap-6 lg:grid-cols-2">
            <RoleCard
              eyebrow={t("forBoth.coachees.eyebrow")}
              eyebrowColor="text-primary-glow"
              title={<>{t("forBoth.coachees.titleLead")} <em className="not-italic italic">{t("forBoth.coachees.titleEmphasis")}</em> {t("forBoth.coachees.titleTrail")}</>}
              sub={t("forBoth.coachees.sub")}
              ctaTone="primary"
              checkTone="primary"
              ctaLabel={t("cta.requestAccess")}
              features={t("forBoth.coachees.features", { returnObjects: true }) as string[]}
            />
            <RoleCard
              eyebrow={t("forBoth.coaches.eyebrow")}
              eyebrowColor="text-accent"
              title={<>{t("forBoth.coaches.titleLead")} <em className="not-italic italic">{t("forBoth.coaches.titleEmphasis")}</em> {t("forBoth.coaches.titleTrail")}</>}
              sub={t("forBoth.coaches.sub")}
              ctaTone="accent"
              checkTone="accent"
              ctaLabel={t("cta.requestAccess")}
              features={t("forBoth.coaches.features", { returnObjects: true }) as string[]}
            />
          </div>
        </div>
      </section>

      {/* STATS STRIP */}
      <div className="bg-primary px-6 py-16 sm:px-12">
        <div className="mx-auto grid max-w-[1200px] gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0">
          {(["credentialed", "rating", "outcomes", "speed"] as const).map((key, i, arr) => (
            <div
              key={key}
              className={`px-5 text-center lg:border-r lg:border-white/20 ${i === arr.length - 1 ? "lg:border-r-0" : ""}`}
            >
              <div className="mb-2 font-display text-[52px] font-light leading-none tracking-tight text-white">
                {t(`statsStrip.${key}.num`)}<em className="not-italic italic">{t(`statsStrip.${key}.em`)}</em>
              </div>
              <div className="text-[12px] font-semibold uppercase tracking-wider text-white/65">{t(`statsStrip.${key}.label`)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* TESTIMONIALS */}
      <section className="bg-secondary px-6 py-24 sm:px-12">
        <div className="mx-auto max-w-[1200px]">
          <Eyebrow className="text-primary-glow">{t("testimonials.eyebrow")}</Eyebrow>
          <h2 className="font-display text-[clamp(36px,4vw,56px)] font-light leading-[1.05] tracking-tight text-white">
            {t("testimonials.titleLine1")}<br /><em className="not-italic italic text-primary-glow">{t("testimonials.titleEmphasis")}</em>
          </h2>
          <div className="mt-14 grid gap-5 lg:grid-cols-3">
            {(["james", "elena", "soren"] as const).map((key, i) => {
              const color = ["hsl(var(--primary))", "hsl(var(--accent))", "hsl(var(--success))"][i];
              return (
                <div key={key} className="rounded-2xl border border-white/10 bg-white/5 p-9">
                  <div className="mb-4 flex gap-1 text-accent">★★★★★</div>
                  <div className="mb-6 font-display text-[17px] font-light italic leading-[1.55] text-white/85">
                    {t(`testimonials.${key}.quotePrefix`)}
                    <em className="not-italic italic text-primary-glow">{t(`testimonials.${key}.quoteEmphasis`)}</em>
                    {t(`testimonials.${key}.quoteSuffix`)}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-bold text-white" style={{ background: color }}>
                      {t(`testimonials.${key}.initials`)}
                    </div>
                    <div>
                      <div className="text-[13px] font-bold text-white/80">{t(`testimonials.${key}.name`)}</div>
                      <div className="text-[11px] text-white/35">{t(`testimonials.${key}.role`)}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA BANNER */}
      <section className="bg-background px-6 py-24 sm:px-12">
        <div className="mx-auto max-w-[1200px]">
          <div className="relative overflow-hidden rounded-3xl bg-secondary px-8 py-20 text-center sm:px-20">
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ background: "radial-gradient(circle, hsl(var(--primary) / 0.12), transparent 70%)" }} />
            <div className="relative z-10">
              <Eyebrow className="mx-auto justify-center text-primary-glow before:hidden">{t("ctaBanner.eyebrow")}</Eyebrow>
              <h2 className="font-display text-[clamp(40px,5vw,68px)] font-light leading-[1.05] tracking-tight text-white">
                {t("ctaBanner.titleLine1")}<br />
                {t("ctaBanner.titleLine2Lead")} <em className="not-italic italic text-primary-glow">{t("ctaBanner.titleLine2Emphasis")}</em><br />
                {t("ctaBanner.titleLine3")}
              </h2>
              <p className="mx-auto mt-4 max-w-[44ch] text-[16px] leading-[1.7] text-white/45">
                {t("ctaBanner.subtitle")}
              </p>
              <div className="mt-10 flex flex-wrap items-center justify-center gap-3.5">
                <Link
                  to="/request-access"
                  className="inline-flex items-center gap-2 rounded-full bg-primary px-9 py-4 text-[15px] font-bold text-primary-foreground transition-colors hover:bg-primary-glow"
                >
                  {t("cta.requestAccess")} <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  to="/auth"
                  className="rounded-full border-[1.5px] border-white/20 px-9 py-4 text-[15px] font-semibold text-white/65 transition-colors hover:border-white/50 hover:text-white"
                >
                  {t("cta.signIn")}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-foreground px-6 pb-10 pt-16 sm:px-12">
        <div className="mx-auto max-w-[1200px]">
          <div className="grid gap-10 pb-12 md:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
            <div>
              <div className="flex items-center gap-2.5">
                <BrandMark className="h-6 w-6" />
                <span className="text-[18px] font-bold tracking-tight text-white">{t("brandName")}</span>
              </div>
              <p className="mt-3 max-w-[28ch] text-[13px] leading-[1.7] text-white/30">
                {t("footer.tagline")}
              </p>
            </div>
            <FooterCol
              title={t("footer.platformCol")}
              items={[
                { label: t("cta.requestAccess"), to: "/request-access" },
                { label: t("cta.howItWorks"), to: "/#how" },
                { label: t("cta.signIn"), to: "/auth" },
              ]}
            />
            <FooterCol
              title={t("footer.companyCol")}
              items={[
                { label: t("footer.companyItems.about") },
                { label: t("footer.companyItems.blog") },
                { label: t("footer.companyItems.careers") },
                { label: t("footer.companyItems.contact") },
              ]}
            />
            <FooterCol
              title={t("footer.legalCol")}
              items={[
                { label: t("footer.legalItems.privacy") },
                { label: t("footer.legalItems.terms") },
                { label: t("footer.legalItems.cookies") },
              ]}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] pt-6">
            <span className="text-[12px] text-white/20">{t("footer.copyright")}</span>
            <span className="font-display text-[14px] font-light italic text-white/25">{t("footer.tagline2")}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ----------------- helpers ----------------- */

function Eyebrow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`mb-5 flex items-center gap-2.5 text-[11px] font-bold uppercase tracking-[0.3em] text-primary before:block before:h-[1.5px] before:w-5 before:bg-current ${className}`}>
      {children}
    </div>
  );
}

function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className}>
      <defs>
        <linearGradient id="cMG" x1="0" y1="0" x2="48" y2="48"><stop offset="0%" stopColor="hsl(var(--primary-glow))" /><stop offset="100%" stopColor="hsl(var(--primary))" /></linearGradient>
        <linearGradient id="cAG" x1="0" y1="0" x2="48" y2="48"><stop offset="0%" stopColor="hsl(var(--accent))" /><stop offset="100%" stopColor="hsl(var(--destructive))" /></linearGradient>
      </defs>
      <path d="M 8 24 C 8 13.5 15.2 5 24 5 C 32.8 5 40 13.5 40 24" stroke="url(#cMG)" strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d="M 8 24 C 8 34.5 15.2 43 24 43 C 32.8 43 40 34.5 40 24" stroke="url(#cMG)" strokeWidth="3" strokeLinecap="round" fill="none" opacity=".5" />
      <circle cx="24" cy="24" r="3.5" fill="url(#cMG)" />
      <line x1="27.5" y1="24" x2="44" y2="24" stroke="url(#cAG)" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M 40 20.5 L 44 24 L 40 27.5" stroke="url(#cAG)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function RoleCard({
  eyebrow, eyebrowColor, title, sub, features, ctaTone, checkTone, ctaLabel,
}: {
  eyebrow: string;
  eyebrowColor: string;
  title: React.ReactNode;
  sub: string;
  features: string[];
  ctaTone: "primary" | "accent";
  checkTone: "primary" | "accent";
  ctaLabel: string;
}) {
  const ctaClass = ctaTone === "primary" ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground";
  const checkBg = checkTone === "primary" ? "bg-primary-soft text-primary" : "bg-accent/10 text-accent";
  return (
    <div className="overflow-hidden rounded-[20px]">
      <div className="bg-secondary p-10">
        <div className={`mb-4 text-[10px] font-bold uppercase tracking-[0.24em] ${eyebrowColor}`}>{eyebrow}</div>
        <div className="mb-3 font-display text-[32px] font-light leading-tight tracking-tight text-white">{title}</div>
        <p className="mb-6 text-[13px] leading-[1.7] text-white/50">{sub}</p>
        <Link to="/request-access" className={`inline-flex items-center gap-2 rounded-full px-6 py-3 text-[13px] font-bold ${ctaClass}`}>
          {ctaLabel} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="rounded-b-[20px] border border-t-0 border-border bg-card p-10">
        <ul className="flex flex-col gap-3.5">
          {features.map((f) => (
            <li key={f} className="flex items-start gap-3.5">
              <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${checkBg}`}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <span className="text-[14px] leading-[1.5] text-foreground">{f}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function FooterCol({ title, items }: { title: string; items: { label: string; to?: string }[] }) {
  return (
    <div>
      <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.22em] text-white/30">{title}</div>
      <ul className="flex flex-col gap-2.5">
        {items.map((it) => (
          <li key={it.label}>
            {it.to ? (
              <Link to={it.to} className="text-[13px] text-white/45 transition-colors hover:text-white/80">{it.label}</Link>
            ) : (
              <span className="text-[13px] text-white/45">{it.label}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Always a few days out from today, so the marketing mockup never looks stale.
 */
function mockNextSessionDate(language: string): string {
  const d = new Date();
  d.setDate(d.getDate() + 4);
  const locale = language.startsWith("vi") ? "vi-VN" : "en-US";
  return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

function MockBody({ view }: { view: "executive" | "coach" }) {
  const { t, i18n } = useTranslation("landing");
  const isCoach = view === "coach";
  const nextSessionDate = mockNextSessionDate(i18n.language);
  const navItems = t(isCoach ? "mock.navCoach" : "mock.navExecutive", { returnObjects: true }) as string[];
  const commsItems = t("mock.navComms", { returnObjects: true }) as string[];
  const quickActions = t(isCoach ? "mock.quickActions.coach" : "mock.quickActions.executive", { returnObjects: true }) as string[];
  const stats = t(isCoach ? "mock.stats.coach" : "mock.stats.executive", { returnObjects: true }) as { l: string; v: string }[];
  const statColors = isCoach
    ? ["text-primary", "text-white/90", "text-white/90", "text-accent"]
    : ["text-white/90", "text-primary", "text-white/90", "text-accent"];

  return (
    <div className="flex">
      <aside className="w-[140px] shrink-0 border-r border-white/[0.06] bg-white/[0.03] py-4">
        {navItems.map((label, i) => (
          <div
            key={label}
            className={`flex items-center gap-2 px-4 py-2 text-[10px] font-semibold ${
              i === 0
                ? "border-r-2 border-primary bg-primary/10 text-primary-glow"
                : "text-white/35"
            }`}
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-50" />
            <span className="truncate">{label}</span>
          </div>
        ))}
        <div className="mt-2 px-4 pb-1 pt-2 text-[7px] font-bold uppercase tracking-wider text-white/20">{t("mock.commsSectionLabel")}</div>
        {commsItems.map((l) => (
          <div key={l} className="flex items-center gap-2 px-4 py-2 text-[10px] font-semibold text-white/35">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-50" />
            <span className="truncate">{l}</span>
          </div>
        ))}
      </aside>
      <div className="flex flex-1 flex-col gap-3.5 p-5">
        <div
          className="rounded-xl border border-white/[0.08] p-5"
          style={{ background: "linear-gradient(135deg, hsl(197 75% 19%), hsl(var(--secondary)))" }}
        >
          <div className="mb-2 text-[8px] font-bold uppercase tracking-[0.2em] text-white/35">
            ✦ {isCoach ? t("mock.workspaceLabel.coach") : t("mock.workspaceLabel.executive")} {t("mock.workspaceSuffix")}
          </div>
          <div className="mb-1.5 font-display text-[20px] font-light leading-tight text-white">
            {t("mock.welcomeBack")} <em className="not-italic italic">{isCoach ? t("mock.firstName.coach") : t("mock.firstName.executive")}</em>
          </div>
          <div className="mb-3 text-[9px] text-white/40">
            {isCoach ? t("mock.subtext.coach") : t("mock.subtext.executive")}
          </div>
          <div className="flex gap-1.5">
            {quickActions.map((b) => (
              <span key={b} className="inline-flex items-center gap-1 rounded-full border border-white/[0.15] bg-white/10 px-3 py-1.5 text-[9px] font-semibold text-white/70">
                {b}
              </span>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {stats.map((s, i) => (
            <div key={s.l} className="rounded-lg border border-white/[0.06] bg-white/5 p-2.5">
              <div className="mb-1.5 text-[7px] font-semibold uppercase tracking-wider text-white/30">{s.l}</div>
              <div className={`text-[20px] font-extrabold leading-none ${statColors[i]}`}>{s.v}</div>
            </div>
          ))}
        </div>
        <div
          className="rounded-xl border border-white/[0.08] p-3.5"
          style={{ background: "linear-gradient(135deg, hsl(197 75% 19%), hsl(var(--secondary)))" }}
        >
          <div className="mb-2 flex items-center gap-1.5 text-[7px] font-bold uppercase tracking-wider text-white/30">
            <span className="h-1 w-1 rounded-full bg-success" />
            {t("mock.nextSessionLabel")}
          </div>
          <div className="mb-1.5 text-[14px] font-bold text-white">
            {isCoach ? t("mock.sessionTitle.coach") : t("mock.sessionTitle.executive")}
          </div>
          <div className="mb-2.5 text-[8px] text-white/40">
            {isCoach
              ? t("mock.sessionDetail.coach", { date: nextSessionDate })
              : t("mock.sessionDetail.executive", { date: nextSessionDate })}
          </div>
          <div className="flex gap-1.5">
            <span className="rounded-full bg-primary px-2.5 py-1 text-[8px] font-bold text-primary-foreground">{t("mock.enterMeeting")}</span>
            <span className="rounded-full border border-white/[0.15] bg-white/10 px-2.5 py-1 text-[8px] font-semibold text-white/60">{t("mock.details")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

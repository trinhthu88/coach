import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth, AppRole } from "@/context/AuthContext";
import {
  LayoutDashboard,
  Search,
  Users,
  Calendar,
  MessageSquare,
  LogOut,
  ChevronsLeft,
  ChevronsRight,
  IdCard,
  CalendarClock,
  ClipboardList,
  Compass,
  UsersRound,
  MessagesSquare,
  Layers,
  Bell,
  Activity,
  GraduationCap,
  BookOpen,
  Network,
  BarChart3,
  Menu,
  Building2,
  FileDown,
  HelpCircle,
  Handshake,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import clarivaLogoDark from "@/assets/clariva-logo-dark.png";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { OnboardingTour } from "@/components/onboarding/OnboardingTour";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useProgrammeModules, ProgrammeModuleType } from "@/hooks/useProgrammeModules";

interface NavItem {
  to: string;
  labelKey: string;
  icon: React.ElementType;
  roles: AppRole[];
  groupKey?: string;
  /** Stable hook for the onboarding pointer tour — see src/lib/onboarding/content.ts. */
  onboardingId?: string;
  /** Gate this item on the active programme's modules, in addition to role — see useProgrammeModules. */
  module?: ProgrammeModuleType;
  moduleDirection?: "give" | "receive";
}

const NAV: NavItem[] = [
  { to: "/dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard, roles: ["coach", "coachee"] },
  { to: "/mentoring", labelKey: "nav.mentoring", icon: Handshake, roles: ["coach", "coachee"], module: "mentoring" },
  { to: "/sponsor", labelKey: "nav.dashboard", icon: LayoutDashboard, roles: ["sponsor"], groupKey: "navGroups.sponsor", onboardingId: "nav-sponsor-dashboard" },
  { to: "/sponsor/cohorts", labelKey: "nav.cohorts", icon: Layers, roles: ["sponsor"], groupKey: "navGroups.sponsor" },
  { to: "/sponsor/report", labelKey: "nav.exportReport", icon: FileDown, roles: ["sponsor"], groupKey: "navGroups.sponsor" },

  // Coachee
  { to: "/coaches", labelKey: "nav.findCoaches", icon: Search, roles: ["coachee"], onboardingId: "nav-find-coaches", module: "coaching", moduleDirection: "receive" },
  { to: "/coachee/profile", labelKey: "nav.myProfile", icon: IdCard, roles: ["coachee"] },
  { to: "/coachee/journey", labelKey: "nav.myJourney", icon: Compass, roles: ["coachee"], module: "coaching", moduleDirection: "receive" },
  { to: "/coachee/peer-practice", labelKey: "nav.peerCoaching", icon: MessagesSquare, roles: ["coachee"], groupKey: "navGroups.myPracticeJourney", module: "peer_coaching" },
  { to: "/coachee/availability", labelKey: "nav.myAvailability", icon: CalendarClock, roles: ["coachee"], groupKey: "navGroups.myPracticeJourney" },

  // Coach — My Coaching Profile
  { to: "/coach/profile", labelKey: "nav.myCoachProfile", icon: IdCard, roles: ["coach"], groupKey: "navGroups.myCoachingProfile" },
  { to: "/coach/availability", labelKey: "nav.myAvailability", icon: CalendarClock, roles: ["coach"], groupKey: "navGroups.myCoachingProfile", onboardingId: "nav-my-availability" },
  { to: "/coach/clients", labelKey: "nav.myClients", icon: UsersRound, roles: ["coach"], groupKey: "navGroups.myCoachingProfile", module: "coaching", moduleDirection: "give" },

  // Coach — My Practice Journey
  { to: "/coach/peer-coaching", labelKey: "nav.peerCoaching", icon: MessagesSquare, roles: ["coach"], groupKey: "navGroups.myPracticeJourney", module: "peer_coaching" },
  { to: "/coach/find-coach", labelKey: "nav.findACoach", icon: Search, roles: ["coach"], groupKey: "navGroups.myPracticeJourney", module: "coaching", moduleDirection: "receive" },
  { to: "/coach/my-journey", labelKey: "nav.myJourney", icon: Compass, roles: ["coach"], groupKey: "navGroups.myPracticeJourney" },
  { to: "/coach/practice-journey", labelKey: "nav.practiceAnalytics", icon: Layers, roles: ["coach"], groupKey: "navGroups.myPracticeJourney" },

  // Communication (shared)
  { to: "/sessions", labelKey: "nav.sessions", icon: Calendar, roles: ["coach", "coachee"], groupKey: "navGroups.communication" },
  { to: "/messages", labelKey: "nav.messages", icon: MessageSquare, roles: ["coach", "coachee"], groupKey: "navGroups.communication" },

  // Admin — Overview
  { to: "/admin", labelKey: "nav.dashboard", icon: LayoutDashboard, roles: ["admin"], groupKey: "navGroups.overview" },
  { to: "/admin/alerts", labelKey: "nav.alerts", icon: Bell, roles: ["admin"], groupKey: "navGroups.overview" },
  { to: "/admin/activity", labelKey: "nav.activity", icon: Activity, roles: ["admin"], groupKey: "navGroups.overview" },

  // Admin — People
  { to: "/admin/coaches", labelKey: "nav.coaches", icon: Users, roles: ["admin"], groupKey: "navGroups.people" },
  { to: "/admin/coachees", labelKey: "nav.coachees", icon: GraduationCap, roles: ["admin"], groupKey: "navGroups.people" },
  { to: "/admin/organizations", labelKey: "nav.organizations", icon: Building2, roles: ["admin"], groupKey: "navGroups.people" },
  { to: "/admin/mentoring", labelKey: "nav.mentoring", icon: Handshake, roles: ["admin"], groupKey: "navGroups.people" },

  // Admin — Programmes
  { to: "/admin/programmes", labelKey: "nav.programmes", icon: BookOpen, roles: ["admin"], groupKey: "navGroups.programmes" },
  { to: "/admin/cohorts", labelKey: "nav.cohorts", icon: Network, roles: ["admin"], groupKey: "navGroups.programmes" },

  // Admin — Operations
  { to: "/admin/sessions", labelKey: "nav.sessions", icon: ClipboardList, roles: ["admin"], groupKey: "navGroups.operations" },
  { to: "/admin/analytics", labelKey: "nav.analytics", icon: BarChart3, roles: ["admin"], groupKey: "navGroups.operations" },
];

function SidebarNav({
  items,
  collapsed,
  unreadCount,
  onNavigate,
  onHowItWorks,
}: {
  items: NavItem[];
  collapsed: boolean;
  unreadCount: number;
  onNavigate?: () => void;
  onHowItWorks?: () => void;
}) {
  const { t } = useTranslation("common");
  const location = useLocation();
  let lastGroup: string | undefined = undefined;
  return (
    <nav className="relative flex flex-1 flex-col gap-[3px] overflow-y-auto px-3 pb-3">
      {items.map((item) => {
        const showBadge = item.to === "/messages" && unreadCount > 0;
        const showHeader = !collapsed && item.groupKey && item.groupKey !== lastGroup;
        if (item.groupKey) lastGroup = item.groupKey;
        const end = item.to === "/admin";
        const isCurrent = end ? location.pathname === item.to : location.pathname.startsWith(item.to);
        const label = t(item.labelKey);
        return (
          <div key={item.to}>
            {showHeader && (
              <p className="truncate px-3 pb-1.5 pt-4 text-micro font-bold uppercase tracking-[0.15em] text-secondary-foreground/40">
                {t(item.groupKey!)}
              </p>
            )}
            <NavLink
              to={item.to}
              end={end}
              title={collapsed ? label : undefined}
              onClick={onNavigate}
              aria-current={isCurrent ? "page" : undefined}
              data-onboarding={item.onboardingId}
              className={({ isActive }) =>
                cn(
                  "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm2 font-medium transition-all duration-200",
                  isActive
                    ? "bg-white/[0.09] text-white"
                    : "text-secondary-foreground/75 hover:translate-x-[3px] hover:bg-white/[0.06] hover:text-white"
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      "absolute left-0 top-1/2 w-[3px] rounded-r-[3px] bg-primary transition-all duration-300",
                      isActive ? "-mt-3 h-6" : "mt-0 h-0"
                    )}
                  />
                  <span className="relative shrink-0 opacity-90">
                    <item.icon className="h-5 w-5" />
                    {showBadge && collapsed && (
                      <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-accent px-1 text-micro font-bold text-accent-foreground">
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    )}
                  </span>
                  {!collapsed && <span className="truncate tracking-[-0.005em]">{label}</span>}
                  {showBadge && !collapsed && (
                    <span className="ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1.5 text-2xs font-bold text-accent-foreground">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          </div>
        );
      })}
      {onHowItWorks && (
        <button
          type="button"
          title={collapsed ? t("layout.howItWorks") : undefined}
          onClick={() => {
            onHowItWorks();
            onNavigate?.();
          }}
          className="group relative mt-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm2 font-medium text-secondary-foreground/75 transition-all duration-200 hover:translate-x-[3px] hover:bg-white/[0.06] hover:text-white"
        >
          <span className="relative shrink-0 opacity-90">
            <HelpCircle className="h-5 w-5" />
          </span>
          {!collapsed && <span className="truncate tracking-[-0.005em]">{t("layout.howItWorks")}</span>}
        </button>
      )}
    </nav>
  );
}

function SidebarFooter({
  role,
  collapsed,
  onSignOut,
}: {
  role: AppRole | null;
  collapsed: boolean;
  onSignOut: () => void;
}) {
  const { t } = useTranslation("common");
  return (
    <div className="relative border-t border-white/10 p-3.5">
      {!collapsed && (
        <p className="truncate px-2 pb-2 text-micro font-bold uppercase tracking-[0.15em] text-secondary-foreground/40">
          {t("layout.signedInAs")}
        </p>
      )}
      {!collapsed && (
        <p className="truncate px-2 pb-3 text-2xs font-bold uppercase tracking-[0.14em] text-primary">
          {role}
        </p>
      )}
      {!collapsed && (
        <div className="px-2 pb-3">
          <LanguageSwitcher />
        </div>
      )}
      <button
        onClick={onSignOut}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm2 font-medium text-secondary-foreground/70 transition-colors hover:bg-white/[0.07] hover:text-white",
          collapsed && "justify-center px-0"
        )}
      >
        <LogOut className="h-5 w-5 shrink-0" />
        {!collapsed && <span>{t("actions.signOut")}</span>}
      </button>
    </div>
  );
}

export default function AppLayout() {
  const { t } = useTranslation("common");
  const { user, profile, role, signOut } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();

  // Nav visibility mirrors ProtectedRoute's `module` gate (defense in depth per
  // RULES.md) — the route guard alone would still let the item render in the sidebar.
  const { hasModule, hasDirection } = useProgrammeModules();
  const items = NAV.filter((n) => {
    if (!role || !n.roles.includes(role)) return false;
    if (n.module && role !== "admin" && role !== "sponsor") {
      if (!hasModule(n.module)) return false;
      if (n.moduleDirection && !hasDirection(n.module, n.moduleDirection)) return false;
    }
    return true;
  });
  const showsOnboarding = role === "coach" || role === "coachee" || role === "sponsor";

  const [manualTourOpen, setManualTourOpen] = useState(false);
  // Bumped on every "How it works" click so a re-open always starts a fresh
  // OnboardingTour instance (back at the intro) instead of resuming wherever the
  // previous run left off.
  const [manualTourKey, setManualTourKey] = useState(0);
  const openManualTour = () => {
    setManualTourKey((k) => k + 1);
    setManualTourOpen(true);
  };

  // Decided once, the first time `profile` actually arrives — not at AppLayout's
  // own mount. On an interactive login (as opposed to a cold page load),
  // ProtectedRoute's isLoading gate has already resolved (it only guards the
  // initial getSession() check), so AppLayout can mount with profile/role still
  // null while AuthContext's deferred post-login fetch is in flight. A one-shot
  // `useState(() => …)` initializer would capture that transient null and lock
  // in `false` forever. Locking via a ref instead of re-deriving on every render
  // is still required after that: marking onboarding complete mid-tour updates
  // profile via refreshProfile(), and re-deriving against that live value would
  // unmount the tour out from under itself before its "done" stage ever renders.
  const [autoTourEligible, setAutoTourEligible] = useState(false);
  const autoTourDecidedRef = useRef(false);
  useEffect(() => {
    if (autoTourDecidedRef.current || !profile) return;
    autoTourDecidedRef.current = true;
    setAutoTourEligible(showsOnboarding && !profile.onboarding_completed_at);
  }, [profile, showsOnboarding]);

  const displayName = profile?.full_name || user?.email || t("layout.defaultUserName");
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  // Fetch unread message count for coach/coachee
  useEffect(() => {
    if (!user || !role || (role !== "coach" && role !== "coachee")) return;
    const filterCol = role === "coach" ? "coach_id" : "coachee_id";

    const refresh = async () => {
      const { data: ses } = await supabase
        .from("sessions")
        .select("id")
        .eq(filterCol, user.id)
        .in("status", ["confirmed", "completed"]);
      const sessionIds = (ses || []).map((s: { id: string }) => s.id);
      if (!sessionIds.length) {
        setUnreadCount(0);
        return;
      }
      const { count } = await supabase
        .from("session_messages")
        .select("id", { count: "exact", head: true })
        .in("session_id", sessionIds)
        .neq("sender_id", user.id)
        .is("read_at", null);
      setUnreadCount(count || 0);
    };

    refresh();

    const channel = supabase
      .channel(`unread-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "session_messages" },
        () => refresh()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, role]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth", { replace: true });
  };

  const activeItem = items.find((i) => location.pathname === i.to) ||
    [...items].sort((a, b) => b.to.length - a.to.length).find((i) => location.pathname.startsWith(i.to));
  const activeLabel = activeItem ? t(activeItem.labelKey) : t("nav.overview");

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* ══ RAIL (desktop) ══ */}
      <aside
        className={cn(
          "relative hidden h-full shrink-0 flex-col overflow-hidden bg-secondary text-secondary-foreground transition-[width] duration-300 lg:flex",
          collapsed ? "w-[76px]" : "w-[264px]"
        )}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 -top-28 h-80 w-80 rounded-full"
          style={{ background: "radial-gradient(circle, hsl(var(--primary) / 0.28), transparent 70%)" }}
        />

        <div className="relative flex items-start justify-between gap-2 px-5 pb-5 pt-6">
          <div className="min-w-0">
            <img
              src={clarivaLogoDark}
              alt="Clariva"
              className={cn("w-auto object-contain object-left", collapsed ? "h-7" : "h-[30px]")}
            />
            {!collapsed && (
              <p className="truncate mt-2 pl-0.5 text-micro font-bold uppercase tracking-[0.2em] text-primary">
                {t("layout.coachingOsTagline")}
              </p>
            )}
          </div>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="shrink-0 rounded-lg p-1.5 text-secondary-foreground/50 transition-colors hover:bg-white/10 hover:text-secondary-foreground"
            aria-label={t("layout.toggleSidebar")}
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </button>
        </div>

        <SidebarNav
          items={items}
          collapsed={collapsed}
          unreadCount={unreadCount}
          onHowItWorks={showsOnboarding ? openManualTour : undefined}
        />
        <SidebarFooter role={role} collapsed={collapsed} onSignOut={handleSignOut} />
      </aside>

      {/* ══ RAIL (mobile drawer) ══ */}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent
          side="left"
          className="flex w-[264px] max-w-[80vw] flex-col overflow-hidden border-0 bg-secondary p-0 text-secondary-foreground [&>button]:text-secondary-foreground/60 [&>button]:hover:text-secondary-foreground"
        >
          <SheetTitle className="sr-only">{t("layout.navigation")}</SheetTitle>
          <div className="relative flex items-start gap-2 px-5 pb-5 pt-6">
            <img src={clarivaLogoDark} alt="Clariva" className="h-[30px] w-auto object-contain object-left" />
          </div>
          <SidebarNav
            items={items}
            collapsed={false}
            unreadCount={unreadCount}
            onNavigate={() => setMobileNavOpen(false)}
            onHowItWorks={showsOnboarding ? openManualTour : undefined}
          />
          <SidebarFooter
            role={role}
            collapsed={false}
            onSignOut={() => {
              setMobileNavOpen(false);
              handleSignOut();
            }}
          />
        </SheetContent>
      </Sheet>

      {/* ══ MAIN ══ */}
      <main className="flex flex-1 flex-col overflow-hidden">
        <header className="sticky top-0 z-20 flex h-[68px] shrink-0 items-center gap-4 border-b border-border bg-background/80 px-4 backdrop-blur-xl sm:px-8">
          <button
            onClick={() => setMobileNavOpen(true)}
            className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[11px] border border-border bg-card text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary lg:hidden"
            aria-label={t("layout.openNavMenu")}
          >
            <Menu className="h-[18px] w-[18px]" />
          </button>

          <div className="hidden min-w-0 items-center gap-2 text-2xs tracking-[0.04em] sm:flex">
            <span className="text-micro font-bold uppercase tracking-[0.2em] text-primary">{role}</span>
            <span className="text-muted-foreground/40">/</span>
            <span className="truncate font-semibold text-foreground">{activeLabel}</span>
          </div>
          <span className="truncate font-semibold text-foreground sm:hidden">{activeLabel}</span>

          <div className="flex-1" />

          <NavLink
            to={role === "coach" ? "/coach/find-coach" : "/coaches"}
            className={cn(
              "hidden h-[34px] items-center gap-2 rounded-[11px] border border-border bg-card px-3.5 text-2xs font-semibold text-muted-foreground transition-all hover:-translate-y-px hover:border-primary/60 hover:text-primary sm:flex",
              (role === "admin" || role === "sponsor") && "invisible"
            )}
          >
            <Search className="h-[15px] w-[15px]" />
            {t("nav.findCoaches")}
          </NavLink>

          <div className="relative">
            <NavLink
              to="/messages"
              className="grid h-[34px] w-[34px] place-items-center rounded-[11px] border border-border bg-card text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary"
              aria-label={t("nav.messages")}
            >
              <Bell className="h-[17px] w-[17px]" />
            </NavLink>
            {unreadCount > 0 && (
              <>
                <span className="pointer-events-none absolute right-1.5 top-1.5 h-[7px] w-[7px] rounded-full bg-accent" />
                <span
                  className="pointer-events-none absolute right-1.5 top-1.5 h-[7px] w-[7px] rounded-full bg-accent"
                  style={{ animation: "pulsering 2.2s ease-out infinite" }}
                />
              </>
            )}
          </div>

          <div className="flex items-center gap-2.5 border-l border-border pl-3.5">
            <div className="hidden text-right leading-tight sm:block">
              <p className="text-sm2 font-semibold">{displayName}</p>
              <p className="text-micro font-bold uppercase tracking-[0.16em] text-muted-foreground">{role}</p>
            </div>
            <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-xl bg-primary-soft text-xs font-bold text-primary ring-[3px] ring-primary/[0.13]">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt={displayName} className="h-full w-full object-cover" />
              ) : (
                initials
              )}
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1320px] px-6 pb-20 pt-9 sm:px-8">
            <Outlet />
          </div>
        </div>
      </main>

      {showsOnboarding && autoTourEligible && (
        <OnboardingTour role={role as "coach" | "coachee" | "sponsor"} onSetMobileNavOpen={setMobileNavOpen} />
      )}
      {showsOnboarding && manualTourOpen && (
        <OnboardingTour
          key={manualTourKey}
          role={role as "coach" | "coachee" | "sponsor"}
          onClose={() => setManualTourOpen(false)}
          onSetMobileNavOpen={setMobileNavOpen}
        />
      )}
    </div>
  );
}


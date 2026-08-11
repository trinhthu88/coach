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
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import clarivaLogoDark from "@/assets/clariva-logo-dark.png";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

interface NavItem {
  to: string;
  label: string;
  icon: React.ElementType;
  roles: AppRole[];
  group?: string;
}

const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["coach", "coachee"] },

  // Coachee
  { to: "/coaches", label: "Find coaches", icon: Search, roles: ["coachee"] },
  { to: "/coachee/profile", label: "My profile", icon: IdCard, roles: ["coachee"] },
  { to: "/coachee/journey", label: "My journey", icon: Compass, roles: ["coachee"] },

  // Coach — My Coaching Profile
  { to: "/coach/profile", label: "My coach profile", icon: IdCard, roles: ["coach"], group: "My Coaching Profile" },
  { to: "/coach/availability", label: "My availability", icon: CalendarClock, roles: ["coach"], group: "My Coaching Profile" },
  { to: "/coach/clients", label: "My clients", icon: UsersRound, roles: ["coach"], group: "My Coaching Profile" },

  // Coach — My Practice Journey
  { to: "/coach/peer-coaching", label: "Peer coaching", icon: MessagesSquare, roles: ["coach"], group: "My Practice Journey" },
  { to: "/coach/find-coach", label: "Find a coach", icon: Search, roles: ["coach"], group: "My Practice Journey" },
  { to: "/coach/my-journey", label: "My journey", icon: Compass, roles: ["coach"], group: "My Practice Journey" },
  { to: "/coach/practice-journey", label: "Practice analytics", icon: Layers, roles: ["coach"], group: "My Practice Journey" },

  // Communication (shared)
  { to: "/sessions", label: "Sessions", icon: Calendar, roles: ["coach", "coachee"], group: "Communication" },
  { to: "/messages", label: "Messages", icon: MessageSquare, roles: ["coach", "coachee"], group: "Communication" },

  // Admin — Overview
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, roles: ["admin"], group: "Overview" },
  { to: "/admin/alerts", label: "Alerts", icon: Bell, roles: ["admin"], group: "Overview" },
  { to: "/admin/activity", label: "Activity", icon: Activity, roles: ["admin"], group: "Overview" },

  // Admin — People
  { to: "/admin/coaches", label: "Coaches", icon: Users, roles: ["admin"], group: "People" },
  { to: "/admin/coachees", label: "Coachees", icon: GraduationCap, roles: ["admin"], group: "People" },

  // Admin — Programmes
  { to: "/admin/programmes", label: "Programmes", icon: BookOpen, roles: ["admin"], group: "Programmes" },
  { to: "/admin/cohorts", label: "Cohorts", icon: Network, roles: ["admin"], group: "Programmes" },

  // Admin — Operations
  { to: "/admin/sessions", label: "Sessions", icon: ClipboardList, roles: ["admin"], group: "Operations" },
  { to: "/admin/analytics", label: "Analytics", icon: BarChart3, roles: ["admin"], group: "Operations" },
];

function SidebarNav({
  items,
  collapsed,
  unreadCount,
  onNavigate,
}: {
  items: NavItem[];
  collapsed: boolean;
  unreadCount: number;
  onNavigate?: () => void;
}) {
  const location = useLocation();
  let lastGroup: string | undefined = undefined;
  return (
    <nav className="relative flex flex-1 flex-col gap-[3px] overflow-y-auto px-3 pb-3">
      {items.map((item) => {
        const showBadge = item.to === "/messages" && unreadCount > 0;
        const showHeader = !collapsed && item.group && item.group !== lastGroup;
        if (item.group) lastGroup = item.group;
        const end = item.to === "/admin";
        const isCurrent = end ? location.pathname === item.to : location.pathname.startsWith(item.to);
        return (
          <div key={item.to}>
            {showHeader && (
              <p className="px-3 pb-1.5 pt-4 text-[8.5px] font-bold uppercase tracking-[0.2em] text-secondary-foreground/40">
                {item.group}
              </p>
            )}
            <NavLink
              to={item.to}
              end={end}
              title={collapsed ? item.label : undefined}
              onClick={onNavigate}
              aria-current={isCurrent ? "page" : undefined}
              className={({ isActive }) =>
                cn(
                  "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all duration-200",
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
                      <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-accent-foreground">
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    )}
                  </span>
                  {!collapsed && <span className="truncate tracking-[-0.005em]">{item.label}</span>}
                  {showBadge && !collapsed && (
                    <span className="ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1.5 text-[10px] font-bold text-accent-foreground">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          </div>
        );
      })}
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
  return (
    <div className="relative border-t border-white/10 p-3.5">
      {!collapsed && (
        <p className="px-2 pb-2 text-[8.5px] font-bold uppercase tracking-[0.2em] text-secondary-foreground/40">
          Signed in as
        </p>
      )}
      {!collapsed && (
        <p className="truncate px-2 pb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-primary">
          {role}
        </p>
      )}
      <button
        onClick={onSignOut}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium text-secondary-foreground/70 transition-colors hover:bg-white/[0.07] hover:text-white",
          collapsed && "justify-center px-0"
        )}
      >
        <LogOut className="h-5 w-5 shrink-0" />
        {!collapsed && <span>Sign out</span>}
      </button>
    </div>
  );
}

export default function AppLayout() {
  const { user, profile, role, signOut } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();

  const items = NAV.filter((n) => role && n.roles.includes(role));
  const displayName = profile?.full_name || user?.email || "User";
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
              <p className="mt-2 pl-0.5 text-[8.5px] font-bold uppercase tracking-[0.26em] text-primary">
                Coaching OS
              </p>
            )}
          </div>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="shrink-0 rounded-lg p-1.5 text-secondary-foreground/50 transition-colors hover:bg-white/10 hover:text-secondary-foreground"
            aria-label="Toggle sidebar"
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </button>
        </div>

        <SidebarNav items={items} collapsed={collapsed} unreadCount={unreadCount} />
        <SidebarFooter role={role} collapsed={collapsed} onSignOut={handleSignOut} />
      </aside>

      {/* ══ RAIL (mobile drawer) ══ */}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent
          side="left"
          className="flex w-[264px] max-w-[80vw] flex-col overflow-hidden border-0 bg-secondary p-0 text-secondary-foreground [&>button]:text-secondary-foreground/60 [&>button]:hover:text-secondary-foreground"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="relative flex items-start gap-2 px-5 pb-5 pt-6">
            <img src={clarivaLogoDark} alt="Clariva" className="h-[30px] w-auto object-contain object-left" />
          </div>
          <SidebarNav
            items={items}
            collapsed={false}
            unreadCount={unreadCount}
            onNavigate={() => setMobileNavOpen(false)}
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
            aria-label="Open navigation menu"
          >
            <Menu className="h-[18px] w-[18px]" />
          </button>

          <div className="hidden min-w-0 items-center gap-2 text-[11px] tracking-[0.04em] sm:flex">
            <span className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-primary">{role}</span>
            <span className="text-muted-foreground/40">/</span>
            <span className="truncate font-semibold text-foreground">{activeItem?.label ?? "Overview"}</span>
          </div>
          <span className="truncate font-semibold text-foreground sm:hidden">{activeItem?.label ?? "Overview"}</span>

          <div className="flex-1" />

          <NavLink
            to={role === "coach" ? "/coach/find-coach" : "/coaches"}
            className={cn(
              "hidden h-[34px] items-center gap-2 rounded-[11px] border border-border bg-card px-3.5 text-[11.5px] font-semibold text-muted-foreground transition-all hover:-translate-y-px hover:border-primary/60 hover:text-primary sm:flex",
              role === "admin" && "invisible"
            )}
          >
            <Search className="h-[15px] w-[15px]" />
            Find coaches
          </NavLink>

          <div className="relative">
            <NavLink
              to="/messages"
              className="grid h-[34px] w-[34px] place-items-center rounded-[11px] border border-border bg-card text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary"
              aria-label="Messages"
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
              <p className="text-[12.5px] font-semibold">{displayName}</p>
              <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{role}</p>
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
    </div>
  );
}


import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth, AppRole } from "@/context/AuthContext";
import {
  LayoutDashboard,
  Search,
  Users,
  UserCheck,
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
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

interface NavItem {
  to: string;
  label: string;
  icon: React.ElementType;
  roles: AppRole[];
  group?: string;
}

const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["admin", "coach", "coachee"] },

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

  // Admin
  { to: "/admin/registrations", label: "Registrations", icon: UserCheck, roles: ["admin"] },
  { to: "/admin/coaches", label: "Manage coaches", icon: Users, roles: ["admin"] },
  { to: "/admin/sessions", label: "All sessions", icon: ClipboardList, roles: ["admin"] },
  { to: "/admin/session-limits", label: "Session limits", icon: Layers, roles: ["admin"] },
];

export default function AppLayout() {
  const { user, profile, role, signOut } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const navigate = useNavigate();

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
      const sessionIds = (ses || []).map((s: any) => s.id);
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

  return (
    <div className="flex h-screen bg-gradient-subtle text-foreground">
      <aside
        className={cn(
          "flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-300",
          collapsed ? "w-[72px]" : "w-[260px]"
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-4">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary font-display text-lg shadow-glow">
              <span className="text-primary-glow">C</span>
            </div>
            {!collapsed && (
              <span className="whitespace-nowrap font-display text-xl tracking-tight text-secondary">
                Clar<em className="not-italic text-primary">i</em>va
              </span>
            )}
          </div>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            aria-label="Toggle sidebar"
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {(() => {
            let lastGroup: string | undefined = undefined;
            return items.map((item) => {
              const showBadge = item.to === "/messages" && unreadCount > 0;
              const showHeader = !collapsed && item.group && item.group !== lastGroup;
              if (item.group) lastGroup = item.group;
              return (
                <div key={item.to}>
                  {showHeader && (
                    <p className="mt-3 px-3 pb-1 text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground/70">
                      {item.group}
                    </p>
                  )}
                  <NavLink
                    to={item.to}
                    className={({ isActive }) =>
                      cn(
                        "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                        isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                      )
                    }
                  >
                    <span className="relative shrink-0">
                      <item.icon className="h-5 w-5" />
                      {showBadge && collapsed && (
                        <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-destructive-foreground">
                          {unreadCount > 9 ? "9+" : unreadCount}
                        </span>
                      )}
                    </span>
                    {!collapsed && <span className="truncate">{item.label}</span>}
                    {showBadge && !collapsed && (
                      <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">
                        {unreadCount > 99 ? "99+" : unreadCount}
                      </span>
                    )}
                  </NavLink>
                </div>
              );
            });
          })()}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <button
            onClick={handleSignOut}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            )}
          >
            <LogOut className="h-5 w-5 shrink-0" />
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>

      <main className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-card/60 px-8 backdrop-blur">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-success" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              System operational
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-semibold leading-tight">{displayName}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-primary">{role}</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-primary-soft text-xs font-bold text-primary ring-2 ring-primary/10">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt={displayName} className="h-full w-full object-cover" />
              ) : (
                initials
              )}
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-6 py-8 sm:px-8">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}

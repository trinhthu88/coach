import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Database } from "@/integrations/supabase/types";

export type AppRole = Database["public"]["Enums"]["app_role"];

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  role: AppRole | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  /**
   * Monotonically-increasing request generation counter.
   * Incremented whenever a new load is started (including on auth transitions).
   * Each fetch captures `seq` at call time; it only applies its result when
   * `seq === loadSeqRef.current`, ensuring stale in-flight loads from a prior
   * user or session can never overwrite the current user's profile/role.
   */
  const loadSeqRef = useRef(0);

  /**
   * Tracks the user id we last established a real transition for. Supabase's
   * onAuthStateChange fires redundantly on top of getSession() — an INITIAL_SESSION
   * event on mount when a session already exists in storage, and again on token
   * refresh — for the SAME user, not a real account change. Comparing against this
   * ref lets the listener below tell "the account actually changed" (wipe + reload)
   * apart from "a duplicate event for the user we already have" (no-op), so a
   * same-user event arriving after isLoading has already resolved can't flash
   * role/profile to null and bounce a role-gated route (ProtectedRoute) for a user
   * who was never actually signed out.
   */
  const currentUserIdRef = useRef<string | null>(null);

  const loadProfileAndRole = async (userId: string) => {
    const seq = ++loadSeqRef.current;

    const [{ data: profileData }, { data: roleData }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);

    // Discard if a newer request has superseded this one
    if (seq !== loadSeqRef.current) return;

    setProfile(profileData);
    if (roleData && roleData.length > 0) {
      const priority: Record<AppRole, number> = { admin: 1, coach: 2, coachee: 3, sponsor: 4 };
      const top = [...roleData].sort(
        (a, b) => priority[a.role] - priority[b.role]
      )[0];
      setRole(top.role);
    } else {
      setRole(null);
    }
  };

  useEffect(() => {
    let mounted = true;
    let deferTimer: ReturnType<typeof setTimeout> | null = null;

    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return;
      const newUserId = newSession?.user?.id ?? null;

      // Same user as last established — not a real transition (INITIAL_SESSION on
      // mount, TOKEN_REFRESHED, etc). Update session/user only; skip the wipe+reload.
      if (newUserId === currentUserIdRef.current) {
        setSession(newSession);
        setUser(newSession?.user ?? null);
        return;
      }
      currentUserIdRef.current = newUserId;

      setSession(newSession);
      setUser(newSession?.user ?? null);

      // Synchronously invalidate any in-flight request and wipe stale data so
      // the prior user's profile/role cannot leak into the new session's render.
      ++loadSeqRef.current;
      setProfile(null);
      setRole(null);

      if (newSession?.user) {
        // Defer Supabase calls to avoid deadlock inside the auth callback
        if (deferTimer) clearTimeout(deferTimer);
        deferTimer = setTimeout(() => {
          if (mounted) loadProfileAndRole(newSession.user.id);
        }, 0);
      }
    });

    // THEN check existing session
    supabase.auth.getSession().then(({ data: { session: existing } }) => {
      if (!mounted) return;
      currentUserIdRef.current = existing?.user?.id ?? null;
      setSession(existing);
      setUser(existing?.user ?? null);
      if (existing?.user) {
        loadProfileAndRole(existing.user.id).finally(() => {
          if (mounted) setIsLoading(false);
        });
      } else {
        setIsLoading(false);
      }
    });

    return () => {
      mounted = false;
      if (deferTimer) clearTimeout(deferTimer);
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const refreshProfile = async () => {
    if (user) await loadProfileAndRole(user.id);
  };

  return (
    <AuthContext.Provider value={{ user, session, profile, role, isLoading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

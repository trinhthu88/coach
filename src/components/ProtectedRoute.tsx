import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth, AppRole } from "@/context/AuthContext";
import { useModuleAccess } from "@/hooks/useModuleAccess";
import { Loader2 } from "lucide-react";
import clarivaLogo from "@/assets/clariva-logo.png";

interface Props {
  children: ReactNode;
  role?: AppRole;
  /** Use when more than one role should pass (e.g. mentoring is coach OR coachee). */
  roles?: AppRole[];
  /** Gate on a user_module_access module (e.g. "mentoring") in addition to role. */
  module?: string;
}

export function ProtectedRoute({ children, role: requiredRole, roles: requiredRoles, module }: Props) {
  const { user, session, role, profile, isLoading, roleError, signOut, refreshProfile } = useAuth();
  const location = useLocation();
  const { t } = useTranslation("common");
  // Always called (not after an early return) so hook order stays stable across renders.
  const { enabled: moduleEnabled, loading: moduleLoading } = useModuleAccess(module ?? "");

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-muted-foreground">
          <img src={clarivaLogo} alt="" className="h-7 w-auto object-contain opacity-90" />
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <p className="text-xs font-semibold uppercase tracking-widest">{t("protectedRoute.loading")}</p>
        </div>
      </div>
    );
  }

  // The session is the source of truth for Supabase authorization. Do not
  // leave protected screens mounted from a stale user/profile snapshot after
  // the access token has disappeared or the session has been revoked.
  if (!user || !session || session.user.id !== user.id) {
    return <Navigate to="/auth" replace state={{ from: location }} />;
  }

  // First-login forced password change
  if (profile?.must_change_password && location.pathname !== "/set-new-password") {
    return <Navigate to="/set-new-password" replace />;
  }

  // The lookup itself failed: say so and offer a retry. This is not "no role".
  if (!role && roleError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div role="alert" data-testid="role-load-error" className="max-w-md text-center">
          <img src={clarivaLogo} alt="" className="mx-auto h-7 w-auto object-contain opacity-90" />
          <h1 className="mt-6 text-lg font-semibold">{t("protectedRoute.loadErrorTitle")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("protectedRoute.loadErrorBody")}</p>
          <div className="mt-6 flex justify-center gap-2">
            <button
              type="button"
              onClick={() => void refreshProfile()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              {t("protectedRoute.retry")}
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              {t("protectedRoute.signOut")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // No role in user_roles is a provisioning error, not a coachee. Say so rather
  // than guessing a workspace (or spinning forever on /dashboard).
  if (!role) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div role="alert" className="max-w-md text-center">
          <img src={clarivaLogo} alt="" className="mx-auto h-7 w-auto object-contain opacity-90" />
          <h1 className="mt-6 text-lg font-semibold">{t("protectedRoute.noRoleTitle")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("protectedRoute.noRoleBody")}</p>
          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-6 rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            {t("protectedRoute.signOut")}
          </button>
        </div>
      </div>
    );
  }

  // This is UX only — every table must have a matching RLS policy. Adding a
  // route here does not protect data; it only hides UI.
  //
  // Pending / suspended / rejected users (admin always passes)
  // 'reach_limit' only blocks new bookings (enforced in BookSession.tsx) — it should
  // not lock the user out of existing clients, messages, or session history.
  const status = profile?.status;
  if (
    role !== "admin" &&
    status &&
    status !== "active" &&
    status !== "reach_limit" &&
    location.pathname !== "/pending"
  ) {
    return <Navigate to="/pending" replace />;
  }

  if (requiredRole && role !== requiredRole && role !== "admin") {
    return <Navigate to="/dashboard" replace />;
  }

  if (requiredRoles && !(role && requiredRoles.includes(role)) && role !== "admin") {
    return <Navigate to="/dashboard" replace />;
  }

  // Module gate mirrors the role gate above but checks user_module_access via
  // has_module_access() instead of user_roles — admin always bypasses, same as role.
  if (module && role !== "admin" && !moduleLoading && !moduleEnabled) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

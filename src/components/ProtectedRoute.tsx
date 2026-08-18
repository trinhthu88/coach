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
  const { user, role, profile, isLoading } = useAuth();
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

  if (!user) {
    return <Navigate to="/auth" replace state={{ from: location }} />;
  }

  // First-login forced password change
  if (profile?.must_change_password && location.pathname !== "/set-new-password") {
    return <Navigate to="/set-new-password" replace />;
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

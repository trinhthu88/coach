import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth, AppRole } from "@/context/AuthContext";
import { Loader2 } from "lucide-react";
import clarivaLogo from "@/assets/clariva-logo.png";

interface Props {
  children: ReactNode;
  role?: AppRole;
}

export function ProtectedRoute({ children, role: requiredRole }: Props) {
  const { user, role, profile, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-muted-foreground">
          <img src={clarivaLogo} alt="" className="h-7 w-auto object-contain opacity-90" />
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <p className="text-xs font-semibold uppercase tracking-widest">Loading platform…</p>
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

  return <>{children}</>;
}

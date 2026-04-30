import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth, AppRole } from "@/context/AuthContext";
import { Loader2 } from "lucide-react";

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
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
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

  // Pending / suspended / rejected users (admin always passes)
  const status = profile?.status;
  if (role !== "admin" && status && status !== "active" && location.pathname !== "/pending") {
    return <Navigate to="/pending" replace />;
  }

  if (requiredRole && role !== requiredRole && role !== "admin") {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { Clock, LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function PendingApproval() {
  const { signOut, profile } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-subtle p-6">
      <Card className="max-w-md p-10 text-center">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
          <Clock className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Awaiting approval</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Hi {profile?.full_name ?? "there"}, your account is pending admin review. You'll get
          access as soon as an administrator approves your registration.
        </p>
        <Button
          variant="outline"
          className="mt-6"
          onClick={async () => {
            await signOut();
            navigate("/auth", { replace: true });
          }}
        >
          <LogOut className="h-4 w-4" /> Sign out
        </Button>
      </Card>
    </div>
  );
}

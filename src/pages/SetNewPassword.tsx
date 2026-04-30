import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { Loader2, ShieldCheck } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

export default function SetNewPassword() {
  const navigate = useNavigate();
  const { user, refreshProfile, signOut } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    if (password.length < 8) {
      toast({ title: "Password too short", description: "Use at least 8 characters.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      if (user) {
        await supabase.from("profiles").update({ must_change_password: false }).eq("id", user.id);
      }
      await refreshProfile();
      toast({ title: "Welcome aboard", description: "Your password has been set." });
      navigate("/dashboard", { replace: true });
    } catch (err: any) {
      toast({ title: "Could not set password", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-subtle p-6">
      <Card className="w-full max-w-md p-8 sm:p-10">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <h1 className="font-display text-3xl font-light tracking-tight text-secondary">
          Set your <em className="text-primary">password</em>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          For security, please replace the temporary password we provided with one of your own.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="password">New password</Label>
            <Input id="password" type="password" required minLength={8} value={password}
              onChange={(e) => setPassword(e.target.value)} className="h-11" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">Confirm password</Label>
            <Input id="confirm" type="password" required minLength={8} value={confirm}
              onChange={(e) => setConfirm(e.target.value)} className="h-11" />
          </div>
          <Button type="submit" disabled={loading} className="h-11 w-full text-base font-semibold">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save & continue"}
          </Button>
        </form>

        <button
          onClick={async () => { await signOut(); navigate("/auth", { replace: true }); }}
          className="mt-6 w-full text-center text-xs text-muted-foreground hover:text-foreground"
        >
          Sign out
        </button>
      </Card>
    </div>
  );
}

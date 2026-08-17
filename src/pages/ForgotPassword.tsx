import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { ArrowRight, Loader2, KeyRound } from "lucide-react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export default function ForgotPassword() {
  const { t } = useTranslation("auth");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setSent(true);
      toast({
        title: t("forgotPassword.toast.success.title"),
        description: t("forgotPassword.toast.success.description"),
      });
    } catch (err) {
      toast({
        title: t("forgotPassword.toast.error.title"),
        description: err instanceof Error ? err.message : t("toast.error.genericDescription"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-gradient-subtle p-6">
      <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
        <LanguageSwitcher />
      </div>
      <Card className="w-full max-w-md p-8 sm:p-10">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
          <KeyRound className="h-5 w-5" />
        </div>
        <h1 className="font-display text-3xl font-light tracking-tight text-secondary">
          {t("forgotPassword.titleLead")} <em className="text-primary">{t("forgotPassword.titleEmphasis")}</em>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("forgotPassword.subtitle")}
        </p>

        {sent ? (
          <div className="mt-8 rounded-xl border border-success/30 bg-success/5 p-5 text-sm text-foreground">
            <p className="font-semibold">{t("forgotPassword.sent.title")}</p>
            <p className="mt-1 text-muted-foreground">
              {t("forgotPassword.sent.bodyPrefix")} <strong>{email}</strong>{t("forgotPassword.sent.bodySuffix")}
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email">{t("fields.emailLabel")}</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("fields.emailPlaceholder")}
                className="h-11"
              />
            </div>
            <Button type="submit" disabled={loading} className="h-11 w-full text-base font-semibold">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                <>{t("forgotPassword.submit")} <ArrowRight className="ml-1 h-4 w-4" /></>
              )}
            </Button>
          </form>
        )}

        <p className="mt-8 border-t pt-6 text-center text-sm text-muted-foreground">
          <Link to="/auth" className="hover:text-foreground">{t("forgotPassword.backToSignIn")}</Link>
        </p>
      </Card>
    </div>
  );
}

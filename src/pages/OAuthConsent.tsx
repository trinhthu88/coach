import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, ShieldCheck, XCircle, CheckCircle } from "lucide-react";
import clarivaLogo from "@/assets/clariva-logo-dark.png";

type AuthorizationDetails = {
  client?: { name?: string; redirect_uris?: string[] } | null;
  redirect_url?: string | null;
  redirect_to?: string | null;
  scope?: string | null;
};

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState<{ email?: string; full_name?: string } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) return setError("Missing authorization_id");
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/auth?next=" + encodeURIComponent(next);
        return;
      }
      setAccount({ email: sess.session.user.email ?? undefined, full_name: sess.session.user.user_metadata?.full_name });
      const { data, error } = await (supabase.auth as any).oauth.getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (error) return setError(error.message);
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) { window.location.href = immediate; return; }
      setDetails(data);
    })();
    return () => { active = false; };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    const fn = approve ? (supabase.auth as any).oauth.approveAuthorization : (supabase.auth as any).oauth.denyAuthorization;
    const { data, error } = await fn(authorizationId);
    if (error) { setBusy(false); return setError(error.message); }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) { setBusy(false); return setError("No redirect returned by the authorization server."); }
    window.location.href = target;
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-subtle p-6">
        <Card className="w-full max-w-md p-8 text-center">
          <XCircle className="mx-auto h-10 w-10 text-destructive" />
          <h1 className="mt-4 font-display text-2xl font-light text-secondary">Connection request failed</h1>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <Button className="mt-6 w-full" onClick={() => navigate("/")}>Back to Clariva</Button>
        </Card>
      </div>
    );
  }

  if (!details) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-subtle p-6">
        <Card className="w-full max-w-md p-8 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
          <p className="mt-4 text-sm text-muted-foreground">Loading connection details…</p>
        </Card>
      </div>
    );
  }

  const clientName = details.client?.name ?? "an external app";
  const scopes = details.scope ? details.scope.split(" ").filter(Boolean) : ["openid", "profile", "email"];

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-subtle p-6">
      <Card className="w-full max-w-md p-8">
        <div className="mb-6 flex items-center justify-center">
          <img src={clarivaLogo} alt="Clariva" className="h-10 w-auto object-contain" />
        </div>
        <h1 className="text-center font-display text-2xl font-light text-secondary">
          Connect <em className="text-primary">{clientName}</em> to Clariva
        </h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          This lets {clientName} call Clariva's enabled tools while you are signed in.
        </p>

        <div className="mt-6 space-y-4 rounded-xl bg-muted/50 p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-semibold text-secondary">Signed in as</p>
              <p className="text-sm text-muted-foreground">{account?.full_name ?? account?.email ?? "Unknown"}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <CheckCircle className="mt-0.5 h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-semibold text-secondary">Access summary</p>
              <ul className="mt-1 list-disc pl-4 text-sm text-muted-foreground">
                {scopes.map((s) => (
                  <li key={s}>
                    {s === "openid" && "Verify your identity"}
                    {s === "profile" && "Share your basic profile"}
                    {s === "email" && "Share your email address"}
                    {!["openid", "profile", "email"].includes(s) && `Permission: ${s}`}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          This does not bypass Clariva's permissions or backend policies. You can revoke access from your account settings at any time.
        </p>

        <div className="mt-6 flex gap-3">
          <Button variant="outline" className="flex-1" disabled={busy} onClick={() => decide(false)}>
            Cancel
          </Button>
          <Button className="flex-1" disabled={busy} onClick={() => decide(true)}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Approve"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

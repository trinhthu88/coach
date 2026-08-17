import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Check, X, Loader2, Inbox, Copy, Eye, RotateCcw } from "lucide-react";
import { format } from "date-fns";
import { Pill } from "@/pages/admin/_shared";

interface AccessRequest {
  id: string;
  full_name: string;
  email: string;
  role: "executive" | "coach";
  job_title: string | null;
  company: string | null;
  industry: string | null;
  linkedin_url: string | null;
  credential: string | null;
  motivation: string | null;
  status: string;
  created_at: string;
}

interface Props {
  /** Filter requests to show. "coach" or "coachee" (executive). */
  variant: "coach" | "coachee";
  onApproved?: () => void;
}

export default function PendingAccessRequests({ variant, onApproved }: Props) {
  const { t } = useTranslation("common");
  const [rows, setRows] = useState<AccessRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<AccessRequest | null>(null);
  const [approved, setApproved] = useState<{
    email: string; full_name: string; request_id: string; email_sent: boolean;
  } | null>(null);

  const targetRole = variant === "coach" ? "coach" : "executive";

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("access_requests")
      .select("*")
      .eq("status", "pending")
      .eq("role", targetRole)
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setRows((data ?? []) as AccessRequest[]);
    setLoading(false);
  }, [targetRole]);

  useEffect(() => { load(); }, [load]);

  const approve = async (req: AccessRequest) => {
    setBusyId(req.id);
    try {
      const { data, error } = await supabase.functions.invoke("approve-access-request", {
        body: { request_id: req.id },
      });
      if (error) throw error;
      const result = data as { error?: string; email?: string; email_sent?: boolean };
      if (result?.error) throw new Error(result.error);
      setApproved({
        email: result.email ?? req.email,
        full_name: req.full_name,
        request_id: req.id,
        email_sent: !!result.email_sent,
      });
      toast.success(result.email_sent ? t("pendingAccessRequests.toast.accountCreatedEmailed") : t("pendingAccessRequests.toast.accountCreated"));
      await load();
      onApproved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("pendingAccessRequests.toast.approvalFailed"));
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (req: AccessRequest) => {
    if (!confirm(t("pendingAccessRequests.confirmReject", { name: req.full_name }))) return;
    setBusyId(req.id);
    try {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("access_requests")
        .update({
          status: "rejected",
          reviewed_at: new Date().toISOString(),
          reviewed_by: u.user?.id ?? null,
        })
        .eq("id", req.id);
      if (error) throw error;
      toast.success(t("pendingAccessRequests.toast.requestRejected"));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("pendingAccessRequests.toast.rejectFailed"));
    } finally {
      setBusyId(null);
    }
  };

  const resendMagicLink = async () => {
    if (!approved) return;
    const resendKey = `resend-${approved.request_id}`;
    setBusyId(resendKey);
    try {
      const { data, error } = await supabase.functions.invoke("approve-access-request", {
        body: { request_id: approved.request_id, resend_magic_link: true },
      });
      if (error) throw error;
      const result = data as { error?: string; email?: string; email_sent?: boolean };
      if (result?.error) throw new Error(result.error);
      setApproved((current) => current ? { ...current, email_sent: !!result.email_sent } : current);
      toast.success(result.email_sent ? t("pendingAccessRequests.toast.loginLinkResent") : t("pendingAccessRequests.toast.approvedEmailFailed"));
      onApproved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("pendingAccessRequests.toast.resendFailed"));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <Card className="mb-4 flex items-center justify-center p-6">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
      </Card>
    );
  }

  return (
    <>
      {rows.length > 0 && (
        <Card className="mb-4 overflow-hidden border-warning/40">
          <div className="flex items-center justify-between gap-2 border-b bg-warning/10 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <Inbox className="h-4 w-4 text-warning" />
              <p className="text-2xs font-bold uppercase tracking-widest text-warning">
                {t("pendingAccessRequests.awaiting", { count: rows.length })}
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-micro uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 text-left font-semibold">{t("pendingAccessRequests.tableHeaders.name")}</th>
                  <th className="px-3 py-2.5 text-left font-semibold">{t("pendingAccessRequests.tableHeaders.email")}</th>
                  <th className="px-3 py-2.5 text-left font-semibold">{variant === "coach" ? t("pendingAccessRequests.tableHeaders.credential") : t("pendingAccessRequests.tableHeaders.jobCompany")}</th>
                  <th className="px-3 py-2.5 text-left font-semibold">{t("pendingAccessRequests.tableHeaders.industry")}</th>
                  <th className="px-3 py-2.5 text-left font-semibold">{t("pendingAccessRequests.tableHeaders.submitted")}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{t("pendingAccessRequests.tableHeaders.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map(r => (
                  <tr key={r.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2.5 font-medium">{r.full_name}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{r.email}</td>
                    <td className="px-3 py-2.5 text-2xs">
                      {variant === "coach"
                        ? (r.credential ?? "—")
                        : `${r.job_title ?? "—"}${r.company ? ` · ${r.company}` : ""}`}
                    </td>
                    <td className="px-3 py-2.5 text-2xs">{r.industry ?? "—"}</td>
                    <td className="px-3 py-2.5 text-2xs text-muted-foreground">
                      {format(new Date(r.created_at), "MMM d, yyyy")}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="inline-flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setViewing(r)} title={t("pendingAccessRequests.viewDetails")}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm" variant="outline"
                          onClick={() => reject(r)}
                          disabled={busyId === r.id}
                        >
                          <X className="h-3.5 w-3.5" /> {t("pendingAccessRequests.reject")}
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => approve(r)}
                          disabled={busyId === r.id}
                        >
                          {busyId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          {t("pendingAccessRequests.approve")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Details dialog */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{viewing?.full_name}</DialogTitle>
            <DialogDescription>{viewing?.email}</DialogDescription>
          </DialogHeader>
          {viewing && (
            <div className="space-y-3 text-sm">
              <Field label={t("pendingAccessRequests.detailsDialog.role")}><Pill tone="primary">{viewing.role}</Pill></Field>
              {viewing.job_title && <Field label={t("pendingAccessRequests.detailsDialog.jobTitle")}>{viewing.job_title}</Field>}
              {viewing.company && <Field label={t("pendingAccessRequests.detailsDialog.company")}>{viewing.company}</Field>}
              {viewing.industry && <Field label={t("pendingAccessRequests.detailsDialog.industry")}>{viewing.industry}</Field>}
              {viewing.credential && <Field label={t("pendingAccessRequests.detailsDialog.credential")}>{viewing.credential}</Field>}
              {viewing.linkedin_url && (
                <Field label={t("pendingAccessRequests.detailsDialog.linkedin")}>
                  <a href={viewing.linkedin_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                    {viewing.linkedin_url}
                  </a>
                </Field>
              )}
              {viewing.motivation && (
                <div>
                  <p className="text-micro font-bold uppercase tracking-widest text-muted-foreground">{t("pendingAccessRequests.detailsDialog.motivation")}</p>
                  <p className="mt-1 whitespace-pre-wrap">{viewing.motivation}</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewing(null)}>{t("pendingAccessRequests.detailsDialog.close")}</Button>
            {viewing && (
              <Button onClick={() => { const r = viewing; setViewing(null); approve(r); }}>
                <Check className="h-4 w-4" /> {t("pendingAccessRequests.approve")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approval confirmation dialog */}
      <Dialog open={!!approved} onOpenChange={(o) => !o && setApproved(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("pendingAccessRequests.approvedDialog.title", { name: approved?.full_name })}</DialogTitle>
            <DialogDescription>
              {approved?.email_sent
                ? t("pendingAccessRequests.approvedDialog.emailedDescription")
                : t("pendingAccessRequests.approvedDialog.notEmailedDescription")}
            </DialogDescription>
          </DialogHeader>
          {approved && (
            <div className="space-y-3 text-sm">
              <CopyRow label={t("pendingAccessRequests.approvedDialog.emailLabel")} value={approved.email} copiedLabel={t("pendingAccessRequests.toast.copied")} />
              {!approved.email_sent && (
                <p className="rounded-lg bg-warning/10 p-3 text-2xs text-warning">
                  {t("pendingAccessRequests.approvedDialog.deliveryFailed")}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={resendMagicLink} disabled={busyId === `resend-${approved?.request_id}`}>
              {busyId === `resend-${approved?.request_id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              {t("pendingAccessRequests.approvedDialog.resendLoginLink")}
            </Button>
            <Button onClick={() => setApproved(null)}>{t("pendingAccessRequests.approvedDialog.done")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-28 shrink-0 text-micro font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

function CopyRow({ label, value, mono, copiedLabel }: { label: string; value: string; mono?: boolean; copiedLabel: string }) {
  return (
    <div>
      <p className="text-micro font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
        <code className={mono ? "flex-1 font-mono text-sm2" : "flex-1 text-sm2"}>{value}</code>
        <Button
          size="sm" variant="ghost"
          onClick={() => { navigator.clipboard.writeText(value); toast.success(copiedLabel); }}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Check, X, Loader2, Inbox, Copy, Eye } from "lucide-react";
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
  const [rows, setRows] = useState<AccessRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<AccessRequest | null>(null);
  const [credential, setCredential] = useState<{
    email: string; password: string; full_name: string;
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
      if ((data as any)?.error) throw new Error((data as any).error);
      const payload = data as { temp_password: string; email: string };
      setCredential({
        email: payload.email,
        password: payload.temp_password,
        full_name: req.full_name,
      });
      toast.success("Account created");
      await load();
      onApproved?.();
    } catch (err: any) {
      toast.error(err.message ?? "Approval failed");
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (req: AccessRequest) => {
    if (!confirm(`Reject access request from ${req.full_name}?`)) return;
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
      toast.success("Request rejected");
      await load();
    } catch (err: any) {
      toast.error(err.message ?? "Failed");
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

  if (rows.length === 0) return null;

  return (
    <>
      <Card className="mb-4 overflow-hidden border-warning/40">
        <div className="flex items-center justify-between gap-2 border-b bg-warning/10 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Inbox className="h-4 w-4 text-warning" />
            <p className="text-[11px] font-bold uppercase tracking-widest text-warning">
              {rows.length} access request{rows.length === 1 ? "" : "s"} awaiting approval
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 text-left font-semibold">Name</th>
                <th className="px-3 py-2.5 text-left font-semibold">Email</th>
                <th className="px-3 py-2.5 text-left font-semibold">{variant === "coach" ? "Credential" : "Job · Company"}</th>
                <th className="px-3 py-2.5 text-left font-semibold">Industry</th>
                <th className="px-3 py-2.5 text-left font-semibold">Submitted</th>
                <th className="px-3 py-2.5 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-muted/30">
                  <td className="px-3 py-2.5 font-medium">{r.full_name}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.email}</td>
                  <td className="px-3 py-2.5 text-[11px]">
                    {variant === "coach"
                      ? (r.credential ?? "—")
                      : `${r.job_title ?? "—"}${r.company ? ` · ${r.company}` : ""}`}
                  </td>
                  <td className="px-3 py-2.5 text-[11px]">{r.industry ?? "—"}</td>
                  <td className="px-3 py-2.5 text-[11px] text-muted-foreground">
                    {format(new Date(r.created_at), "MMM d, yyyy")}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="inline-flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setViewing(r)} title="View details">
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm" variant="outline"
                        onClick={() => reject(r)}
                        disabled={busyId === r.id}
                      >
                        <X className="h-3.5 w-3.5" /> Reject
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => approve(r)}
                        disabled={busyId === r.id}
                      >
                        {busyId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        Approve
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Details dialog */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{viewing?.full_name}</DialogTitle>
            <DialogDescription>{viewing?.email}</DialogDescription>
          </DialogHeader>
          {viewing && (
            <div className="space-y-3 text-sm">
              <Field label="Role"><Pill tone="primary">{viewing.role}</Pill></Field>
              {viewing.job_title && <Field label="Job title">{viewing.job_title}</Field>}
              {viewing.company && <Field label="Company">{viewing.company}</Field>}
              {viewing.industry && <Field label="Industry">{viewing.industry}</Field>}
              {viewing.credential && <Field label="ICF credential">{viewing.credential}</Field>}
              {viewing.linkedin_url && (
                <Field label="LinkedIn">
                  <a href={viewing.linkedin_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                    {viewing.linkedin_url}
                  </a>
                </Field>
              )}
              {viewing.motivation && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Motivation</p>
                  <p className="mt-1 whitespace-pre-wrap">{viewing.motivation}</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewing(null)}>Close</Button>
            {viewing && (
              <Button onClick={() => { const r = viewing; setViewing(null); approve(r); }}>
                <Check className="h-4 w-4" /> Approve
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generated credential dialog */}
      <Dialog open={!!credential} onOpenChange={(o) => !o && setCredential(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Account created for {credential?.full_name}</DialogTitle>
            <DialogDescription>
              Share these credentials with the user privately. The user will be required to set a new password on first sign-in.
            </DialogDescription>
          </DialogHeader>
          {credential && (
            <div className="space-y-3 text-sm">
              <CopyRow label="Email" value={credential.email} />
              <CopyRow label="Temporary password" value={credential.password} mono />
              <p className="rounded-lg bg-warning/10 p-3 text-[11px] text-warning">
                ⚠ This password is shown only once. Copy it now — it cannot be retrieved later.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setCredential(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-28 shrink-0 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

function CopyRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
        <code className={mono ? "flex-1 font-mono text-[13px]" : "flex-1 text-[13px]"}>{value}</code>
        <Button
          size="sm" variant="ghost"
          onClick={() => { navigator.clipboard.writeText(value); toast.success("Copied"); }}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

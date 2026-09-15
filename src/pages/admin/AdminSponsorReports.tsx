import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { AdminPageHeader, Pill } from "./_shared";
import { toast } from "sonner";

type RequestRow = {
  id: string; status: "submitted" | "in_progress" | "ready" | "declined";
  organization_name: string; cohort_name: string; requester_name: string;
  request_notes: string | null; admin_notes: string | null; created_at: string;
};

export default function AdminSponsorReports() {
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_list_report_requests");
    if (error) toast.error(error.message);
    setRows((data ?? []) as RequestRow[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);
  const update = async (row: RequestRow, status: string, notes: string) => {
    setSaving(row.id);
    const { error } = await supabase.rpc("admin_update_report_request", { p_request_id: row.id, p_status: status, p_admin_notes: notes || null });
    setSaving(null);
    if (error) toast.error(error.message); else { toast.success("Request updated"); load(); }
  };
  return <div>
    <AdminPageHeader eyebrow="SPONSOR OPERATIONS" title="Report requests" trailing={<Button variant="outline" size="sm" onClick={load}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>} subtitle="Review requests and record manual preparation progress. No report files are generated or stored." />
    {loading ? <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div> :
      <div className="space-y-3">{rows.length === 0 ? <div className="surface-card p-8 text-center text-sm text-muted-foreground">No sponsor report requests.</div> :
        rows.map((row) => <RequestCard key={row.id} row={row} saving={saving === row.id} onUpdate={update} />)}</div>}
  </div>;
}

function RequestCard({ row, saving, onUpdate }: { row: RequestRow; saving: boolean; onUpdate: (row: RequestRow, status: string, notes: string) => void }) {
  const [status, setStatus] = useState(row.status);
  const [notes, setNotes] = useState(row.admin_notes ?? "");
  return <div className="surface-card p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold">{row.organization_name} · {row.cohort_name}</p><p className="text-xs text-muted-foreground">{row.requester_name} · {new Date(row.created_at).toLocaleString()}</p></div><Pill tone={status === "ready" ? "success" : status === "declined" ? "destructive" : "primary"}>{status.replace("_", " ")}</Pill></div>
    {row.request_notes && <p className="mt-3 text-sm text-muted-foreground">Sponsor note: {row.request_notes}</p>}
    <div className="mt-4 grid gap-3 sm:grid-cols-[180px_1fr_auto]"><Select value={status} onValueChange={setStatus}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["submitted", "in_progress", "ready", "declined"].map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}</SelectContent></Select><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Manual preparation notes" rows={2} /><Button onClick={() => onUpdate(row, status, notes)} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button></div>
  </div>;
}
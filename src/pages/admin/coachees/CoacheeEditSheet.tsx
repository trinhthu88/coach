import { useState } from "react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { useAdminCoacheeMutations } from "@/hooks/admin/useAdminCoacheeMutations";
import type { ProgrammeOpt, NamedOpt } from "@/hooks/admin/useAdminCoacheesData";
import { STATUS_LABEL, type Row, type Status } from "./coacheeDisplay";

interface CoacheeEditSheetProps {
  row: Row | null;
  original: Row | undefined;
  onClose: () => void;
  onSaved: () => void;
  programmes: ProgrammeOpt[];
  cohorts: NamedOpt[];
  organizations: NamedOpt[];
  coachOpts: NamedOpt[];
  defaultLimit: number;
}

export function CoacheeEditSheet({
  row,
  original,
  onClose,
  onSaved,
  programmes,
  cohorts,
  organizations,
  coachOpts,
  defaultLimit,
}: CoacheeEditSheetProps) {
  const { saving, saveEdit, resendingLink, resendLoginLink, resentLink, setResentLink } = useAdminCoacheeMutations(onSaved);
  const [editing, setEditing] = useState<Row | null>(row);

  // Reseed the local edit copy whenever a different row is opened.
  if (row && editing?.id !== row.id) {
    setEditing({ ...row, selected_coaches: [...row.selected_coaches] });
  }
  if (!row && editing) {
    setEditing(null);
  }

  const handleSave = async () => {
    if (!editing) return;
    const ok = await saveEdit(editing, original);
    if (ok) onClose();
  };

  return (
    <>
      <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Edit coachee</SheetTitle>
            <SheetDescription>{editing?.email}</SheetDescription>
          </SheetHeader>
          {editing && (
            <div className="mt-4 space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Full name</Label><Input value={editing.full_name} onChange={(e) => setEditing({ ...editing, full_name: e.target.value })} /></div>
                <div>
                  <Label>Status</Label>
                  <Select value={editing.status} onValueChange={(v) => setEditing({ ...editing, status: v as Status })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(STATUS_LABEL) as Status[]).map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Programme <span className="text-destructive">*</span></Label>
                  <Select
                    value={editing.programme_id || ""}
                    onValueChange={(v) => {
                      const prog = programmes.find((p) => p.id === v);
                      setEditing({
                        ...editing,
                        programme_id: v,
                        programme_name: prog?.name || null,
                        programme_default_limit: prog?.coachee_session_limit ?? null,
                        programme_duration_months: prog?.duration_months ?? null,
                        // Auto-default the limit when programme changes (admin can still override below)
                        session_limit: prog?.coachee_session_limit ?? editing.session_limit,
                      });
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Select a programme…" /></SelectTrigger>
                    <SelectContent>
                      {programmes.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-[10px] text-muted-foreground">Required. Defaults the session limit below.</p>
                </div>
                <div>
                  <Label>Session limit (received)</Label>
                  <Input type="number" min={0} value={editing.session_limit} onChange={(e) => setEditing({ ...editing, session_limit: Number(e.target.value) })} />
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Used {editing.done} · programme default {editing.programme_default_limit ?? defaultLimit} (override allowed)
                  </p>
                </div>
              </div>

              <div>
                <Label>Cohort</Label>
                <Select value={editing.cohort_id || "none"} onValueChange={(v) => setEditing({ ...editing, cohort_id: v === "none" ? null : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— None —</SelectItem>
                    {cohorts.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Sponsor organization</Label>
                <Select value={editing.organization_id || "none"} onValueChange={(v) => setEditing({ ...editing, organization_id: v === "none" ? null : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— None —</SelectItem>
                    {organizations.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Links this enrollment to a sponsor company. Their sponsor can see participation and progress — never session notes, goal text, or reflections.
                </p>
              </div>

              <div className="rounded-lg border p-3">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Selected coaches (whom they can book)</p>
                <div className="max-h-48 space-y-1 overflow-y-auto">
                  {coachOpts.map((c) => {
                    const checked = editing.selected_coaches.some((a) => a.id === c.id);
                    return (
                      <label key={c.id} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-muted/50 cursor-pointer">
                        <Checkbox checked={checked} onCheckedChange={(v) => {
                          const next = v
                            ? [...editing.selected_coaches, { id: c.id, name: c.name }]
                            : editing.selected_coaches.filter((a) => a.id !== c.id);
                          setEditing({ ...editing, selected_coaches: next });
                        }} />
                        <span className="text-[12px]">{c.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-lg bg-muted/40 p-3 text-[11px] text-muted-foreground">
                <p>Sessions: <strong>{editing.done}</strong> completed · <strong>{editing.booked}</strong> booked</p>
              </div>

              <div className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Login link</p>
                    <p className="mt-2 text-[12px] text-muted-foreground">
                      Access is passwordless. Click <strong>Resend login link</strong> to email them a fresh one-click sign-in link.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => resendLoginLink(editing)}
                    disabled={!editing.access_request_id || resendingLink}
                  >
                    {resendingLink ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Resend login link
                  </Button>
                </div>
              </div>
            </div>
          )}
          <SheetFooter className="mt-6">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Login link resent confirmation dialog */}
      <Dialog open={!!resentLink} onOpenChange={(o) => !o && setResentLink(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Login link for {resentLink?.full_name}</DialogTitle>
            <DialogDescription>
              {resentLink?.email_sent
                ? "A one-click login link was emailed to them."
                : "Delivery failed — try again or check the Resend dashboard."}
            </DialogDescription>
          </DialogHeader>
          {resentLink && (
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Email</p>
                <div className="mt-1 flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
                  <code className="flex-1 text-[13px]">{resentLink.email}</code>
                  <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(resentLink.email); toast.success("Copied"); }}>Copy</Button>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setResentLink(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

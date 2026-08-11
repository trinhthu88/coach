import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Loader2, Plus, Pencil, Trash2, Building2, UsersRound, RotateCcw, Copy } from "lucide-react";
import { AdminPageHeader, Pill } from "./_shared";
import { toast } from "sonner";

interface Organization {
  id: string;
  name: string;
  industry: string | null;
}

interface Sponsor {
  user_id: string;
  organization_id: string;
  title: string | null;
  department: string | null;
  full_name: string;
  email: string;
}

export default function AdminOrganizations() {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [sponsorsByOrg, setSponsorsByOrg] = useState<Record<string, Sponsor>>({});
  const [enrollmentCounts, setEnrollmentCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Organization> | null>(null);
  const [saving, setSaving] = useState(false);
  const [inviting, setInviting] = useState<Organization | null>(null);
  const [inviteForm, setInviteForm] = useState({ email: "", full_name: "", title: "", department: "" });
  const [inviteBusy, setInviteBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState<string | null>(null);
  const [credential, setCredential] = useState<{ email: string; password: string; full_name: string } | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: o }, { data: sp }, { data: enr }] = await Promise.all([
      supabase.from("organizations").select("id, name, industry").order("name"),
      supabase.from("sponsor_profiles").select("user_id, organization_id, title, department, profiles(full_name, email)"),
      supabase.from("programme_enrollments").select("organization_id").not("organization_id", "is", null),
    ]);
    const byOrg: Record<string, Sponsor> = {};
    (sp || []).forEach((row) => {
      const profile = row.profiles as unknown as { full_name: string; email: string } | null;
      if (!profile) return;
      byOrg[row.organization_id] = {
        user_id: row.user_id,
        organization_id: row.organization_id,
        title: row.title,
        department: row.department,
        full_name: profile.full_name,
        email: profile.email,
      };
    });
    const counts: Record<string, number> = {};
    (enr || []).forEach((e) => {
      if (e.organization_id) counts[e.organization_id] = (counts[e.organization_id] || 0) + 1;
    });
    setOrgs((o || []) as Organization[]);
    setSponsorsByOrg(byOrg);
    setEnrollmentCounts(counts);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const saveOrg = async () => {
    if (!editing?.name?.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      const payload = { name: editing.name, industry: editing.industry || null };
      if (editing.id) {
        const { error } = await supabase.from("organizations").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("organizations").insert(payload);
        if (error) throw error;
      }
      toast.success("Organization saved");
      setEditing(null);
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };

  const removeOrg = async (id: string) => {
    if (!confirm("Delete organization? Any linked enrollments keep their programme but lose the org link.")) return;
    const { error } = await supabase.from("organizations").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Deleted"); load(); }
  };

  const openInvite = (org: Organization) => {
    setInviting(org);
    setInviteForm({ email: "", full_name: "", title: "", department: "" });
  };

  const submitInvite = async () => {
    if (!inviting) return;
    if (!inviteForm.email.trim() || !inviteForm.full_name.trim()) {
      toast.error("Email and name are required");
      return;
    }
    setInviteBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("invite-sponsor", {
        body: {
          organization_id: inviting.id,
          email: inviteForm.email.trim(),
          full_name: inviteForm.full_name.trim(),
          title: inviteForm.title.trim() || undefined,
          department: inviteForm.department.trim() || undefined,
        },
      });
      if (error) throw error;
      const result = data as { error?: string; temp_password?: string; email?: string; full_name?: string };
      if (result?.error) throw new Error(result.error);
      setCredential({ email: result.email!, password: result.temp_password!, full_name: result.full_name! });
      toast.success("Sponsor account created");
      setInviting(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not invite sponsor");
    } finally {
      setInviteBusy(false);
    }
  };

  const resetSponsorPassword = async (org: Organization) => {
    setResetBusy(org.id);
    try {
      const { data, error } = await supabase.functions.invoke("invite-sponsor", {
        body: { organization_id: org.id, force_reset_password: true },
      });
      if (error) throw error;
      const result = data as { error?: string; temp_password?: string; email?: string; full_name?: string };
      if (result?.error) throw new Error(result.error);
      setCredential({ email: result.email!, password: result.temp_password!, full_name: result.full_name! });
      toast.success("Temporary password reset");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reset password");
    } finally {
      setResetBusy(null);
    }
  };

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div>
      <AdminPageHeader
        title="Organizations"
        emphasize="& sponsors"
        subtitle="Client companies sponsoring leaders through the programme, and their sponsor contact."
        right={<Button onClick={() => setEditing({ name: "" })}><Plus className="h-4 w-4" /> New organization</Button>}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {orgs.map((o) => {
          const sponsor = sponsorsByOrg[o.id];
          return (
            <Card key={o.id} className="p-4">
              <div className="mb-2 flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-primary" />
                  <h3 className="text-base font-semibold">{o.name}</h3>
                </div>
                {o.industry && <Pill tone="secondary">{o.industry}</Pill>}
              </div>

              <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <UsersRound className="h-3 w-3" /> {enrollmentCounts[o.id] || 0} enrolled leader{enrollmentCounts[o.id] === 1 ? "" : "s"}
              </p>

              <div className="mt-3 rounded-lg border bg-muted/20 p-2.5">
                {sponsor ? (
                  <>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Sponsor</p>
                    <p className="mt-1 truncate text-[12px] font-medium">{sponsor.full_name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{sponsor.email}</p>
                    {sponsor.title && <p className="text-[11px] text-muted-foreground">{sponsor.title}{sponsor.department ? ` · ${sponsor.department}` : ""}</p>}
                    <Button
                      variant="outline" size="sm" className="mt-2 w-full"
                      onClick={() => resetSponsorPassword(o)}
                      disabled={resetBusy === o.id}
                    >
                      {resetBusy === o.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                      Reset password
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="text-[11px] text-muted-foreground">No sponsor assigned yet.</p>
                    <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => openInvite(o)}>
                      <Plus className="h-3.5 w-3.5" /> Invite sponsor
                    </Button>
                  </>
                )}
              </div>

              <div className="mt-3 flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditing(o)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
                <Button variant="ghost" size="sm" onClick={() => removeOrg(o.id)}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
              </div>
            </Card>
          );
        })}
        {orgs.length === 0 && (
          <Card className="col-span-full p-12 text-center text-sm text-muted-foreground">
            No organizations yet. Add one to start assigning leaders and a sponsor contact.
          </Card>
        )}
      </div>

      {/* Create/edit organization */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? "Edit" : "New"} organization</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
              <div><Label>Industry</Label><Input value={editing.industry || ""} onChange={(e) => setEditing({ ...editing, industry: e.target.value })} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={saveOrg} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite sponsor */}
      <Dialog open={!!inviting} onOpenChange={(o) => !o && setInviting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite sponsor for {inviting?.name}</DialogTitle>
            <DialogDescription>Creates their account and shows a one-time temporary password to share privately.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Full name</Label><Input value={inviteForm.full_name} onChange={(e) => setInviteForm({ ...inviteForm, full_name: e.target.value })} /></div>
            <div><Label>Email</Label><Input type="email" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Title (optional)</Label><Input value={inviteForm.title} onChange={(e) => setInviteForm({ ...inviteForm, title: e.target.value })} /></div>
              <div><Label>Department (optional)</Label><Input value={inviteForm.department} onChange={(e) => setInviteForm({ ...inviteForm, department: e.target.value })} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviting(null)}>Cancel</Button>
            <Button onClick={submitInvite} disabled={inviteBusy}>{inviteBusy && <Loader2 className="h-4 w-4 animate-spin" />}Create sponsor account</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* One-time credential display */}
      <Dialog open={!!credential} onOpenChange={(o) => !o && setCredential(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Account ready for {credential?.full_name}</DialogTitle>
            <DialogDescription>Share these credentials privately. The temporary password is shown only once and is not stored anywhere.</DialogDescription>
          </DialogHeader>
          {credential && (
            <div className="space-y-3 text-sm">
              <CopyRow label="Email" value={credential.email} />
              <CopyRow label="Temporary password" value={credential.password} mono />
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setCredential(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CopyRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
        <code className={mono ? "flex-1 font-mono text-[13px]" : "flex-1 text-[13px]"}>{value}</code>
        <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(value); toast.success("Copied"); }}>
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

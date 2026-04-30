import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import {
  Check,
  Loader2,
  X,
  Eye,
  Search,
  FileDown,
  FileUp,
  Users,
  ShieldCheck,
  Pencil,
} from "lucide-react";
import { format } from "date-fns";
import * as XLSX from "xlsx";

type Status = "pending_approval" | "active" | "rejected" | "suspended" | "reach_limit";

interface CoacheeRow {
  id: string;
  full_name: string;
  email: string;
  status: Status;
  created_at: string;
  booked: number;
  done: number;
  monthly_limit: number;
  selected_coaches: { id: string; name: string }[];
}

interface CoachOpt {
  id: string;
  name: string;
}

interface CoachListRow {
  id: string;
  full_name: string;
  email: string;
  title: string | null;
  status: Status;
  created_at: string;
  approval_status: string;
  sessions_completed: number;
  coachees_count: number;
  rating_avg: number;
  country_based: string | null;
  years_experience: number | null;
  // Coach-as-coachee
  coach_limit: number;
  coach_used: number;
  peer_limit: number;
  peer_used: number;
  assigned_coaches: { id: string; name: string }[];
  limit_row_id: string | null;
}

const STATUS_LABEL: Record<Status, string> = {
  pending_approval: "Awaiting approval",
  active: "Active",
  rejected: "Rejected",
  suspended: "Suspended",
  reach_limit: "Reached limit",
};

const STATUS_TONE: Record<Status, "default" | "secondary" | "destructive" | "outline"> = {
  pending_approval: "secondary",
  active: "default",
  rejected: "destructive",
  suspended: "outline",
  reach_limit: "outline",
};

export default function AdminRegistrations() {
  const [loading, setLoading] = useState(true);
  const [coachees, setCoachees] = useState<CoacheeRow[]>([]);
  const [coaches, setCoaches] = useState<CoachListRow[]>([]);
  const [coachOpts, setCoachOpts] = useState<CoachOpt[]>([]);
  const [defaultLimit, setDefaultLimit] = useState(4);
  const [defaultCoachLimit, setDefaultCoachLimit] = useState(4);
  const [defaultPeerLimit, setDefaultPeerLimit] = useState(4);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [coacheeQuery, setCoacheeQuery] = useState("");
  const [coachQuery, setCoachQuery] = useState("");
  const [coacheeStatus, setCoacheeStatus] = useState<"all" | Status>("all");
  const [coachStatus, setCoachStatus] = useState<"all" | Status>("all");
  const [editing, setEditing] = useState<CoacheeRow | null>(null);
  const [editingCoach, setEditingCoach] = useState<CoachListRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);

    // Fetch all roles
    const { data: roles } = await supabase
      .from("user_roles")
      .select("user_id, role");
    const coacheeIds = (roles || []).filter((r) => r.role === "coachee").map((r) => r.user_id);
    const coachIds = (roles || []).filter((r) => r.role === "coach").map((r) => r.user_id);

    const [
      { data: profiles },
      { data: limits },
      { data: allowlist },
      { data: sess },
      { data: cps },
      { data: coachLimits },
      { data: peerSess },
      { data: coachAllow },
    ] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email, status, created_at"),
      supabase.from("session_limits").select("coachee_id, monthly_limit"),
      supabase.from("coachee_coach_allowlist").select("coachee_id, coach_id"),
      supabase.from("sessions").select("id, coach_id, coachee_id, status"),
      supabase.from("coach_profiles").select("*"),
      supabase.from("coach_session_limits").select("id, coach_user_id, monthly_limit, peer_monthly_limit"),
      supabase.from("peer_sessions").select("id, peer_coach_id, peer_coachee_id, status"),
      supabase.from("coach_as_coachee_allowlist").select("coach_user_id, selectable_coach_id"),
    ]);

    const profilesById = new Map((profiles || []).map((p: any) => [p.id, p]));
    const cpById = new Map((cps || []).map((c: any) => [c.id, c]));

    const globalLimit =
      (limits || []).find((l: any) => l.coachee_id === null)?.monthly_limit ?? 4;
    setDefaultLimit(globalLimit);
    const limitByCoachee = new Map(
      (limits || [])
        .filter((l: any) => l.coachee_id)
        .map((l: any) => [l.coachee_id, l.monthly_limit])
    );

    const bookedByCoachee = new Map<string, number>();
    const doneByCoachee = new Map<string, number>();
    (sess || []).forEach((s: any) => {
      if (["pending_coach_approval", "confirmed"].includes(s.status)) {
        bookedByCoachee.set(s.coachee_id, (bookedByCoachee.get(s.coachee_id) || 0) + 1);
      }
      if (s.status === "completed") {
        doneByCoachee.set(s.coachee_id, (doneByCoachee.get(s.coachee_id) || 0) + 1);
      }
    });

    // Per-coach completed sessions and unique coachees (confirmed/completed)
    const coachCompletedById = new Map<string, number>();
    const coachCoacheesById = new Map<string, Set<string>>();
    (sess || []).forEach((s: any) => {
      if (s.status === "completed") {
        coachCompletedById.set(s.coach_id, (coachCompletedById.get(s.coach_id) || 0) + 1);
      }
      if (["confirmed", "completed"].includes(s.status)) {
        const set = coachCoacheesById.get(s.coach_id) || new Set<string>();
        set.add(s.coachee_id);
        coachCoacheesById.set(s.coach_id, set);
      }
    });

    const coachNameById = new Map<string, string>();
    coachIds.forEach((cid) => {
      const p: any = profilesById.get(cid);
      if (p) coachNameById.set(cid, p.full_name);
    });

    const allowByCoachee = new Map<string, { id: string; name: string }[]>();
    (allowlist || []).forEach((a: any) => {
      const arr = allowByCoachee.get(a.coachee_id) || [];
      arr.push({ id: a.coach_id, name: coachNameById.get(a.coach_id) || "—" });
      allowByCoachee.set(a.coachee_id, arr);
    });

    const coacheeRows: CoacheeRow[] = coacheeIds
      .map((id) => {
        const p: any = profilesById.get(id);
        if (!p) return null;
        return {
          id,
          full_name: p.full_name,
          email: p.email,
          status: p.status as Status,
          created_at: p.created_at,
          booked: bookedByCoachee.get(id) || 0,
          done: doneByCoachee.get(id) || 0,
          monthly_limit: limitByCoachee.get(id) ?? globalLimit,
          selected_coaches: allowByCoachee.get(id) || [],
        } as CoacheeRow;
      })
      .filter(Boolean) as CoacheeRow[];

    // Defaults & per-coach limit overrides
    const defCoachLimitRow = (coachLimits || []).find((l: any) => l.coach_user_id === null);
    const defCoach = defCoachLimitRow?.monthly_limit ?? 4;
    const defPeer = defCoachLimitRow?.peer_monthly_limit ?? 4;
    setDefaultCoachLimit(defCoach);
    setDefaultPeerLimit(defPeer);
    const coachLimitByCoach = new Map<string, any>();
    (coachLimits || [])
      .filter((l: any) => l.coach_user_id)
      .forEach((l: any) => coachLimitByCoach.set(l.coach_user_id, l));

    // Coach-as-coachee usage (completed coaching sessions where coach is the coachee)
    const coachAsCoacheeDone = new Map<string, number>();
    (sess || []).forEach((s: any) => {
      if (s.status === "completed" && coachIds.includes(s.coachee_id)) {
        coachAsCoacheeDone.set(s.coachee_id, (coachAsCoacheeDone.get(s.coachee_id) || 0) + 1);
      }
    });

    // Peer-as-receiver usage (completed peer sessions)
    const peerReceivedDone = new Map<string, number>();
    (peerSess || []).forEach((s: any) => {
      if (s.status === "completed") {
        peerReceivedDone.set(s.peer_coachee_id, (peerReceivedDone.get(s.peer_coachee_id) || 0) + 1);
      }
    });

    // Assigned coaches (for coach-as-coachee)
    const assignedByCoach = new Map<string, { id: string; name: string }[]>();
    (coachAllow || []).forEach((a: any) => {
      const arr = assignedByCoach.get(a.coach_user_id) || [];
      arr.push({ id: a.selectable_coach_id, name: coachNameById.get(a.selectable_coach_id) || "—" });
      assignedByCoach.set(a.coach_user_id, arr);
    });

    const coachRows: CoachListRow[] = coachIds
      .map((id) => {
        const p: any = profilesById.get(id);
        const cp: any = cpById.get(id);
        if (!p) return null;
        const lim = coachLimitByCoach.get(id);
        return {
          id,
          full_name: p.full_name,
          email: p.email,
          status: p.status as Status,
          created_at: p.created_at,
          approval_status: cp?.approval_status || "pending_approval",
          sessions_completed: coachCompletedById.get(id) || 0,
          coachees_count: (coachCoacheesById.get(id) || new Set()).size,
          rating_avg: Number(cp?.rating_avg || 0),
          country_based: cp?.country_based || null,
          years_experience: cp?.years_experience || null,
          coach_limit: lim?.monthly_limit ?? defCoach,
          coach_used: coachAsCoacheeDone.get(id) || 0,
          peer_limit: lim?.peer_monthly_limit ?? defPeer,
          peer_used: peerReceivedDone.get(id) || 0,
          assigned_coaches: assignedByCoach.get(id) || [],
          limit_row_id: lim?.id ?? null,
        } as CoachListRow;
      })
      .filter(Boolean) as CoachListRow[];

    setCoachees(coacheeRows.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)));
    setCoaches(coachRows.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)));
    setCoachOpts(
      coachIds
        .map((id) => ({ id, name: coachNameById.get(id) || "—" }))
        .filter((c) => c.name !== "—")
        .sort((a, b) => a.name.localeCompare(b.name))
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setCoacheeStatusValue = async (id: string, status: Status) => {
    setBusyId(id);
    const { error } = await supabase.from("profiles").update({ status }).eq("id", id);
    if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
    else {
      toast({ title: `Coachee ${STATUS_LABEL[status].toLowerCase()}` });
      await load();
    }
    setBusyId(null);
  };

  const setCoachStatusValue = async (id: string, status: Status) => {
    setBusyId(id);
    const patch: any = { approval_status: status };
    if (status === "active") patch.last_approved_at = new Date().toISOString();
    const { error: cErr } = await supabase
      .from("coach_profiles")
      .update(patch)
      .eq("id", id);
    if (!cErr) {
      await supabase.from("profiles").update({ status }).eq("id", id);
      toast({ title: `Coach ${STATUS_LABEL[status].toLowerCase()}` });
      await load();
    } else {
      toast({ title: "Failed", description: cErr.message, variant: "destructive" });
    }
    setBusyId(null);
  };

  const filteredCoachees = useMemo(() => {
    return coachees.filter((c) => {
      const q = coacheeQuery.toLowerCase().trim();
      const mq =
        !q ||
        c.full_name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q);
      const ms = coacheeStatus === "all" || c.status === coacheeStatus;
      return mq && ms;
    });
  }, [coachees, coacheeQuery, coacheeStatus]);

  const filteredCoaches = useMemo(() => {
    return coaches.filter((c) => {
      const q = coachQuery.toLowerCase().trim();
      const mq =
        !q ||
        c.full_name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q);
      const ms = coachStatus === "all" || c.status === coachStatus;
      return mq && ms;
    });
  }, [coaches, coachQuery, coachStatus]);

  // Export coachees to Excel
  const exportCoachees = () => {
    const data = filteredCoachees.map((c) => ({
      Name: c.full_name,
      Email: c.email,
      Registered: format(new Date(c.created_at), "yyyy-MM-dd"),
      Status: STATUS_LABEL[c.status],
      "Booked sessions": c.booked,
      "Sessions done": c.done,
      "Monthly limit": c.monthly_limit,
      "Selected coaches": c.selected_coaches.map((s) => s.name).join("; "),
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Coachees");
    XLSX.writeFile(wb, `coachees-${format(new Date(), "yyyyMMdd")}.xlsx`);
    toast({ title: "Exported" });
  };

  // Bulk import (invite)
  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
      if (!rows.length) {
        toast({ title: "Empty file", variant: "destructive" });
        return;
      }
      const redirectTo = `${window.location.origin}/auth`;
      let ok = 0;
      let fail = 0;
      for (const row of rows) {
        const email =
          (row.Email || row.email || row.EMAIL || "").toString().trim().toLowerCase();
        const name = (row.Name || row.name || row["Full name"] || "").toString().trim();
        const limitRaw =
          row["Session limit"] ?? row.SessionLimit ?? row.session_limit ?? row.Limit ?? "";
        const limitNum = Number(limitRaw);
        const sessionLimit = Number.isFinite(limitNum) && limitNum > 0 ? Math.floor(limitNum) : null;
        if (!email) {
          fail++;
          continue;
        }
        const { data: otpData, error } = await supabase.auth.signInWithOtp({
          email,
          options: {
            data: { full_name: name || email.split("@")[0], role: "coachee" },
            emailRedirectTo: redirectTo,
          },
        });
        if (error) {
          fail++;
          continue;
        }
        ok++;
        // If we have a user id back and a custom limit, save it
        const newUserId = (otpData as any)?.user?.id;
        if (newUserId && sessionLimit !== null) {
          await supabase
            .from("session_limits")
            .upsert(
              { coachee_id: newUserId, monthly_limit: sessionLimit },
              { onConflict: "coachee_id" }
            );
        }
      }
      toast({
        title: "Import finished",
        description: `${ok} invited, ${fail} failed. Coachees confirm via email link.`,
      });
      setImportOpen(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setTimeout(load, 1500);
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    }
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([
      { Name: "Jane Doe", Email: "jane@example.com", "Session limit": 6 },
      { Name: "John Smith", Email: "john@example.com", "Session limit": 4 },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Coachees");
    XLSX.writeFile(wb, "coachees-import-template.xlsx");
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Admin</p>
        <h1 className="text-3xl font-semibold tracking-tight">Registrations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage all coaches and coachees. Default monthly limit:{" "}
          <span className="font-semibold text-foreground">{defaultLimit}</span> sessions.
        </p>
      </div>

      <Tabs defaultValue="coachees">
        <TabsList>
          <TabsTrigger value="coachees" className="gap-2">
            <Users className="h-4 w-4" /> Coachees ({coachees.length})
          </TabsTrigger>
          <TabsTrigger value="coaches" className="gap-2">
            <ShieldCheck className="h-4 w-4" /> Coaches ({coaches.length})
          </TabsTrigger>
        </TabsList>

        {/* COACHEES */}
        <TabsContent value="coachees" className="space-y-4 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[240px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={coacheeQuery}
                onChange={(e) => setCoacheeQuery(e.target.value)}
                placeholder="Search by name or email"
                className="pl-9"
              />
            </div>
            <Select value={coacheeStatus} onValueChange={(v) => setCoacheeStatus(v as any)}>
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending_approval">Awaiting approval</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="reach_limit">Reached limit</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={exportCoachees}>
              <FileDown className="h-4 w-4" /> Export
            </Button>
            <Button onClick={() => setImportOpen(true)}>
              <FileUp className="h-4 w-4" /> Import Excel
            </Button>
          </div>

          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-left">Email</th>
                  <th className="px-4 py-3 text-left">Registered</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-right">Booked</th>
                  <th className="px-4 py-3 text-right">Done</th>
                  <th className="px-4 py-3 text-right">Limit</th>
                  <th className="px-4 py-3 text-left">Selected coaches</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredCoachees.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                      No coachees match your filters.
                    </td>
                  </tr>
                ) : (
                  filteredCoachees.map((c) => (
                    <tr key={c.id} className="border-t hover:bg-muted/20">
                      <td className="px-4 py-3 font-semibold">{c.full_name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{c.email}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {format(new Date(c.created_at), "PP")}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right">{c.booked}</td>
                      <td className="px-4 py-3 text-right">{c.done}</td>
                      <td className="px-4 py-3 text-right">{c.monthly_limit}</td>
                      <td className="px-4 py-3">
                        {c.selected_coaches.length === 0 ? (
                          <span className="text-xs italic text-muted-foreground">
                            None assigned
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {c.selected_coaches.slice(0, 3).map((s) => (
                              <Badge key={s.id} variant="outline" className="text-[10px]">
                                {s.name}
                              </Badge>
                            ))}
                            {c.selected_coaches.length > 3 && (
                              <Badge variant="outline" className="text-[10px]">
                                +{c.selected_coaches.length - 3}
                              </Badge>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setEditing(c)}
                          >
                            <Pencil className="h-3.5 w-3.5" /> Edit
                          </Button>
                          {c.status === "pending_approval" && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busyId === c.id}
                                onClick={() => setCoacheeStatusValue(c.id, "rejected")}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                disabled={busyId === c.id}
                                onClick={() => setCoacheeStatusValue(c.id, "active")}
                              >
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Card>
        </TabsContent>

        {/* COACHES */}
        <TabsContent value="coaches" className="space-y-4 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[240px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={coachQuery}
                onChange={(e) => setCoachQuery(e.target.value)}
                placeholder="Search by name or email"
                className="pl-9"
              />
            </div>
            <Select value={coachStatus} onValueChange={(v) => setCoachStatus(v as any)}>
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending_approval">Awaiting approval</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-left">Email</th>
                  <th className="px-4 py-3 text-left">Registered</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Country</th>
                  <th className="px-4 py-3 text-right">Completed</th>
                  <th className="px-4 py-3 text-right">Coachees</th>
                  <th className="px-4 py-3 text-right">Rating</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredCoaches.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                      No coaches match your filters.
                    </td>
                  </tr>
                ) : (
                  filteredCoaches.map((c) => (
                    <tr key={c.id} className="border-t hover:bg-muted/20">
                      <td className="px-4 py-3 font-semibold">{c.full_name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{c.email}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {format(new Date(c.created_at), "PP")}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {c.country_based || "—"}
                      </td>
                      <td className="px-4 py-3 text-right">{c.sessions_completed}</td>
                      <td className="px-4 py-3 text-right">{c.coachees_count}</td>
                      <td className="px-4 py-3 text-right">★ {c.rating_avg.toFixed(1)}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          {c.status === "pending_approval" && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busyId === c.id}
                                onClick={() => setCoachStatusValue(c.id, "rejected")}
                              >
                                <X className="h-3.5 w-3.5" /> Reject
                              </Button>
                              <Button
                                size="sm"
                                disabled={busyId === c.id}
                                onClick={() => setCoachStatusValue(c.id, "active")}
                              >
                                <Check className="h-3.5 w-3.5" /> Approve
                              </Button>
                            </>
                          )}
                          {c.status === "active" && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busyId === c.id}
                              onClick={() => setCoachStatusValue(c.id, "suspended")}
                            >
                              Suspend
                            </Button>
                          )}
                          {c.status === "suspended" && (
                            <Button
                              size="sm"
                              disabled={busyId === c.id}
                              onClick={() => setCoachStatusValue(c.id, "active")}
                            >
                              Reactivate
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Card>
        </TabsContent>
      </Tabs>

      <EditCoacheeDialog
        coachee={editing}
        coachOpts={coachOpts}
        defaultLimit={defaultLimit}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
        }}
      />

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk import coachees</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              Upload an Excel file (.xlsx) with columns: <code>Name</code>,{" "}
              <code>Email</code>, and <code>Session limit</code> (optional — falls back to the
              platform default of {defaultLimit}). Each coachee receives an email invite to
              set their password.
            </p>
            <Button variant="outline" onClick={downloadTemplate}>
              <FileDown className="h-4 w-4" /> Download template
            </Button>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={onImportFile}
                className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-primary-foreground hover:file:bg-primary/90"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditCoacheeDialog({
  coachee,
  coachOpts,
  defaultLimit,
  onClose,
  onSaved,
}: {
  coachee: CoacheeRow | null;
  coachOpts: CoachOpt[];
  defaultLimit: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [limit, setLimit] = useState<number>(defaultLimit);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (coachee) {
      setLimit(coachee.monthly_limit);
      setPicked(new Set(coachee.selected_coaches.map((c) => c.id)));
      setSearch("");
    }
  }, [coachee]);

  if (!coachee) return null;

  const filtered = coachOpts.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      // Save monthly limit
      await supabase
        .from("session_limits")
        .upsert(
          { coachee_id: coachee.id, monthly_limit: limit },
          { onConflict: "coachee_id" }
        );

      // Reset allowlist
      await supabase
        .from("coachee_coach_allowlist")
        .delete()
        .eq("coachee_id", coachee.id);

      const inserts = Array.from(picked).map((coach_id) => ({
        coachee_id: coachee.id,
        coach_id,
      }));
      if (inserts.length) {
        const { error } = await supabase
          .from("coachee_coach_allowlist")
          .insert(inserts);
        if (error) throw error;
      }
      toast({ title: "Saved" });
      onSaved();
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!coachee} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {coachee.full_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Monthly session limit
            </label>
            <Input
              type="number"
              min={0}
              max={50}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="w-32"
            />
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Coaches this coachee can book ({picked.size})
            </label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search coaches…"
              className="mb-2"
            />
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border p-2">
              {filtered.length === 0 ? (
                <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                  No coaches.
                </p>
              ) : (
                filtered.map((c) => (
                  <label
                    key={c.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={picked.has(c.id)}
                      onCheckedChange={() => toggle(c.id)}
                    />
                    <span>{c.name}</span>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

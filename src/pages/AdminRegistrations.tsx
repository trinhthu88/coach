import { useEffect, useMemo, useRef, useState } from "react";
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
  Search,
  FileDown,
  FileUp,
  Users,
  ShieldCheck,
  Pencil,
  History,
  RotateCcw,
  ChevronLeft,
} from "lucide-react";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { useAdminRegistrations } from "@/hooks/admin/useAdminRegistrations";
import { useAdminRegistrationApprovals } from "@/hooks/admin/useAdminRegistrationApprovals";
import { useUpdateCoacheeAssignment } from "@/hooks/admin/useUpdateCoacheeAssignment";
import { useUpdateCoachAssignment } from "@/hooks/admin/useUpdateCoachAssignment";
import {
  useBulkInviteUsers,
  type BulkInviteRole,
  type BulkInviteRow,
  type BulkInviteBatch,
  type BulkInviteRowRecord,
  type PreviewResult,
  type PreviewStatus,
  type SubmitResult,
  type SubmitStatus,
} from "@/hooks/admin/useBulkInviteUsers";
import { CoachListRow, CoachOpt, CoacheeRow, Status } from "@/hooks/admin/types";
import { PageHeader } from "@/components/ui/page-header";

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

// null = unlimited (coach_programmes limit column)
function fmtLimit(n: number | null): string {
  return n === null ? "∞" : String(n);
}

export default function AdminRegistrations() {
  const {
    loading,
    coachees,
    coaches,
    coachOpts,
    defaultLimit,
    reload: load,
  } = useAdminRegistrations();
  const { busyId, setCoacheeStatusValue, setCoachStatusValue } = useAdminRegistrationApprovals(load);
  const [coacheeQuery, setCoacheeQuery] = useState("");
  const [coachQuery, setCoachQuery] = useState("");
  const [coacheeStatus, setCoacheeStatus] = useState<"all" | Status>("all");
  const [coachStatus, setCoachStatus] = useState<"all" | Status>("all");
  const [editing, setEditing] = useState<CoacheeRow | null>(null);
  const [editingCoach, setEditingCoach] = useState<CoachListRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);

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
  const exportCoachees = async () => {
    const XLSX = await import("xlsx");
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

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="All"
        emphasis="registrations"
        subtitle="Manage all coaches and coachees."
      />

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
            <Select value={coacheeStatus} onValueChange={(v) => setCoacheeStatus(v as "all" | Status)}>
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
            <Select value={coachStatus} onValueChange={(v) => setCoachStatus(v as "all" | Status)}>
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
                  <th className="px-4 py-3 text-left">Status (get coached)</th>
                  <th className="px-4 py-3 text-right">Coach limit (total)</th>
                  <th className="px-4 py-3 text-left">Assigned coaches</th>
                  <th className="px-4 py-3 text-right">Peer limit (total)</th>
                  <th className="px-4 py-3 text-right">Given (sessions / coachees / ★)</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredCoaches.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                      No coaches match your filters.
                    </td>
                  </tr>
                ) : (
                  filteredCoaches.map((c) => (
                    <tr key={c.id} className="border-t hover:bg-muted/20">
                      <td className="px-4 py-3">
                        <div className="font-semibold">{c.full_name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {c.country_based || "—"} · Reg. {format(new Date(c.created_at), "PP")}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{c.email}</td>
                      <td className="px-4 py-3">
                        <Badge variant={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={c.coach_limit !== null && c.coach_used >= c.coach_limit ? "font-semibold text-destructive" : ""}>
                          {c.coach_used} / {fmtLimit(c.coach_limit)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {c.assigned_coaches.length === 0 ? (
                          <span className="text-xs italic text-muted-foreground">None</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {c.assigned_coaches.slice(0, 3).map((s) => (
                              <Badge key={s.id} variant="outline" className="text-[10px]">
                                {s.name}
                              </Badge>
                            ))}
                            {c.assigned_coaches.length > 3 && (
                              <Badge variant="outline" className="text-[10px]">
                                +{c.assigned_coaches.length - 3}
                              </Badge>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={c.peer_limit !== null && c.peer_used >= c.peer_limit ? "font-semibold text-destructive" : ""}>
                          {c.peer_used} / {fmtLimit(c.peer_limit)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                        {c.sessions_completed} · {c.coachees_count} · ★ {c.rating_avg.toFixed(1)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setEditingCoach(c)}
                          >
                            <Pencil className="h-3.5 w-3.5" /> Edit
                          </Button>
                          {c.status === "pending_approval" && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busyId === c.id}
                                onClick={() => setCoachStatusValue(c.id, "rejected")}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                disabled={busyId === c.id}
                                onClick={() => setCoachStatusValue(c.id, "active")}
                              >
                                <Check className="h-3.5 w-3.5" />
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

      <EditCoachDialog
        coach={editingCoach}
        coachOpts={coachOpts}
        onClose={() => setEditingCoach(null)}
        onSaved={() => {
          setEditingCoach(null);
          load();
        }}
      />

      <BulkInviteDialog
        open={importOpen}
        defaultLimit={defaultLimit}
        onClose={() => setImportOpen(false)}
        onDone={load}
      />
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
  const { saving, save: saveAssignment } = useUpdateCoacheeAssignment();

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
    const ok = await saveAssignment(coachee.id, limit, picked);
    if (ok) onSaved();
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

function EditCoachDialog({
  coach,
  coachOpts,
  onClose,
  onSaved,
}: {
  coach: CoachListRow | null;
  coachOpts: CoachOpt[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const { saving, save: saveAssignment } = useUpdateCoachAssignment();

  useEffect(() => {
    if (coach) {
      setPicked(new Set(coach.assigned_coaches.map((c) => c.id)));
      setSearch("");
    }
  }, [coach]);

  if (!coach) return null;

  const filtered = coachOpts.filter(
    (c) => c.id !== coach.id && c.name.toLowerCase().includes(search.toLowerCase())
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
    const ok = await saveAssignment({ id: coach.id }, picked);
    if (ok) onSaved();
  };

  return (
    <Dialog open={!!coach} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {coach.full_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div className="rounded-lg border p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Session limits</p>
              <Button asChild variant="link" size="sm" className="h-auto p-0 text-[11px]">
                <Link to="/admin/coach-programmes">Change coach programme →</Link>
              </Button>
            </div>
            <p className="mb-2 text-sm font-medium">
              {coach.coach_programme_name || <span className="italic text-muted-foreground">Not enrolled</span>}
            </p>
            <div className="grid grid-cols-2 gap-3 text-[11px]">
              <div>
                <p className="text-muted-foreground">Coaching received</p>
                <p className="font-mono">{coach.coach_used} / {fmtLimit(coach.coach_limit)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Peer received</p>
                <p className="font-mono">{coach.peer_used} / {fmtLimit(coach.peer_limit)}</p>
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Coaches assigned for this coach's coaching sessions ({picked.size})
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

// ============================================================
// BULK INVITE (coach + coachee, preview, resume)
// ============================================================

interface ParsedImportRow {
  Email?: string;
  email?: string;
  EMAIL?: string;
  Name?: string;
  name?: string;
  "Full name"?: string;
  Role?: string;
  role?: string;
  "Session limit"?: string | number;
  SessionLimit?: string | number;
  session_limit?: string | number;
  Limit?: string | number;
  "Assign coach email"?: string;
  assign_coach_email?: string;
  "Coach email"?: string;
}

function normalizeImportRow(row: ParsedImportRow, defaultRole: BulkInviteRole): BulkInviteRow {
  const email = String(row.Email || row.email || row.EMAIL || "").trim().toLowerCase();
  const full_name = String(row.Name || row.name || row["Full name"] || "").trim();
  const rawRole = String(row.Role || row.role || "").trim().toLowerCase();
  const role: BulkInviteRole = rawRole === "coach" || rawRole === "coachee" ? rawRole : defaultRole;
  const limitRaw = row["Session limit"] ?? row.SessionLimit ?? row.session_limit ?? row.Limit ?? "";
  const limitNum = Number(limitRaw);
  const session_limit = Number.isFinite(limitNum) && limitNum > 0 ? Math.floor(limitNum) : undefined;
  const assignCoachEmailRaw = String(row["Assign coach email"] || row.assign_coach_email || row["Coach email"] || "").trim();
  return {
    email,
    full_name,
    role,
    session_limit,
    assign_coach_email: role === "coachee" && assignCoachEmailRaw ? assignCoachEmailRaw.toLowerCase() : undefined,
  };
}

const PREVIEW_STATUS_LABEL: Record<PreviewStatus, string> = {
  valid: "Ready to invite",
  already_exists: "Already exists",
  bad_email: "Bad email",
  invalid_role: "Invalid role",
  duplicate_in_file: "Duplicate in file",
  coach_not_found: "Coach not found",
};

const PREVIEW_STATUS_TONE: Record<PreviewStatus, "default" | "secondary" | "destructive" | "outline"> = {
  valid: "default",
  already_exists: "outline",
  bad_email: "destructive",
  invalid_role: "destructive",
  duplicate_in_file: "destructive",
  coach_not_found: "destructive",
};

const SUBMIT_STATUS_LABEL: Record<SubmitStatus, string> = {
  invited: "Invited",
  skipped: "Skipped",
  failed: "Failed",
};

const SUBMIT_STATUS_TONE: Record<SubmitStatus, "default" | "secondary" | "destructive" | "outline"> = {
  invited: "default",
  skipped: "outline",
  failed: "destructive",
};

type BulkInviteStep = "form" | "preview" | "results" | "resume";

function BulkInviteDialog({
  open,
  defaultLimit,
  onClose,
  onDone,
}: {
  open: boolean;
  defaultLimit: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const { busy, dryRun, submit, fetchBatchRows, fetchRecentBatches } = useBulkInviteUsers();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // useAdminRegistrations' load() sets its `loading` flag while it refetches, and
  // AdminRegistrations early-returns a loader-only tree whenever that's true — which
  // unmounts this whole dialog, wiping the results/resume view back to the form step
  // the moment loading flips back off. Defer the reload to dialog close instead of
  // calling onDone() mid-flow, so the results the admin is looking at survive.
  const needsReloadRef = useRef(false);

  const [step, setStep] = useState<BulkInviteStep>("form");
  const [defaultRole, setDefaultRole] = useState<BulkInviteRole>("coachee");
  const [rows, setRows] = useState<BulkInviteRow[]>([]);
  const [preview, setPreview] = useState<PreviewResult[]>([]);
  const [submitResults, setSubmitResults] = useState<SubmitResult[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [recentBatches, setRecentBatches] = useState<BulkInviteBatch[]>([]);
  const [resumeBatchIdInput, setResumeBatchIdInput] = useState("");
  const [resumeRows, setResumeRows] = useState<BulkInviteRowRecord[]>([]);
  const [resumeBatchId, setResumeBatchId] = useState<string | null>(null);

  const reset = () => {
    setStep("form");
    setRows([]);
    setPreview([]);
    setSubmitResults([]);
    setBatchId(null);
    setResumeRows([]);
    setResumeBatchId(null);
    setResumeBatchIdInput("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  useEffect(() => {
    if (open) {
      reset();
      fetchRecentBatches().then(setRecentBatches).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleClose = () => {
    reset();
    onClose();
    if (needsReloadRef.current) {
      needsReloadRef.current = false;
      onDone();
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const XLSX = await import("xlsx");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const parsed = XLSX.utils.sheet_to_json<ParsedImportRow>(ws, { defval: "" });
    if (parsed.length === 0) {
      toast({ title: "Empty file", variant: "destructive" });
      return;
    }
    const normalized = parsed.map((r) => normalizeImportRow(r, defaultRole));
    setRows(normalized);
    try {
      const results = await dryRun(normalized);
      setPreview(results);
      setStep("preview");
    } catch (err) {
      toast({
        title: "Preview failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const downloadTemplate = async () => {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet([
      { Name: "Jane Doe", Email: "jane@example.com", Role: "coachee", "Session limit": 6, "Assign coach email": "" },
      { Name: "John Smith", Email: "john@example.com", Role: "coachee", "Session limit": 4, "Assign coach email": "coach@example.com" },
      { Name: "Alex Coach", Email: "alex@example.com", Role: "coach", "Session limit": "", "Assign coach email": "" },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Import");
    XLSX.writeFile(wb, "bulk-import-template.xlsx");
  };

  const backToForm = () => {
    setStep("form");
    setPreview([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const sendInvites = async () => {
    try {
      const { batch_id, results } = await submit(rows);
      setBatchId(batch_id);
      setSubmitResults(results);
      setStep("results");
      needsReloadRef.current = true;
      fetchRecentBatches().then(setRecentBatches).catch(() => {});
    } catch (err) {
      toast({
        title: "Send failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const retryFailed = async () => {
    if (!batchId) return;
    const failedIndexes = new Set(submitResults.filter((r) => r.status === "failed").map((r) => r.row_index));
    const retryRows: BulkInviteRow[] = submitResults
      .filter((r) => failedIndexes.has(r.row_index))
      .map((r) => ({ ...rows[r.row_index], row_id: r.row_id }));
    if (retryRows.length === 0) return;
    try {
      const { results } = await submit(retryRows, batchId);
      setSubmitResults((prev) => {
        const byIndex = new Map(prev.map((r) => [r.row_index, r]));
        for (const r of results) byIndex.set(r.row_index, r);
        return Array.from(byIndex.values()).sort((a, b) => a.row_index - b.row_index);
      });
      needsReloadRef.current = true;
    } catch (err) {
      toast({
        title: "Retry failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const loadBatch = async (id: string) => {
    try {
      const batchRows = await fetchBatchRows(id);
      setResumeRows(batchRows);
      setResumeBatchId(id);
      setStep("resume");
    } catch (err) {
      toast({
        title: "Could not load batch",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const resumePending = async () => {
    if (!resumeBatchId) return;
    const toResume = resumeRows.filter((r) => r.status === "pending" || r.status === "failed");
    if (toResume.length === 0) return;
    const resumeRequestRows: BulkInviteRow[] = toResume.map((r) => ({
      row_id: r.id,
      email: r.email ?? "",
      full_name: r.full_name ?? "",
      role: (r.role as BulkInviteRole) ?? "coachee",
      assign_coach_id: r.assign_coach_id ?? undefined,
      session_limit: r.session_limit ?? undefined,
    }));
    try {
      await submit(resumeRequestRows, resumeBatchId);
      await loadBatch(resumeBatchId);
      needsReloadRef.current = true;
      fetchRecentBatches().then(setRecentBatches).catch(() => {});
    } catch (err) {
      toast({
        title: "Resume failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const previewCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of preview) c[p.status] = (c[p.status] || 0) + 1;
    return c;
  }, [preview]);

  const submitCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of submitResults) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [submitResults]);

  const resumePendingCount = resumeRows.filter((r) => r.status === "pending" || r.status === "failed").length;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step !== "form" && step !== "resume" && (
              <button
                type="button"
                onClick={backToForm}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Back"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            Bulk import users
          </DialogTitle>
        </DialogHeader>

        {step === "form" && (
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              Upload an Excel file (.xlsx) with columns <code>Name</code>, <code>Email</code>, optionally{" "}
              <code>Role</code> (coach/coachee — falls back to the selector below if omitted),{" "}
              <code>Session limit</code> (coachees only, falls back to the platform default of {defaultLimit}), and{" "}
              <code>Assign coach email</code> (coachees only, optional). Every account gets an email invite to set
              their password; new accounts are pending admin approval, same as any other signup.
            </p>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Default role (used for rows without a Role column)
              </label>
              <Select value={defaultRole} onValueChange={(v) => setDefaultRole(v as BulkInviteRole)}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="coachee">Coachee</SelectItem>
                  <SelectItem value="coach">Coach</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={downloadTemplate}>
              <FileDown className="h-4 w-4" /> Download template
            </Button>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={onFile}
                disabled={busy}
                className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-primary-foreground hover:file:bg-primary/90"
              />
              {busy && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Validating rows…
                </p>
              )}
            </div>

            {recentBatches.length > 0 && (
              <div className="rounded-lg border p-3">
                <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  <History className="h-3.5 w-3.5" /> Recent batches
                </p>
                <div className="space-y-1">
                  {recentBatches.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => loadBatch(b.id)}
                      className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/50"
                    >
                      <span className="font-mono text-muted-foreground">{b.id.slice(0, 8)}…</span>
                      <span>{b.total_rows} rows</span>
                      <span className="text-muted-foreground">{format(new Date(b.created_at), "PP p")}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground">Or resume a batch by id:</p>
              <Input
                value={resumeBatchIdInput}
                onChange={(e) => setResumeBatchIdInput(e.target.value)}
                placeholder="batch id"
                className="h-8 flex-1 text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!resumeBatchIdInput.trim()}
                onClick={() => loadBatch(resumeBatchIdInput.trim())}
              >
                Load
              </Button>
            </div>
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              {Object.entries(previewCounts).map(([status, count]) => (
                <Badge key={status} variant={PREVIEW_STATUS_TONE[status as PreviewStatus]}>
                  {count} {PREVIEW_STATUS_LABEL[status as PreviewStatus]}
                </Badge>
              ))}
            </div>
            <div className="max-h-80 overflow-y-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/60 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Email</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((p) => (
                    <tr key={p.row_index} className="border-t">
                      <td className="px-3 py-2">{p.email}</td>
                      <td className="px-3 py-2">
                        <Badge variant={PREVIEW_STATUS_TONE[p.status]} className="text-[10px]">
                          {PREVIEW_STATUS_LABEL[p.status]}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{p.message ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Rows flagged above (bad email, duplicate, coach not found) will be skipped automatically — only rows
              marked "Ready to invite" or "Already exists" are acted on. Fix the file and re-upload, or send now and
              skip the flagged rows.
            </p>
          </div>
        )}

        {step === "results" && (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              {Object.entries(submitCounts).map(([status, count]) => (
                <Badge key={status} variant={SUBMIT_STATUS_TONE[status as SubmitStatus]}>
                  {count} {SUBMIT_STATUS_LABEL[status as SubmitStatus]}
                </Badge>
              ))}
            </div>
            <div className="max-h-80 overflow-y-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/60 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Email</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {submitResults.map((r) => (
                    <tr key={r.row_index} className="border-t">
                      <td className="px-3 py-2">{r.email}</td>
                      <td className="px-3 py-2">
                        <Badge variant={SUBMIT_STATUS_TONE[r.status]} className="text-[10px]">
                          {SUBMIT_STATUS_LABEL[r.status]}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{r.message ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {batchId && (
              <p className="text-xs text-muted-foreground">
                Batch id: <span className="font-mono">{batchId}</span> — closed the browser mid-run? Look this up
                later from the form step to resume.
              </p>
            )}
            {submitCounts.failed > 0 && (
              <Button variant="outline" onClick={retryFailed} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                Retry {submitCounts.failed} failed row{submitCounts.failed === 1 ? "" : "s"}
              </Button>
            )}
          </div>
        )}

        {step === "resume" && (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Batch <span className="font-mono">{resumeBatchId}</span> — {resumeRows.length} rows,{" "}
              {resumePendingCount} still pending or failed.
            </p>
            <div className="max-h-80 overflow-y-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/60 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Email</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {resumeRows.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="px-3 py-2">{r.email}</td>
                      <td className="px-3 py-2">
                        <Badge
                          variant={
                            r.status === "invited"
                              ? "default"
                              : r.status === "skipped"
                              ? "outline"
                              : r.status === "failed"
                              ? "destructive"
                              : "secondary"
                          }
                          className="text-[10px]"
                        >
                          {r.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{r.error_message ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Close
          </Button>
          {step === "preview" && (
            <Button onClick={sendInvites} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Send invites
            </Button>
          )}
          {step === "resume" && resumePendingCount > 0 && (
            <Button onClick={resumePending} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              Resume {resumePendingCount} row{resumePendingCount === 1 ? "" : "s"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

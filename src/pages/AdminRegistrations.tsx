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
import { useAdminRegistrations } from "@/hooks/admin/useAdminRegistrations";
import { useAdminRegistrationApprovals } from "@/hooks/admin/useAdminRegistrationApprovals";
import { useUpdateCoacheeAssignment } from "@/hooks/admin/useUpdateCoacheeAssignment";
import { useUpdateCoachAssignment } from "@/hooks/admin/useUpdateCoachAssignment";
import { useBulkImportCoachees } from "@/hooks/admin/useBulkImportCoachees";
import { CoachListRow, CoachOpt, CoacheeRow, Status } from "@/hooks/admin/types";

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
  const {
    loading,
    coachees,
    coaches,
    coachOpts,
    defaultLimit,
    defaultCoachLimit,
    defaultPeerLimit,
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { importRows } = useBulkImportCoachees(() => {
    setImportOpen(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    load();
  });

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
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
    await importRows(rows);
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
          Manage all coaches and coachees.
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
                        <span className={c.coach_used >= c.coach_limit ? "font-semibold text-destructive" : ""}>
                          {c.coach_used} / {c.coach_limit}
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
                        <span className={c.peer_used >= c.peer_limit ? "font-semibold text-destructive" : ""}>
                          {c.peer_used} / {c.peer_limit}
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
        defaultCoachLimit={defaultCoachLimit}
        defaultPeerLimit={defaultPeerLimit}
        onClose={() => setEditingCoach(null)}
        onSaved={() => {
          setEditingCoach(null);
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
  defaultCoachLimit,
  defaultPeerLimit,
  onClose,
  onSaved,
}: {
  coach: CoachListRow | null;
  coachOpts: CoachOpt[];
  defaultCoachLimit: number;
  defaultPeerLimit: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [coachLimit, setCoachLimit] = useState<number>(defaultCoachLimit);
  const [peerLimit, setPeerLimit] = useState<number>(defaultPeerLimit);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const { saving, save: saveAssignment } = useUpdateCoachAssignment();

  useEffect(() => {
    if (coach) {
      setCoachLimit(coach.coach_limit);
      setPeerLimit(coach.peer_limit);
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
    const ok = await saveAssignment(
      { id: coach.id, limit_row_id: coach.limit_row_id },
      coachLimit,
      peerLimit,
      picked
    );
    if (ok) onSaved();
  };

  return (
    <Dialog open={!!coach} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {coach.full_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Coach session limit (total)
              </label>
              <Input
                type="number"
                min={0}
                max={500}
                value={coachLimit}
                onChange={(e) => setCoachLimit(Number(e.target.value))}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Used: {coach.coach_used}
              </p>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Peer session limit (total)
              </label>
              <Input
                type="number"
                min={0}
                max={500}
                value={peerLimit}
                onChange={(e) => setPeerLimit(Number(e.target.value))}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Used: {coach.peer_used}
              </p>
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

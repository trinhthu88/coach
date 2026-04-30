import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { Loader2, Search, ExternalLink, Pencil, Save, AlertCircle, Star } from "lucide-react";
import { format } from "date-fns";

const STATUSES = [
  "pending_coach_approval",
  "scheduled",
  "completed",
  "cancelled",
  "rejected",
] as const;

interface SessionRow {
  id: string;
  topic: string;
  start_time: string;
  duration_minutes: number;
  status: string;
  meeting_url: string | null;
  coach_notes: string | null;
  coach_private_notes: string | null;
  coachee_notes: string | null;
  coach_id: string;
  coachee_id: string;
  created_at: string;
  coachee_rating: number | null;
  coachee_rating_comment: string | null;
  coach?: { full_name: string; email: string };
  coachee?: { full_name: string; email: string };
}

export default function AdminSessions() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<SessionRow | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: sessions } = await supabase
      .from("sessions")
      .select("*")
      .order("start_time", { ascending: false });

    const userIds = Array.from(
      new Set((sessions ?? []).flatMap((s) => [s.coach_id, s.coachee_id]))
    );
    let profilesById: Record<string, any> = {};
    if (userIds.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds);
      profilesById = Object.fromEntries((profs ?? []).map((p) => [p.id, p]));
    }
    setRows(
      (sessions ?? []).map((s: any) => ({
        ...s,
        coach: profilesById[s.coach_id],
        coachee: profilesById[s.coachee_id],
      }))
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = rows.filter((r) => {
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      r.topic.toLowerCase().includes(q) ||
      (r.coach?.full_name ?? "").toLowerCase().includes(q) ||
      (r.coachee?.full_name ?? "").toLowerCase().includes(q)
    );
  });

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("sessions")
        .update({
          topic: editing.topic,
          start_time: editing.start_time,
          duration_minutes: editing.duration_minutes,
          status: editing.status as any,
          meeting_url: editing.meeting_url,
          coach_notes: editing.coach_notes,
          coachee_notes: editing.coachee_notes,
        })
        .eq("id", editing.id);
      if (error) throw error;
      toast({ title: "Session updated" });
      setEditing(null);
      await load();
    } catch (err: any) {
      toast({
        title: "Save failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
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
        <h1 className="text-3xl font-semibold tracking-tight">All sessions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {rows.length} session{rows.length === 1 ? "" : "s"} across the platform.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search topic, coach or coachee"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No sessions match your filters.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Topic</TableHead>
                <TableHead>Coach</TableHead>
                <TableHead>Coachee</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Link</TableHead>
                <TableHead>Rating</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((s) => {
                const missingLink =
                  !s.meeting_url &&
                  ["pending_coach_approval", "confirmed"].includes(s.status);
                return (
                  <TableRow
                    key={s.id}
                    className={
                      missingLink
                        ? "bg-warning/10 hover:bg-warning/15"
                        : undefined
                    }
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {missingLink && (
                          <AlertCircle className="h-4 w-4 shrink-0 text-warning" />
                        )}
                        {s.topic}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{s.coach?.full_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{s.coach?.email}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{s.coachee?.full_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{s.coachee?.email}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {format(new Date(s.start_time), "PP")}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {format(new Date(s.start_time), "p")} · {s.duration_minutes} min
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="capitalize">
                        {s.status.replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {s.meeting_url ? (
                        <a
                          href={s.meeting_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          Open <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <Badge
                          variant="outline"
                          className="gap-1 border-warning/40 text-warning"
                        >
                          <AlertCircle className="h-3 w-3" /> Missing
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {s.coachee_rating ? (
                        <span
                          title={s.coachee_rating_comment || ""}
                          className="inline-flex items-center gap-1 text-sm font-semibold"
                        >
                          <Star className="h-3.5 w-3.5 fill-warning text-warning" />
                          {s.coachee_rating}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => setEditing(s)}>
                        <Pencil className="h-4 w-4" /> Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit session</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Topic</Label>
                <Input
                  value={editing.topic}
                  onChange={(e) => setEditing({ ...editing, topic: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Start time</Label>
                  <Input
                    type="datetime-local"
                    value={format(new Date(editing.start_time), "yyyy-MM-dd'T'HH:mm")}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        start_time: new Date(e.target.value).toISOString(),
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Duration (min)</Label>
                  <Input
                    type="number"
                    min={15}
                    value={editing.duration_minutes}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        duration_minutes: Number(e.target.value),
                      })
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={editing.status}
                  onValueChange={(v) => setEditing({ ...editing, status: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Meeting URL</Label>
                <Input
                  value={editing.meeting_url ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, meeting_url: e.target.value })
                  }
                  placeholder="https://…"
                />
              </div>
              <div className="space-y-2">
                <Label>Coach notes</Label>
                <Textarea
                  rows={3}
                  value={editing.coach_notes ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, coach_notes: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Coachee notes</Label>
                <Textarea
                  rows={3}
                  value={editing.coachee_notes ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, coachee_notes: e.target.value })
                  }
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

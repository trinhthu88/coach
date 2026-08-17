import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
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
import type { Tables } from "@/integrations/supabase/types";
import { PageHeader } from "@/components/ui/page-header";
import { TablePager } from "./admin/_shared";
import { getFriendlyErrorMessage } from "@/lib/errors";

const PAGE_SIZE = 25;

const STATUSES = [
  "pending_coach_approval",
  "confirmed",
  "completed",
  "cancelled",
  "rescheduled",
] as const;

interface SessionRow {
  id: string;
  topic: string;
  start_time: string;
  duration_minutes: number;
  status: string;
  meeting_url: string | null;
  coach_notes: string | null;
  coachee_notes: string | null;
  coach_id: string;
  coachee_id: string;
  created_at: string;
  coachee_rating: number | null;
  coachee_rating_comment: string | null;
  kind: "coaching" | "peer";
  coach?: { full_name: string; email: string };
  coachee?: { full_name: string; email: string };
}

export default function AdminSessions() {
  const { t } = useTranslation("admin");
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<SessionRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: sessions }, { data: peerSessions }] = await Promise.all([
      supabase.from("sessions").select("*").order("start_time", { ascending: false }),
      supabase.from("peer_sessions").select("*").order("start_time", { ascending: false }),
    ]);

    type RawRow = (Tables<"sessions"> | Tables<"peer_sessions">) & {
      kind: "coaching" | "peer";
      coach_id: string;
      coachee_id: string;
    };
    const coaching: RawRow[] = (sessions || []).map((s) => ({ ...s, kind: "coaching" as const, coach_id: s.coach_id, coachee_id: s.coachee_id }));
    const peer: RawRow[] = (peerSessions || []).map((s) => ({
      ...s,
      kind: "peer" as const,
      coach_id: s.peer_coach_id,
      coachee_id: s.peer_coachee_id,
    }));
    const all = [...coaching, ...peer].sort((a, b) => +new Date(b.start_time) - +new Date(a.start_time));

    const userIds = Array.from(new Set(all.flatMap((s) => [s.coach_id, s.coachee_id])));
    let profilesById: Record<string, Pick<Tables<"profiles">, "full_name" | "email">> = {};
    if (userIds.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds);
      profilesById = Object.fromEntries((profs ?? []).map((p) => [p.id, p]));
    }
    setRows(all.map((s) => ({
      ...s,
      coach: profilesById[s.coach_id],
      coachee: profilesById[s.coachee_id],
    })) as SessionRow[]);
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

  useEffect(() => { setPage(1); }, [search, statusFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const paged = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  const editingOriginal = editing ? rows.find((r) => r.id === editing.id) : undefined;
  const isCancelling = !!editing && editing.status === "cancelled" && editingOriginal?.status !== "cancelled";

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const table = editing.kind === "peer" ? "peer_sessions" : "sessions";

      if (isCancelling) {
        // Routes through cancel-session so the coach's availability slot is
        // freed and both parties get a cancellation email — a plain status
        // update here would silently skip both, same bug the dashboard
        // "Decline" button had.
        const { error: cancelError } = await supabase.functions.invoke("cancel-session", {
          body: { session_id: editing.id, is_peer: editing.kind === "peer", reason: cancelReason || undefined },
        });
        if (cancelError) throw cancelError;
      }

      const { error } = await supabase
        .from(table)
        .update({
          topic: editing.topic,
          start_time: editing.start_time,
          duration_minutes: editing.duration_minutes,
          // Already set by cancel-session above when isCancelling; for every
          // other transition (including staying cancelled) a plain status
          // write is fine — there's no side effect to replicate.
          ...(isCancelling ? {} : { status: editing.status as Tables<"sessions">["status"] }),
          meeting_url: editing.meeting_url,
          coach_notes: editing.coach_notes,
          coachee_notes: editing.coachee_notes,
        })
        .eq("id", editing.id);
      if (error) throw error;
      toast({ title: t("sessions.sessionUpdated") });
      setEditing(null);
      setCancelReason("");
      await load();
    } catch (err) {
      toast({
        title: t("sessions.saveFailed"),
        description: getFriendlyErrorMessage(err, t),
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
      <PageHeader
        eyebrow={t("sessions.eyebrow")}
        title={t("sessions.titleAll")}
        emphasis={t("sessions.titleEmphasis")}
        subtitle={t("sessions.subtitle", { count: rows.length })}
      />

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("sessions.searchPlaceholder")}
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
            <SelectItem value="all">{t("sessions.allStatuses")}</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`sessions.statusLabels.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            {t("sessions.noMatch")}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("sessions.tableHeaders.type")}</TableHead>
                <TableHead>{t("sessions.tableHeaders.topic")}</TableHead>
                <TableHead>{t("sessions.tableHeaders.coach")}</TableHead>
                <TableHead>{t("sessions.tableHeaders.coachee")}</TableHead>
                <TableHead>{t("sessions.tableHeaders.when")}</TableHead>
                <TableHead>{t("sessions.tableHeaders.status")}</TableHead>
                <TableHead>{t("sessions.tableHeaders.link")}</TableHead>
                <TableHead>{t("sessions.tableHeaders.rating")}</TableHead>
                <TableHead className="text-right">{t("sessions.tableHeaders.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.map((s) => {
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
                    <TableCell>
                      <Badge variant={s.kind === "peer" ? "outline" : "secondary"} className="text-[10px]">
                        {s.kind === "peer" ? t("sessions.kindPeer") : t("sessions.kindCoaching")}
                      </Badge>
                    </TableCell>
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
                        {t(`sessions.statusLabels.${s.status}`)}
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
                          {t("sessions.open")} <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <Badge
                          variant="outline"
                          className="gap-1 border-warning/40 text-warning"
                        >
                          <AlertCircle className="h-3 w-3" /> {t("sessions.missing")}
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
                      <Button variant="outline" size="sm" onClick={() => { setEditing(s); setCancelReason(""); }}>
                        <Pencil className="h-4 w-4" /> {t("sessions.edit")}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <TablePager page={pageSafe} totalPages={totalPages} onChange={setPage} />
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("sessions.editDialogTitle")}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t("sessions.topicLabel")}</Label>
                <Input
                  value={editing.topic}
                  onChange={(e) => setEditing({ ...editing, topic: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("sessions.startTimeLabel")}</Label>
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
                  <Label>{t("sessions.durationLabel")}</Label>
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
                <Label>{t("sessions.statusLabel")}</Label>
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
                        {t(`sessions.statusLabels.${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {isCancelling && (
                <div className="space-y-2">
                  <Label>{t("sessions.cancellationReasonLabel")}</Label>
                  <Textarea
                    rows={2}
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder={t("sessions.cancellationReasonPlaceholder")}
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label>{t("sessions.meetingUrlLabel")}</Label>
                <Input
                  value={editing.meeting_url ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, meeting_url: e.target.value })
                  }
                  placeholder="https://…"
                />
              </div>
              <div className="space-y-2">
                <Label>{t("sessions.coachNotesLabel")}</Label>
                <Textarea
                  rows={3}
                  value={editing.coach_notes ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, coach_notes: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>{t("sessions.coacheeNotesLabel")}</Label>
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
              {t("sessions.cancel")}
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {t("sessions.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

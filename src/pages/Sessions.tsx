import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Calendar,
  Clock,
  Loader2,
  Video,
  Paperclip,
  Upload,
  X,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format, isAfter, addHours } from "date-fns";

type SessionStatus =
  | "pending_coach_approval"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "rescheduled";

interface SessionRow {
  id: string;
  coach_id: string;
  coachee_id: string;
  topic: string;
  start_time: string;
  duration_minutes: number;
  status: SessionStatus;
  meeting_url: string | null;
  coach_notes: string | null;
  coach_private_notes: string | null;
  coachee_notes: string | null;
  action_items: any;
  cancelled_at: string | null;
  slot_id: string | null;
  coach: { full_name: string; email: string; avatar_url: string | null } | null;
  coachee: { full_name: string; email: string; avatar_url: string | null } | null;
}

interface Attachment {
  id: string;
  session_id: string;
  uploaded_by: string;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  file_size_bytes: number | null;
  created_at: string;
}

const STATUS_META: Record<SessionStatus, { label: string; variant: any; icon: any }> = {
  pending_coach_approval: { label: "Awaiting confirmation", variant: "secondary", icon: AlertCircle },
  confirmed: { label: "Confirmed", variant: "default", icon: CheckCircle2 },
  completed: { label: "Completed", variant: "outline", icon: CheckCircle2 },
  cancelled: { label: "Cancelled", variant: "destructive", icon: XCircle },
  rescheduled: { label: "Rescheduled", variant: "secondary", icon: Clock },
};

export default function Sessions() {
  const { user, role } = useAuth();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("upcoming");
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const filterCol = role === "coach" ? "coach_id" : "coachee_id";
    const { data } = await supabase
      .from("sessions")
      .select("*")
      .eq(filterCol, user.id)
      .order("start_time", { ascending: false });

    if (!data) {
      setSessions([]);
      setLoading(false);
      return;
    }

    const ids = Array.from(new Set([...data.map((s) => s.coach_id), ...data.map((s) => s.coachee_id)]));
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, email, avatar_url")
      .in("id", ids);
    const byId = new Map((profs || []).map((p) => [p.id, p]));

    setSessions(
      data.map((s: any) => ({
        ...s,
        coach: byId.get(s.coach_id) || null,
        coachee: byId.get(s.coachee_id) || null,
      })) as SessionRow[]
    );
    setLoading(false);
  }, [user, role]);

  useEffect(() => {
    load();
  }, [load]);

  const now = new Date();
  const upcoming = sessions.filter(
    (s) => s.status !== "cancelled" && s.status !== "completed" && new Date(s.start_time) >= now
  );
  const past = sessions.filter(
    (s) => s.status === "completed" || s.status === "cancelled" || new Date(s.start_time) < now
  );

  const detail = sessions.find((s) => s.id === detailId) || null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <Calendar className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sessions</h1>
          <p className="text-sm text-muted-foreground">
            {role === "coach"
              ? "Confirm requests, manage notes and meeting links."
              : "Track upcoming bookings, notes and action items."}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="upcoming">Upcoming ({upcoming.length})</TabsTrigger>
            <TabsTrigger value="past">Past ({past.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="upcoming" className="mt-4 space-y-3">
            {upcoming.length === 0 ? (
              <EmptyState
                title="No upcoming sessions"
                subtitle={role === "coachee" ? "Browse coaches and book your next session." : "You're all caught up."}
              />
            ) : (
              upcoming.map((s) => (
                <SessionCard key={s.id} session={s} role={role!} onOpen={() => setDetailId(s.id)} />
              ))
            )}
          </TabsContent>
          <TabsContent value="past" className="mt-4 space-y-3">
            {past.length === 0 ? (
              <EmptyState title="Nothing yet" subtitle="Past sessions will show up here." />
            ) : (
              past.map((s) => (
                <SessionCard key={s.id} session={s} role={role!} onOpen={() => setDetailId(s.id)} />
              ))
            )}
          </TabsContent>
        </Tabs>
      )}

      {detail && (
        <SessionDetailDialog
          session={detail}
          role={role!}
          onClose={() => setDetailId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <Card className="p-12 text-center">
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
    </Card>
  );
}

function SessionCard({
  session,
  role,
  onOpen,
}: {
  session: SessionRow;
  role: "coach" | "coachee" | "admin";
  onOpen: () => void;
}) {
  const meta = STATUS_META[session.status];
  const Icon = meta.icon;
  const counterpart = role === "coach" ? session.coachee : session.coach;
  const start = new Date(session.start_time);

  return (
    <Card
      className="group flex cursor-pointer items-center justify-between gap-4 p-5 transition-colors hover:border-primary/40"
      onClick={onOpen}
    >
      <div className="flex min-w-0 items-center gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary font-bold">
          {(counterpart?.full_name || "?").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="truncate font-semibold">{session.topic}</p>
          <p className="truncate text-sm text-muted-foreground">
            with {counterpart?.full_name || counterpart?.email || "—"}
          </p>
          <p className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {format(start, "EEE, MMM d · p")}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" /> {session.duration_minutes} min
            </span>
          </p>
        </div>
      </div>
      <Badge variant={meta.variant} className="shrink-0">
        <Icon className="mr-1 h-3 w-3" /> {meta.label}
      </Badge>
    </Card>
  );
}

function SessionDetailDialog({
  session,
  role,
  onClose,
  onChanged,
}: {
  session: SessionRow;
  role: "coach" | "coachee" | "admin";
  onClose: () => void;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const [coachNotes, setCoachNotes] = useState(session.coach_notes || "");
  const [coachPrivate, setCoachPrivate] = useState(session.coach_private_notes || "");
  const [coacheeNotes, setCoacheeNotes] = useState(session.coachee_notes || "");
  const [meetingUrl, setMeetingUrl] = useState(session.meeting_url || "");
  const [actionItems, setActionItems] = useState<string[]>(
    Array.isArray(session.action_items) ? session.action_items : []
  );
  const [newItem, setNewItem] = useState("");
  const [saving, setSaving] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("session_attachments")
        .select("*")
        .eq("session_id", session.id)
        .order("created_at", { ascending: false });
      setAttachments((data as Attachment[]) || []);
    })();
  }, [session.id]);

  const start = new Date(session.start_time);
  const canCancel =
    session.status !== "cancelled" &&
    session.status !== "completed" &&
    isAfter(start, addHours(new Date(), 24));

  const isCoach = role === "coach" && session.coach_id === user?.id;
  const isCoachee = role === "coachee" && session.coachee_id === user?.id;
  const isAdmin = role === "admin";

  const save = async () => {
    setSaving(true);
    const update: any = {
      action_items: actionItems,
    };
    if (isCoach || isAdmin) {
      update.coach_notes = coachNotes;
      update.coach_private_notes = coachPrivate;
      update.meeting_url = meetingUrl || null;
    }
    if (isCoachee || isAdmin) {
      update.coachee_notes = coacheeNotes;
    }
    const { error } = await supabase.from("sessions").update(update).eq("id", session.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Saved");
    onChanged();
  };

  const confirmSession = async () => {
    if (!meetingUrl.trim()) {
      toast.error("Add a Zoom or Google Meet link before confirming.");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("sessions")
      .update({
        status: "confirmed",
        meeting_url: meetingUrl,
        confirmed_at: new Date().toISOString(),
      })
      .eq("id", session.id);
    if (!error && session.slot_id) {
      await supabase
        .from("coach_availability")
        .update({ is_booked: true, session_id: session.id })
        .eq("id", session.slot_id);
    }
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Session confirmed");
    onChanged();
    onClose();
  };

  const cancelSession = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("sessions")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancelled_by: user?.id,
      })
      .eq("id", session.id);
    if (!error && session.slot_id) {
      await supabase
        .from("coach_availability")
        .update({ is_booked: false, session_id: null })
        .eq("id", session.slot_id);
    }
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Session cancelled");
    onChanged();
    onClose();
  };

  const completeSession = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("sessions")
      .update({ status: "completed" })
      .eq("id", session.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Marked complete");
    onChanged();
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploading(true);
    const path = `${session.id}/${crypto.randomUUID()}-${file.name}`;
    const { error: upErr } = await supabase.storage
      .from("session-attachments")
      .upload(path, file);
    if (upErr) {
      setUploading(false);
      toast.error(upErr.message);
      return;
    }
    const { data, error: insErr } = await supabase
      .from("session_attachments")
      .insert({
        session_id: session.id,
        uploaded_by: user.id,
        file_name: file.name,
        storage_path: path,
        mime_type: file.type,
        file_size_bytes: file.size,
      })
      .select()
      .single();
    setUploading(false);
    e.target.value = "";
    if (insErr) {
      toast.error(insErr.message);
      return;
    }
    setAttachments((prev) => [data as Attachment, ...prev]);
    toast.success("File uploaded");
  };

  const downloadAttachment = async (a: Attachment) => {
    const { data, error } = await supabase.storage
      .from("session-attachments")
      .createSignedUrl(a.storage_path, 60);
    if (error || !data) {
      toast.error("Could not generate link");
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  const removeAttachment = async (a: Attachment) => {
    await supabase.storage.from("session-attachments").remove([a.storage_path]);
    await supabase.from("session_attachments").delete().eq("id", a.id);
    setAttachments((prev) => prev.filter((x) => x.id !== a.id));
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{session.topic}</DialogTitle>
          <DialogDescription>
            {format(start, "EEEE, MMMM d · p")} · {session.duration_minutes} min
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={STATUS_META[session.status].variant}>
              {STATUS_META[session.status].label}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {role === "coach" ? "Coachee" : "Coach"}:{" "}
              <strong className="text-foreground">
                {(role === "coach" ? session.coachee : session.coach)?.full_name || "—"}
              </strong>
            </span>
          </div>

          {session.meeting_url && session.status === "confirmed" && (
            <a
              href={session.meeting_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-primary-soft px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10"
            >
              <Video className="h-4 w-4" /> Join meeting
            </a>
          )}

          {(isCoach || isAdmin) && (
            <Field label="Meeting link (Zoom or Google Meet)">
              <Input
                value={meetingUrl}
                onChange={(e) => setMeetingUrl(e.target.value)}
                placeholder="https://meet.google.com/..."
              />
            </Field>
          )}

          {(isCoach || isAdmin) && (
            <>
              <Field label="Coach notes (visible to coachee)">
                <Textarea value={coachNotes} onChange={(e) => setCoachNotes(e.target.value)} rows={3} />
              </Field>
              <Field label="Private notes (only you can see)">
                <Textarea
                  value={coachPrivate}
                  onChange={(e) => setCoachPrivate(e.target.value)}
                  rows={3}
                />
              </Field>
            </>
          )}

          {(isCoachee || isAdmin) && (
            <Field label="Coachee notes / reflections">
              <Textarea
                value={coacheeNotes}
                onChange={(e) => setCoacheeNotes(e.target.value)}
                rows={3}
              />
            </Field>
          )}

          <Field label="Action items">
            <div className="space-y-2">
              {actionItems.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-1.5 text-sm">
                  <span className="flex-1">{item}</span>
                  <button
                    type="button"
                    onClick={() => setActionItems(actionItems.filter((_, i) => i !== idx))}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <Input
                  value={newItem}
                  onChange={(e) => setNewItem(e.target.value)}
                  placeholder="Add an action item"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newItem.trim()) {
                      e.preventDefault();
                      setActionItems([...actionItems, newItem.trim()]);
                      setNewItem("");
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (newItem.trim()) {
                      setActionItems([...actionItems, newItem.trim()]);
                      setNewItem("");
                    }
                  }}
                >
                  Add
                </Button>
              </div>
            </div>
          </Field>

          <Field label="Attachments">
            <div className="space-y-2">
              {attachments.map((a) => (
                <div key={a.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                  <Paperclip className="h-4 w-4 text-muted-foreground" />
                  <button
                    type="button"
                    onClick={() => downloadAttachment(a)}
                    className="flex-1 truncate text-left hover:text-primary"
                  >
                    {a.file_name}
                  </button>
                  {a.uploaded_by === user?.id && (
                    <button
                      type="button"
                      onClick={() => removeAttachment(a)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed py-3 text-sm text-muted-foreground hover:bg-muted/30">
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                Add attachment
                <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
              </label>
            </div>
          </Field>
        </div>

        <DialogFooter className="flex-wrap gap-2">
          {isCoach && session.status === "pending_coach_approval" && (
            <Button onClick={confirmSession} disabled={saving}>
              <CheckCircle2 className="mr-1 h-4 w-4" /> Confirm session
            </Button>
          )}
          {isCoach && session.status === "confirmed" && new Date(session.start_time) < new Date() && (
            <Button onClick={completeSession} variant="secondary" disabled={saving}>
              Mark complete
            </Button>
          )}
          {canCancel && (
            <Button variant="destructive" onClick={cancelSession} disabled={saving}>
              Cancel session
            </Button>
          )}
          {!canCancel &&
            session.status !== "cancelled" &&
            session.status !== "completed" &&
            isCoachee && (
              <span className="mr-auto text-xs text-muted-foreground">
                Cancellations require 24h notice.
              </span>
            )}
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

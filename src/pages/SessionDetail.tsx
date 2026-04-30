import { useEffect, useState, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  ArrowLeft,
  Calendar as CalIcon,
  Clock,
  Loader2,
  Video,
  Save,
  Paperclip,
  Upload,
  X,
  CheckSquare,
  Square,
  FileText,
  MessageSquare,
  CheckCircle2,
  XCircle,
  AlertCircle,
  HelpCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format, isAfter, addHours } from "date-fns";

type SessionStatus =
  | "pending_coach_approval"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "rescheduled";

interface ProfileLite {
  id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
}

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
}

interface ActionItem {
  text: string;
  done?: boolean;
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

const STATUS_META: Record<
  SessionStatus,
  { label: string; className: string; icon: any }
> = {
  pending_coach_approval: {
    label: "Awaiting confirmation",
    className: "bg-warning/10 text-warning border-warning/20",
    icon: AlertCircle,
  },
  confirmed: {
    label: "Confirmed",
    className: "bg-primary/10 text-primary border-primary/20",
    icon: CheckCircle2,
  },
  completed: {
    label: "Completed",
    className: "bg-success/10 text-success border-success/20",
    icon: CheckCircle2,
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-destructive/10 text-destructive border-destructive/20",
    icon: XCircle,
  },
  rescheduled: {
    label: "Rescheduled",
    className: "bg-secondary text-secondary-foreground border-border",
    icon: Clock,
  },
};

function normalizeItems(raw: any): ActionItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((it) =>
    typeof it === "string" ? { text: it, done: false } : { text: it.text || "", done: !!it.done }
  );
}

export default function SessionDetail() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { user, role } = useAuth();
  const [session, setSession] = useState<SessionRow | null>(null);
  const [coach, setCoach] = useState<ProfileLite | null>(null);
  const [coachee, setCoachee] = useState<ProfileLite | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [coachNotes, setCoachNotes] = useState("");
  const [coachPrivate, setCoachPrivate] = useState("");
  const [coacheeNotes, setCoacheeNotes] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [items, setItems] = useState<ActionItem[]>([]);
  const [newItem, setNewItem] = useState("");

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    if (!sessionId) return;
    const { data } = await supabase.from("sessions").select("*").eq("id", sessionId).maybeSingle();
    if (!data) {
      setLoading(false);
      return;
    }
    setSession(data as SessionRow);
    setCoachNotes((data as any).coach_notes || "");
    setCoachPrivate((data as any).coach_private_notes || "");
    setCoacheeNotes((data as any).coachee_notes || "");
    setMeetingUrl((data as any).meeting_url || "");
    setItems(normalizeItems((data as any).action_items));

    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, email, avatar_url")
      .in("id", [(data as any).coach_id, (data as any).coachee_id]);
    const byId = new Map((profs || []).map((p) => [p.id, p]));
    setCoach((byId.get((data as any).coach_id) as ProfileLite) || null);
    setCoachee((byId.get((data as any).coachee_id) as ProfileLite) || null);

    const { data: atts } = await supabase
      .from("session_attachments")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false });
    setAttachments((atts as Attachment[]) || []);

    setLoading(false);
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!session) {
    return (
      <Card className="p-12 text-center">
        <h2 className="text-xl font-semibold">Session not found</h2>
        <Button asChild variant="outline" className="mt-6">
          <Link to="/sessions">Back to sessions</Link>
        </Button>
      </Card>
    );
  }

  const isCoach = role === "coach" && session.coach_id === user?.id;
  const isCoachee = role === "coachee" && session.coachee_id === user?.id;
  const isAdmin = role === "admin";

  const start = new Date(session.start_time);
  const meta = STATUS_META[session.status];
  const StatusIcon = meta.icon;
  const canCancel =
    session.status !== "cancelled" &&
    session.status !== "completed" &&
    isAfter(start, addHours(new Date(), 24));

  const saveProgress = async () => {
    setSaving(true);
    const update: any = { action_items: items };
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
    toast.success("Progress saved");
    load();
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
    if (error) return toast.error(error.message);
    toast.success("Session confirmed");
    load();
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
    if (error) return toast.error(error.message);
    toast.success("Session cancelled");
    navigate("/sessions");
  };

  const completeSession = async () => {
    setSaving(true);
    const { error } = await supabase.from("sessions").update({ status: "completed" }).eq("id", session.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Marked complete");
    load();
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploading(true);
    const path = `${session.id}/${crypto.randomUUID()}-${file.name}`;
    const { error: upErr } = await supabase.storage.from("session-attachments").upload(path, file);
    if (upErr) {
      setUploading(false);
      return toast.error(upErr.message);
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
    if (insErr) return toast.error(insErr.message);
    setAttachments((prev) => [data as Attachment, ...prev]);
    toast.success("File uploaded");
  };

  const downloadAttachment = async (a: Attachment) => {
    const { data, error } = await supabase.storage
      .from("session-attachments")
      .createSignedUrl(a.storage_path, 60);
    if (error || !data) return toast.error("Could not generate link");
    window.open(data.signedUrl, "_blank");
  };

  const removeAttachment = async (a: Attachment) => {
    await supabase.storage.from("session-attachments").remove([a.storage_path]);
    await supabase.from("session_attachments").delete().eq("id", a.id);
    setAttachments((prev) => prev.filter((x) => x.id !== a.id));
  };

  const toggleItem = (idx: number) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, done: !it.done } : it)));
  };

  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const addItem = () => {
    if (!newItem.trim()) return;
    setItems((prev) => [...prev, { text: newItem.trim(), done: false }]);
    setNewItem("");
  };

  const sessionShortId = session.id.slice(0, 4).toUpperCase();
  const initials = (n?: string | null) =>
    (n || "?").split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="space-y-6">
      <Link
        to="/sessions"
        className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to sessions
      </Link>

      {/* Hero */}
      <Card className="p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest",
                  meta.className
                )}
              >
                <StatusIcon className="h-3 w-3" /> {meta.label}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Session ID: {sessionShortId}
              </span>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">{session.topic}</h1>
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <CalIcon className="h-4 w-4 text-primary" />
                {format(start, "M/d/yyyy")}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-primary" />
                {format(start, "p")} ({session.duration_minutes}m)
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {session.meeting_url && session.status === "confirmed" && (
              <Button asChild>
                <a href={session.meeting_url} target="_blank" rel="noreferrer">
                  <Video className="mr-1 h-4 w-4" /> Join meeting
                </a>
              </Button>
            )}
            {(isCoach || isCoachee || isAdmin) && (
              <Button variant="outline" onClick={saveProgress} disabled={saving}>
                {saving ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-1 h-4 w-4" />
                )}
                Save progress
              </Button>
            )}
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Coach notes */}
        <Card className="space-y-3 p-5">
          <div className="flex items-center justify-between">
            <SectionTitle icon={FileText}>Coach notes</SectionTitle>
            {!isCoach && !isAdmin && (
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Read only
              </span>
            )}
          </div>
          <Textarea
            value={coachNotes}
            onChange={(e) => setCoachNotes(e.target.value)}
            rows={8}
            disabled={!(isCoach || isAdmin)}
            placeholder={
              isCoach || isAdmin ? "Write notes visible to the coachee..." : "Coach hasn't added notes yet."
            }
          />
          {(isCoach || isAdmin) && (
            <Textarea
              value={coachPrivate}
              onChange={(e) => setCoachPrivate(e.target.value)}
              rows={3}
              placeholder="Private notes (only you can see)"
              className="bg-muted/30"
            />
          )}
        </Card>

        {/* Coachee reflections */}
        <Card className="space-y-3 p-5">
          <div className="flex items-center justify-between">
            <SectionTitle icon={MessageSquare}>Coachee reflections</SectionTitle>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest",
                isCoachee || isAdmin
                  ? "bg-success/10 text-success"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {isCoachee || isAdmin ? <CheckCircle2 className="h-3 w-3" /> : null}
              {isCoachee || isAdmin ? "Editable" : "Read only"}
            </span>
          </div>
          <Textarea
            value={coacheeNotes}
            onChange={(e) => setCoacheeNotes(e.target.value)}
            rows={11}
            disabled={!(isCoachee || isAdmin)}
            placeholder={
              isCoachee || isAdmin
                ? "Capture your reflections, takeaways and questions..."
                : "Coachee hasn't shared reflections yet."
            }
            className={cn((isCoachee || isAdmin) && "border-success/40 focus-visible:ring-success/30")}
          />
        </Card>

        {/* Right column: action items + attachments + meeting */}
        <div className="space-y-6">
          <Card className="space-y-3 p-5">
            <SectionTitle icon={CheckSquare}>Action items</SectionTitle>
            <ul className="space-y-2">
              {items.map((it, idx) => (
                <li key={idx} className="flex items-center gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() => toggleItem(idx)}
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                      it.done
                        ? "border-success bg-success/10 text-success"
                        : "border-border text-transparent"
                    )}
                    aria-label={it.done ? "Mark incomplete" : "Mark complete"}
                  >
                    <CheckSquare className="h-3.5 w-3.5" />
                  </button>
                  <span className={cn("flex-1", it.done && "text-muted-foreground line-through")}>
                    {it.text}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeItem(idx)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Input
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                placeholder="Add new action item..."
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addItem();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addItem}>
                Add
              </Button>
            </div>
          </Card>

          {(isCoach || isAdmin) && (
            <Card className="space-y-2 p-5">
              <SectionTitle icon={Video}>Meeting link</SectionTitle>
              <Input
                value={meetingUrl}
                onChange={(e) => setMeetingUrl(e.target.value)}
                placeholder="https://meet.google.com/..."
              />
            </Card>
          )}

          <Card className="space-y-3 p-5">
            <SectionTitle icon={Paperclip}>Attachments</SectionTitle>
            <div className="space-y-2">
              {attachments.length === 0 && (
                <p className="rounded-md border border-dashed py-6 text-center text-xs text-muted-foreground">
                  No files attached yet.
                </p>
              )}
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
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Add attachment
                <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
              </label>
            </div>
          </Card>
        </div>
      </div>

      {/* Participants */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="p-5">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Coach
          </p>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft font-bold text-primary">
              {initials(coach?.full_name)}
            </div>
            <div>
              <p className="font-semibold">{coach?.full_name || "—"}</p>
              <p className="text-xs text-muted-foreground">{coach?.email}</p>
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Coachee
          </p>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-success/10 font-bold text-success">
              {initials(coachee?.full_name)}
            </div>
            <div>
              <p className="font-semibold">{coachee?.full_name || "—"}</p>
              <p className="text-xs text-muted-foreground">{coachee?.email}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Footer actions */}
      <Card className="flex flex-wrap items-center justify-between gap-3 bg-primary-soft/40 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-card text-primary">
            <HelpCircle className="h-4 w-4" />
          </div>
          <div className="text-sm">
            <p className="font-semibold">Need help with this session?</p>
            <a href="mailto:support@example.com" className="text-xs font-bold uppercase tracking-widest text-primary">
              Contact platform support
            </a>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {isCoach && session.status === "pending_coach_approval" && (
            <Button onClick={confirmSession} disabled={saving}>
              <CheckCircle2 className="mr-1 h-4 w-4" /> Confirm session
            </Button>
          )}
          {isCoach && session.status === "confirmed" && new Date(session.start_time) < new Date() && (
            <Button variant="secondary" onClick={completeSession} disabled={saving}>
              Mark complete
            </Button>
          )}
          {canCancel && (
            <Button variant="destructive" onClick={cancelSession} disabled={saving}>
              Cancel session
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

function SectionTitle({ icon: Icon, children }: { icon: any; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
      <Icon className="h-3.5 w-3.5 text-primary" />
      {children}
    </div>
  );
}

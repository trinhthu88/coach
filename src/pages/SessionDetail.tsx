import { useEffect, useState, useCallback } from "react";
import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom";
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
import { SessionGoalRatings } from "./session/SessionGoalRatings";
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
  coachee_notes: string | null;
  action_items: any;
  cancelled_at: string | null;
  slot_id: string | null;
}

interface ActionItem {
  text: string;
  done?: boolean;
  due_date?: string | null;
  milestone_id?: string | null;
}

interface MilestoneLite {
  id: string;
  title: string;
  goal_id: string;
  goal_title?: string;
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
    typeof it === "string"
      ? { text: it, done: false, due_date: null, milestone_id: null }
      : {
          text: it.text || "",
          done: !!it.done,
          due_date: it.due_date || null,
          milestone_id: it.milestone_id || null,
        }
  );
}

export default function SessionDetail() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  const isPeer = searchParams.get("type") === "peer";
  const tableName = isPeer ? "peer_sessions" : "sessions";
  const coachField = isPeer ? "peer_coach_id" : "coach_id";
  const coacheeField = isPeer ? "peer_coachee_id" : "coachee_id";
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
  const [milestones, setMilestones] = useState<MilestoneLite[]>([]);

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);

  // Peer-only: 8 ICF competency feedback
  const [feedback, setFeedback] = useState<{
    ethical_practice: number; coaching_mindset: number; maintains_agreements: number;
    trust_safety: number; maintains_presence: number; listens_actively: number;
    evokes_awareness: number; facilitates_growth: number; feedback_note: string;
    existed: boolean;
  }>({
    ethical_practice: 70, coaching_mindset: 70, maintains_agreements: 70,
    trust_safety: 70, maintains_presence: 70, listens_actively: 70,
    evokes_awareness: 70, facilitates_growth: 70, feedback_note: "", existed: false,
  });

  const load = useCallback(async () => {
    if (!sessionId) return;
    const { data } = await supabase.from(tableName as any).select("*").eq("id", sessionId).maybeSingle();
    if (!data) {
      setLoading(false);
      return;
    }
    // Normalize peer rows to look like SessionRow
    const norm: any = isPeer
      ? { ...(data as any), coach_id: (data as any)[coachField], coachee_id: (data as any)[coacheeField] }
      : data;
    setSession(norm as SessionRow);
    setCoachNotes(norm.coach_notes || "");
    setCoacheeNotes(norm.coachee_notes || "");
    setMeetingUrl(norm.meeting_url || "");
    setItems(normalizeItems(norm.action_items));

    // Load coach private notes from dedicated coach-only table (RLS will return nothing for coachees)
    {
      const privateTable = isPeer ? "peer_coach_session_private_notes" : "coach_session_private_notes";
      const idCol = isPeer ? "peer_session_id" : "session_id";
      const { data: pn } = await supabase
        .from(privateTable as any)
        .select("body")
        .eq(idCol, sessionId)
        .maybeSingle();
      setCoachPrivate((pn as any)?.body || "");
    }

    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, email, avatar_url")
      .in("id", [norm.coach_id, norm.coachee_id]);
    const byId = new Map((profs || []).map((p) => [p.id, p]));
    setCoach((byId.get(norm.coach_id) as ProfileLite) || null);
    setCoachee((byId.get(norm.coachee_id) as ProfileLite) || null);

    // Load milestones of the coachee (or peer-coachee) so action items can be linked
    const coacheeId = norm.coachee_id;
    const [{ data: gs }, { data: ms }] = await Promise.all([
      supabase.from("coachee_goals").select("id, title").eq("coachee_id", coacheeId),
      supabase.from("coachee_milestones").select("id, title, goal_id").eq("coachee_id", coacheeId).order("created_at"),
    ]);
    const goalById = new Map((gs || []).map((g: any) => [g.id, g.title]));
    setMilestones(
      (ms || []).map((m: any) => ({ id: m.id, title: m.title, goal_id: m.goal_id, goal_title: goalById.get(m.goal_id) }))
    );

    if (!isPeer) {
      const { data: atts } = await supabase
        .from("session_attachments")
        .select("*")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false });
      setAttachments((atts as Attachment[]) || []);
    } else {
      setAttachments([]);
      // Load existing competency feedback for this peer session (if any)
      const { data: fb } = await supabase
        .from("peer_session_competency_feedback")
        .select("*")
        .eq("peer_session_id", sessionId)
        .maybeSingle();
      if (fb) {
        setFeedback({
          ethical_practice: fb.ethical_practice ?? 70,
          coaching_mindset: fb.coaching_mindset ?? 70,
          maintains_agreements: fb.maintains_agreements ?? 70,
          trust_safety: fb.trust_safety ?? 70,
          maintains_presence: fb.maintains_presence ?? 70,
          listens_actively: fb.listens_actively ?? 70,
          evokes_awareness: fb.evokes_awareness ?? 70,
          facilitates_growth: fb.facilitates_growth ?? 70,
          feedback_note: fb.feedback_note ?? "",
          existed: true,
        });
      }
    }

    setLoading(false);
  }, [sessionId, tableName, isPeer, coachField, coacheeField]);

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

  // Peer sessions: both participants have role="coach". Use session position, not global role.
  const isCoach = isPeer
    ? session.coach_id === user?.id
    : role === "coach" && session.coach_id === user?.id;
  const isCoachee = isPeer
    ? session.coachee_id === user?.id
    : role === "coachee" && session.coachee_id === user?.id;
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
    }
    if (isAdmin) {
      update.meeting_url = meetingUrl || null;
    }
    if (isCoachee || isAdmin) {
      update.coachee_notes = coacheeNotes;
    }
    const { error } = await supabase.from(tableName as any).update(update).eq("id", session.id);
    if (error) {
      setSaving(false);
      toast.error(error.message);
      return;
    }

    // Save coach private notes to dedicated table (only coach/admin attempts this).
    if (isCoach || isAdmin) {
      const privateTable = isPeer ? "peer_coach_session_private_notes" : "coach_session_private_notes";
      const idCol = isPeer ? "peer_session_id" : "session_id";
      const coachIdCol = isPeer ? "peer_coach_id" : "coach_id";
      const payload: any = { body: coachPrivate };
      payload[idCol] = session.id;
      payload[coachIdCol] = session.coach_id;
      const { error: pErr } = await supabase
        .from(privateTable as any)
        .upsert(payload, { onConflict: idCol });
      if (pErr) {
        setSaving(false);
        toast.error(pErr.message);
        return;
      }
    }

    setSaving(false);
    toast.success("Progress saved");
    load();
  };

  const confirmSession = async () => {
    setSaving(true);
    const { error } = await supabase
      .from(tableName as any)
      .update({
        status: "confirmed",
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
    toast.success("Session confirmed. An admin will add the meeting link shortly.");
    load();
  };

  const cancelSession = async () => {
    setSaving(true);
    const { error } = await supabase
      .from(tableName as any)
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
    const { error } = await supabase.from(tableName as any).update({ status: "completed" }).eq("id", session.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Marked complete");
    load();
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    const allowedExt = ["pdf", "jpg", "jpeg", "mp3", "mp4"];
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!allowedExt.includes(ext)) {
      e.target.value = "";
      return toast.error("Only PDF, JPG, MP3 or MP4 files are allowed");
    }
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

  const updateItem = (idx: number, patch: Partial<ActionItem>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const addItem = () => {
    if (!newItem.trim()) return;
    setItems((prev) => [...prev, { text: newItem.trim(), done: false, due_date: null, milestone_id: null }]);
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
            <div className="flex items-center justify-between">
              <SectionTitle icon={CheckSquare}>Action items</SectionTitle>
              {(isCoach || isCoachee || isAdmin) && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    setSaving(true);
                    const { error } = await supabase
                      .from(tableName as any)
                      .update({ action_items: items })
                      .eq("id", session.id);
                    setSaving(false);
                    if (error) return toast.error(error.message);
                    toast.success("Action items saved");
                    load();
                  }}
                  disabled={saving}
                >
                  {saving ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <Save className="mr-1 h-3 w-3" />
                  )}
                  Save
                </Button>
              )}
            </div>
            {session.status === "completed" && (
              <p className="rounded-md border border-success/30 bg-success/5 p-2 text-[11px] text-success">
                Session completed — you can still add or update action items anytime and click Save.
              </p>
            )}
            <ul className="space-y-3">
              {items.map((it, idx) => {
                const ms = milestones.find((m) => m.id === it.milestone_id);
                return (
                  <li key={idx} className="rounded-md border bg-muted/20 p-2.5 text-sm">
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        onClick={() => updateItem(idx, { done: !it.done })}
                        className={cn(
                          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                          it.done
                            ? "border-success bg-success/10 text-success"
                            : "border-border text-transparent"
                        )}
                        aria-label={it.done ? "Mark incomplete" : "Mark complete"}
                      >
                        <CheckSquare className="h-3.5 w-3.5" />
                      </button>
                      <Input
                        value={it.text}
                        onChange={(e) => updateItem(idx, { text: e.target.value })}
                        className={cn("h-8 flex-1 text-sm", it.done && "text-muted-foreground line-through")}
                        placeholder="Action item"
                      />
                      <button
                        type="button"
                        onClick={() => setItems((p) => p.filter((_, i) => i !== idx))}
                        className="mt-1 text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 pl-7 text-xs">
                      <Input
                        type="date"
                        value={it.due_date || ""}
                        onChange={(e) => updateItem(idx, { due_date: e.target.value || null })}
                        className="h-7 w-auto text-xs"
                      />
                      <select
                        value={it.milestone_id || ""}
                        onChange={(e) => updateItem(idx, { milestone_id: e.target.value || null })}
                        className="h-7 rounded-md border bg-background px-2 text-xs"
                      >
                        <option value="">— No milestone —</option>
                        {milestones.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.goal_title ? `${m.goal_title} → ${m.title}` : m.title}
                          </option>
                        ))}
                      </select>
                      {ms && (
                        <span className="text-[10px] text-primary">
                          ↳ {ms.goal_title} → {ms.title}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
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
            {milestones.length === 0 && (
              <p className="text-[11px] text-muted-foreground">
                Tip: the coachee can create goals & milestones in <Link to="/coachee/journey" className="text-primary underline">My journey</Link> so action items can be linked.
              </p>
            )}
          </Card>

          {isAdmin ? (
            <Card className="space-y-3 p-5">
              <SectionTitle icon={Video}>Meeting link (admin)</SectionTitle>
              <Input
                value={meetingUrl}
                onChange={(e) => setMeetingUrl(e.target.value)}
                placeholder="https://meet.google.com/... or https://zoom.us/..."
                type="url"
                maxLength={500}
              />
              <p className="text-xs text-muted-foreground">
                Only admins manage the meeting link. Both coach and coachee will see a "Join meeting" button once it is saved and the session is confirmed.
              </p>
              <div className="flex items-center justify-between gap-2">
                {meetingUrl && /^https?:\/\//i.test(meetingUrl) ? (
                  <a
                    href={meetingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-primary hover:underline"
                  >
                    <Video className="h-3 w-3" /> Test link
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground">No link saved yet</span>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    const trimmed = meetingUrl.trim();
                    if (trimmed && !/^https?:\/\//i.test(trimmed)) {
                      toast.error("Meeting link must start with http:// or https://");
                      return;
                    }
                    setSaving(true);
                    const { error } = await supabase
                      .from(tableName as any)
                      .update({ meeting_url: trimmed || null })
                      .eq("id", session.id);
                    setSaving(false);
                    if (error) return toast.error(error.message);
                    toast.success("Meeting link saved");
                    load();
                  }}
                  disabled={saving}
                >
                  {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Save className="mr-1 h-3 w-3" />}
                  Save link
                </Button>
              </div>
            </Card>
          ) : (
            session.status === "confirmed" && (
              <Card className="space-y-2 p-5">
                <SectionTitle icon={Video}>Meeting link</SectionTitle>
                {session.meeting_url ? (
                  <Button asChild className="w-full">
                    <a href={session.meeting_url} target="_blank" rel="noreferrer">
                      <Video className="mr-1 h-4 w-4" /> Join meeting
                    </a>
                  </Button>
                ) : (
                  <p className="rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
                    The platform admin will share the meeting link here shortly.
                  </p>
                )}
              </Card>
            )
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
              <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed py-3 text-sm text-muted-foreground hover:bg-muted/30">
                <span className="flex items-center gap-2">
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Add attachment
                </span>
                <span className="text-[10px] uppercase tracking-widest">PDF · JPG · MP3 · MP4</span>
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.jpg,.jpeg,.mp3,.mp4,application/pdf,image/jpeg,audio/mpeg,video/mp4"
                  onChange={handleUpload}
                  disabled={uploading}
                />
              </label>
            </div>
          </Card>
        </div>
      </div>

      {/* Per-goal rating snapshot (non-peer sessions only) */}
      {!isPeer && (
        <SessionGoalRatings
          sessionId={session.id}
          coacheeId={session.coachee_id}
          canEdit={isCoachee && session.status === "completed"}
          sessionStatus={session.status}
        />
      )}

      {/* Peer-coachee competency feedback (only on completed peer sessions, only for the peer-coachee) */}
      {isPeer && session.status === "completed" && session.coachee_id === user?.id && (
        <PeerCompetencyFeedback
          sessionId={session.id}
          peerCoachId={session.coach_id}
          peerCoacheeId={session.coachee_id}
          existing={feedback}
          onSaved={load}
        />
      )}
      {/* Read-only view of received feedback for peer-coach */}
      {isPeer && session.status === "completed" && session.coach_id === user?.id && feedback.existed && (
        <PeerCompetencyFeedback
          sessionId={session.id}
          peerCoachId={session.coach_id}
          peerCoacheeId={session.coachee_id}
          existing={feedback}
          readOnly
        />
      )}

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

const COMPETENCIES: { key: keyof PeerFeedbackState; label: string }[] = [
  { key: "ethical_practice", label: "Demonstrates Ethical Practice" },
  { key: "coaching_mindset", label: "Embodies a Coaching Mindset" },
  { key: "maintains_agreements", label: "Establishes & Maintains Agreements" },
  { key: "trust_safety", label: "Cultivates Trust and Safety" },
  { key: "maintains_presence", label: "Maintains Presence" },
  { key: "listens_actively", label: "Listens Actively" },
  { key: "evokes_awareness", label: "Evokes Awareness" },
  { key: "facilitates_growth", label: "Facilitates Client Growth" },
];

type PeerFeedbackState = {
  ethical_practice: number; coaching_mindset: number; maintains_agreements: number;
  trust_safety: number; maintains_presence: number; listens_actively: number;
  evokes_awareness: number; facilitates_growth: number; feedback_note: string;
  existed: boolean;
};

function PeerCompetencyFeedback({
  sessionId, peerCoachId, peerCoacheeId, existing, onSaved, readOnly,
}: {
  sessionId: string;
  peerCoachId: string;
  peerCoacheeId: string;
  existing: PeerFeedbackState;
  onSaved?: () => void;
  readOnly?: boolean;
}) {
  const [state, setState] = useState<PeerFeedbackState>(existing);
  const [saving, setSaving] = useState(false);

  const setScore = (k: keyof PeerFeedbackState, v: number) =>
    setState((p) => ({ ...p, [k]: v }));

  const save = async () => {
    setSaving(true);
    const payload = {
      peer_session_id: sessionId,
      peer_coach_id: peerCoachId,
      peer_coachee_id: peerCoacheeId,
      ethical_practice: state.ethical_practice,
      coaching_mindset: state.coaching_mindset,
      maintains_agreements: state.maintains_agreements,
      trust_safety: state.trust_safety,
      maintains_presence: state.maintains_presence,
      listens_actively: state.listens_actively,
      evokes_awareness: state.evokes_awareness,
      facilitates_growth: state.facilitates_growth,
      feedback_note: state.feedback_note || null,
    };
    const { error } = state.existed
      ? await supabase
          .from("peer_session_competency_feedback")
          .update(payload)
          .eq("peer_session_id", sessionId)
      : await supabase.from("peer_session_competency_feedback").insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Feedback saved");
    setState((p) => ({ ...p, existed: true }));
    onSaved?.();
  };

  return (
    <Card className="space-y-5 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">
            ICF competency feedback {readOnly && <span className="text-xs font-normal text-muted-foreground">(read only)</span>}
          </h2>
          <p className="text-xs text-muted-foreground">
            Rate your peer coach on the 8 ICF coaching competencies (0–100).
          </p>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {COMPETENCIES.map((c) => (
          <div key={c.key} className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{c.label}</span>
              <span className="font-bold text-primary">{state[c.key] as number}</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              disabled={readOnly}
              value={state[c.key] as number}
              onChange={(e) => setScore(c.key, Number(e.target.value))}
              className="w-full accent-primary"
            />
          </div>
        ))}
      </div>
      <div>
        <p className="mb-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Written feedback
        </p>
        <Textarea
          rows={4}
          disabled={readOnly}
          value={state.feedback_note}
          onChange={(e) => setState((p) => ({ ...p, feedback_note: e.target.value }))}
          placeholder="What went well? What could grow further?"
        />
      </div>
      {!readOnly && (
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            {state.existed ? "Update feedback" : "Submit feedback"}
          </Button>
        </div>
      )}
    </Card>
  );
}

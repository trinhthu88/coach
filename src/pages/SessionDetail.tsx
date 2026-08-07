import { useState } from "react";
import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom";
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
  FileText,
  MessageSquare,
  CheckCircle2,
  XCircle,
  AlertCircle,
  HelpCircle,
  LucideIcon,
} from "lucide-react";
import { SessionGoalRatings } from "./session/SessionGoalRatings";
import { SessionToolbox } from "@/components/tools/SessionToolbox";

import { cn } from "@/lib/utils";
import { format, isAfter, addHours } from "date-fns";
import {
  useSessionCore,
  useSessionPrivateNotes,
  useSessionAttachments,
  useSessionPeerFeedback,
} from "@/hooks/sessions/useSessionDetail";
import { PeerFeedbackState, SessionStatus } from "@/hooks/sessions/types";

const STATUS_META: Record<
  SessionStatus,
  { label: string; className: string; icon: LucideIcon }
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

export default function SessionDetail() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  const isPeer = searchParams.get("type") === "peer";
  const navigate = useNavigate();
  const { user, role } = useAuth();

  const {
    session,
    coach,
    coachee,
    milestones,
    loading,
    saving,
    coachNotes,
    setCoachNotes,
    coacheeNotes,
    setCoacheeNotes,
    meetingUrl,
    setMeetingUrl,
    items,
    setItems,
    updateItem,
    removeItem,
    addItem,
    reload,
    saveProgress,
    saveActionItems,
    saveMeetingUrl,
    confirmSession,
    cancelSession,
    completeSession,
  } = useSessionCore({ sessionId, isPeer });

  const {
    coachPrivate,
    setCoachPrivate,
    save: savePrivateNotes,
  } = useSessionPrivateNotes({ sessionId, isPeer, coachId: session?.coach_id });

  const {
    attachments,
    uploading,
    upload: handleUpload,
    download: downloadAttachment,
    remove: removeAttachment,
  } = useSessionAttachments({ sessionId, isPeer, userId: user?.id });

  const { feedback, save: savePeerFeedback } = useSessionPeerFeedback({
    sessionId,
    isPeer,
    peerCoachId: session?.coach_id,
    peerCoacheeId: session?.coachee_id,
  });

  const [newItem, setNewItem] = useState("");

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

  const handleSaveProgress = async () => {
    const { error } = await saveProgress({
      includeCoachNotes: isCoach || isAdmin,
      includeCoacheeNotes: isCoachee || isAdmin,
      includeMeetingUrl: isAdmin,
    });
    if (error) {
      toast.error(error.message);
      return;
    }

    if (isCoach || isAdmin) {
      const { error: pErr } = await savePrivateNotes();
      if (pErr) return;
    }

    toast.success("Progress saved");
    reload();
  };

  const handleCancelSession = () => cancelSession(user?.id, () => navigate("/sessions"));

  const handleAddItem = () => {
    addItem(newItem);
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
            <h1 className="font-display text-[2.1rem] leading-[1.1] tracking-tight">{session.topic}</h1>
            {(() => {
              const counterpart = isCoach ? coachee : coach;
              return counterpart ? (
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary">
                    {initials(counterpart.full_name)}
                  </div>
                  <div className="leading-tight">
                    <p className="text-sm font-semibold text-foreground">{counterpart.full_name}</p>
                    <p className="text-[11px] text-muted-foreground">{isCoach ? "Coachee" : "Coach"}</p>
                  </div>
                </div>
              ) : null;
            })()}
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
                  <Video className="mr-1 h-4 w-4" /> Join video room
                </a>
              </Button>
            )}
            {(isCoach || isCoachee || isAdmin) && (
              <Button variant="outline" onClick={handleSaveProgress} disabled={saving}>
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
                  onClick={saveActionItems}
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
                        onClick={() => removeItem(idx)}
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
                    handleAddItem();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={handleAddItem}>
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
                  onClick={() => {
                    const trimmed = meetingUrl.trim();
                    if (trimmed && !/^https?:\/\//i.test(trimmed)) {
                      toast.error("Meeting link must start with http:// or https://");
                      return;
                    }
                    saveMeetingUrl(trimmed);
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
                      <Video className="mr-1 h-4 w-4" /> Join video room
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

      {/* Coaching toolbox (non-peer, active sessions) */}
      {!isPeer && (session.status === "confirmed" || session.status === "completed") && (
        <div className="space-y-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Coaching tools</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Open a tool to work through it together. Whatever you fill in stays attached to this session.
            </p>
          </div>
          <SessionToolbox sessionId={session.id} onActionItemsChanged={reload} />
        </div>
      )}



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
          existing={feedback}
          onSave={savePeerFeedback}
          onSaved={reload}
        />
      )}
      {/* Read-only view of received feedback for peer-coach */}
      {isPeer && session.status === "completed" && session.coach_id === user?.id && feedback.existed && (
        <PeerCompetencyFeedback existing={feedback} onSave={savePeerFeedback} readOnly />
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
            <Button variant="destructive" onClick={handleCancelSession} disabled={saving}>
              Cancel session
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

function SectionTitle({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
      <Icon className="h-3.5 w-3.5 text-primary" />
      {children}
    </div>
  );
}

const COMPETENCIES: { key: keyof Omit<PeerFeedbackState, "feedback_note" | "existed">; label: string }[] = [
  { key: "ethical_practice", label: "Demonstrates Ethical Practice" },
  { key: "coaching_mindset", label: "Embodies a Coaching Mindset" },
  { key: "maintains_agreements", label: "Establishes & Maintains Agreements" },
  { key: "trust_safety", label: "Cultivates Trust and Safety" },
  { key: "maintains_presence", label: "Maintains Presence" },
  { key: "listens_actively", label: "Listens Actively" },
  { key: "evokes_awareness", label: "Evokes Awareness" },
  { key: "facilitates_growth", label: "Facilitates Client Growth" },
];

function PeerCompetencyFeedback({
  existing,
  onSave,
  onSaved,
  readOnly,
}: {
  existing: PeerFeedbackState;
  onSave: (state: PeerFeedbackState) => Promise<{ error: unknown }>;
  onSaved?: () => void;
  readOnly?: boolean;
}) {
  const [state, setState] = useState<PeerFeedbackState>(existing);
  const [saving, setSaving] = useState(false);

  const setScore = (k: keyof PeerFeedbackState, v: number) =>
    setState((p) => ({ ...p, [k]: v }));

  const save = async () => {
    setSaving(true);
    const { error } = await onSave(state);
    setSaving(false);
    if (error) return;
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
              <span className="font-bold text-primary">{state[c.key]}</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              disabled={readOnly}
              value={state[c.key]}
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

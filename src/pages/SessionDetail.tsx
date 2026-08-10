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
  Clock,
  Loader2,
  Video,
  Save,
  Paperclip,
  Upload,
  X,
  CheckSquare,
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
    className: "bg-warning/12 text-warning",
    icon: AlertCircle,
  },
  confirmed: {
    label: "Confirmed",
    className: "bg-primary-soft text-primary",
    icon: CheckCircle2,
  },
  completed: {
    label: "Completed",
    className: "bg-success/12 text-success",
    icon: CheckCircle2,
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-destructive/10 text-destructive",
    icon: XCircle,
  },
  rescheduled: {
    label: "Rescheduled",
    className: "bg-muted text-muted-foreground",
    icon: Clock,
  },
};

type TabKey = "notes" | "actions" | "files" | "toolbox";

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
  const [tab, setTab] = useState<TabKey>("notes");

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

  const initials = (n?: string | null) =>
    (n || "?").split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase();

  const counterpart = isCoach ? coachee : coach;
  const showToolbox = session.status === "confirmed" || session.status === "completed";
  const openItems = items.filter((i) => !i.done);

  const TABS: { key: TabKey; label: string }[] = [
    { key: "notes", label: "Notes" },
    { key: "actions", label: "Actions" },
    { key: "files", label: "Files" },
    ...(showToolbox ? [{ key: "toolbox" as TabKey, label: "Toolbox" }] : []),
  ];

  return (
    <div className="space-y-6">
      <Link
        to="/sessions"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> All sessions
      </Link>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:items-start">
        {/* ---------- Main column ---------- */}
        <div className="space-y-6">
          {/* Hero */}
          <Card className="animate-rise p-8">
            <div className="flex flex-wrap items-center gap-4">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em]",
                  meta.className
                )}
              >
                <StatusIcon className="h-3 w-3" /> {meta.label}
              </span>
              <span className="text-sm text-muted-foreground">
                {format(start, "EEE d MMM · HH:mm")}
              </span>
            </div>

            <h1 className="font-display mt-6 text-[clamp(2rem,4vw,3rem)] leading-[1.05] tracking-tight">
              {session.topic}
            </h1>

            <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6">
              <div className="flex items-center gap-4">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary-soft text-sm font-bold text-primary">
                  {initials(counterpart?.full_name)}
                </div>
                <div className="leading-tight">
                  <p className="text-base font-semibold text-foreground">
                    {counterpart?.full_name || "—"}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {isCoach ? "Coachee" : "Coach"}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {session.meeting_url && session.status === "confirmed" && (
                  <Button
                    asChild
                    size="lg"
                    className="rounded-full bg-primary px-7 text-primary-foreground shadow-glow hover:bg-primary/90"
                  >
                    <a href={session.meeting_url} target="_blank" rel="noreferrer">
                      <Video className="mr-1.5 h-4 w-4" /> Join Zoom meeting
                    </a>
                  </Button>
                )}
                {(isCoach || isCoachee || isAdmin) && (
                  <Button
                    variant="outline"
                    size="lg"
                    className="rounded-full"
                    onClick={handleSaveProgress}
                    disabled={saving}
                  >
                    {saving ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-1.5 h-4 w-4" />
                    )}
                    Save progress
                  </Button>
                )}
              </div>
            </div>
          </Card>

          {/* Tabbed workspace */}
          <Card className="animate-rise p-8">
            <div className="inline-flex flex-wrap gap-1 rounded-full bg-muted/60 p-1.5">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "rounded-full px-5 py-2 text-[10.5px] font-bold uppercase tracking-[0.16em] transition-all",
                    tab === t.key
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="mt-8">
              {tab === "notes" && (
                <div className="space-y-8">
                  <NoteBlock
                    label="Coach note"
                    hint={isCoach || isAdmin ? undefined : "Read only"}
                  >
                    <Textarea
                      value={coachNotes}
                      onChange={(e) => setCoachNotes(e.target.value)}
                      rows={7}
                      disabled={!(isCoach || isAdmin)}
                      className="resize-none border-0 bg-transparent p-0 text-[15px] leading-relaxed shadow-none focus-visible:ring-0 disabled:opacity-100"
                      placeholder={
                        isCoach || isAdmin
                          ? "Write notes visible to the coachee…"
                          : "Coach hasn't added notes yet."
                      }
                    />
                  </NoteBlock>

                  {(isCoach || isAdmin) && (
                    <NoteBlock label="Private note" hint="Only you">
                      <Textarea
                        value={coachPrivate}
                        onChange={(e) => setCoachPrivate(e.target.value)}
                        rows={3}
                        placeholder="Private notes (only you can see)"
                        className="resize-none rounded-[14px] bg-muted/40 text-[15px] leading-relaxed"
                      />
                    </NoteBlock>
                  )}

                  <NoteBlock
                    label="Client reflection"
                    hint={isCoachee || isAdmin ? undefined : "Read only"}
                  >
                    <Textarea
                      value={coacheeNotes}
                      onChange={(e) => setCoacheeNotes(e.target.value)}
                      rows={7}
                      disabled={!(isCoachee || isAdmin)}
                      className="resize-none border-0 bg-transparent p-0 text-[15px] leading-relaxed shadow-none focus-visible:ring-0 disabled:opacity-100"
                      placeholder={
                        isCoachee || isAdmin
                          ? "Capture your reflections, takeaways and questions…"
                          : "Coachee hasn't shared reflections yet."
                      }
                    />
                  </NoteBlock>
                </div>
              )}

              {tab === "actions" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="eyebrow text-primary">Agreed actions</p>
                    {(isCoach || isCoachee || isAdmin) && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-full"
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
                    <p className="rounded-[14px] bg-success/8 px-4 py-3 text-xs text-success">
                      Session completed — you can still add or update action items anytime and click Save.
                    </p>
                  )}

                  <ul className="space-y-3">
                    {items.length === 0 && (
                      <li className="rounded-[16px] border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
                        No actions agreed yet.
                      </li>
                    )}
                    {items.map((it, idx) => {
                      const ms = milestones.find((m) => m.id === it.milestone_id);
                      return (
                        <li key={idx} className="rounded-[16px] bg-muted/40 p-4 text-sm">
                          <div className="flex items-start gap-3">
                            <button
                              type="button"
                              onClick={() => updateItem(idx, { done: !it.done })}
                              className={cn(
                                "mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors",
                                it.done
                                  ? "border-success bg-success/12 text-success"
                                  : "border-border text-transparent hover:border-primary"
                              )}
                              aria-label={it.done ? "Mark incomplete" : "Mark complete"}
                            >
                              <CheckSquare className="h-3.5 w-3.5" />
                            </button>
                            <Input
                              value={it.text}
                              onChange={(e) => updateItem(idx, { text: e.target.value })}
                              className={cn(
                                "h-9 flex-1 rounded-[10px] bg-card text-sm",
                                it.done && "text-muted-foreground line-through"
                              )}
                              placeholder="Action item"
                            />
                            <button
                              type="button"
                              onClick={() => removeItem(idx)}
                              className="mt-2 text-muted-foreground transition-colors hover:text-destructive"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-2 pl-8 text-xs">
                            <Input
                              type="date"
                              value={it.due_date || ""}
                              onChange={(e) => updateItem(idx, { due_date: e.target.value || null })}
                              className="h-8 w-auto rounded-[10px] bg-card text-xs"
                            />
                            <select
                              value={it.milestone_id || ""}
                              onChange={(e) => updateItem(idx, { milestone_id: e.target.value || null })}
                              className="h-8 rounded-[10px] border border-input bg-card px-2 text-xs"
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
                      placeholder="Add new action item…"
                      className="rounded-full"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddItem();
                        }
                      }}
                    />
                    <Button type="button" variant="outline" className="rounded-full" onClick={handleAddItem}>
                      Add
                    </Button>
                  </div>

                  {milestones.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      Tip: the coachee can create goals & milestones in{" "}
                      <Link to="/coachee/journey" className="text-primary underline">
                        My journey
                      </Link>{" "}
                      so action items can be linked.
                    </p>
                  )}
                </div>
              )}

              {tab === "files" && (
                <div className="space-y-3">
                  <p className="eyebrow text-primary">Attachments</p>
                  {attachments.length === 0 && (
                    <p className="rounded-[16px] border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
                      No files attached yet.
                    </p>
                  )}
                  {attachments.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center gap-3 rounded-[14px] bg-muted/40 px-4 py-3 text-sm"
                    >
                      <Paperclip className="h-4 w-4 text-muted-foreground" />
                      <button
                        type="button"
                        onClick={() => downloadAttachment(a)}
                        className="flex-1 truncate text-left transition-colors hover:text-primary"
                      >
                        {a.file_name}
                      </button>
                      {a.uploaded_by === user?.id && (
                        <button
                          type="button"
                          onClick={() => removeAttachment(a)}
                          className="text-muted-foreground transition-colors hover:text-destructive"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                  <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-[16px] border border-dashed border-border py-5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground">
                    <span className="flex items-center gap-2">
                      {uploading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4" />
                      )}
                      Add attachment
                    </span>
                    <span className="text-[10px] uppercase tracking-[0.16em]">PDF · JPG · MP3 · MP4</span>
                    <input
                      type="file"
                      className="hidden"
                      accept=".pdf,.jpg,.jpeg,.mp3,.mp4,application/pdf,image/jpeg,audio/mpeg,video/mp4"
                      onChange={handleUpload}
                      disabled={uploading}
                    />
                  </label>
                </div>
              )}

              {tab === "toolbox" && showToolbox && (
                <div className="space-y-4">
                  <div>
                    <p className="eyebrow text-primary">Coaching tools</p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Open a tool to work through it together. Whatever you fill in stays attached to this
                      session.
                    </p>
                  </div>
                  <SessionToolbox
                    sessionId={isPeer ? undefined : session.id}
                    peerSessionId={isPeer ? session.id : undefined}
                    onActionItemsChanged={reload}
                  />
                </div>
              )}
            </div>
          </Card>

          {/* Per-goal rating snapshot (non-peer sessions only) */}
          {!isPeer && (
            <SessionGoalRatings
              sessionId={session.id}
              coacheeId={session.coachee_id}
              canEdit={isCoachee && session.status === "completed"}
              sessionStatus={session.status}
            />
          )}

          {/* Peer competency feedback */}
          {isPeer && session.status === "completed" && session.coachee_id === user?.id && (
            <PeerCompetencyFeedback existing={feedback} onSave={savePeerFeedback} onSaved={reload} />
          )}
          {isPeer && session.status === "completed" && session.coach_id === user?.id && feedback.existed && (
            <PeerCompetencyFeedback existing={feedback} onSave={savePeerFeedback} readOnly />
          )}
        </div>

        {/* ---------- Side column ---------- */}
        <aside className="space-y-6">
          <div className="animate-rise relative overflow-hidden rounded-[26px] gradient-hero p-8 text-secondary-foreground">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full"
              style={{ background: "radial-gradient(circle, hsl(var(--primary) / 0.3), transparent 70%)" }}
            />
            <div className="relative">
              <p className="eyebrow text-primary">Session focus</p>
              <p className="font-display mt-4 text-[1.6rem] leading-snug">{session.topic}</p>
              <div className="mt-7 grid grid-cols-2 gap-4 border-t border-primary-foreground/15 pt-6">
                <div>
                  <p className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-primary">Date</p>
                  <p className="font-display mt-2 text-[1.7rem] leading-none">{format(start, "d MMM")}</p>
                </div>
                <div>
                  <p className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-primary">Duration</p>
                  <p className="font-display mt-2 text-[1.7rem] leading-none">
                    {session.duration_minutes} min
                  </p>
                </div>
              </div>
            </div>
          </div>

          {openItems.length > 0 && (
            <Card className="animate-rise p-7">
              <p className="eyebrow text-primary">Prepare</p>
              <ul className="mt-5 space-y-3.5">
                {openItems.slice(0, 5).map((it, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm leading-snug">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    <span>
                      {it.text}
                      {it.due_date && (
                        <span className="text-muted-foreground"> · {format(new Date(it.due_date), "d MMM")}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {isAdmin ? (
            <Card className="space-y-3 p-7">
              <p className="eyebrow text-primary">Meeting link (admin)</p>
              <Input
                value={meetingUrl}
                onChange={(e) => setMeetingUrl(e.target.value)}
                placeholder="https://meet.google.com/… or https://zoom.us/…"
                type="url"
                maxLength={500}
              />
              <p className="text-xs text-muted-foreground">
                A video room is created automatically when the session is confirmed. Paste a Zoom/Meet link here
                only if you want to override it.
              </p>
              <div className="flex items-center justify-between gap-2">
                {meetingUrl && /^https?:\/\//i.test(meetingUrl) ? (
                  <a
                    href={meetingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.16em] text-primary hover:underline"
                  >
                    <Video className="h-3 w-3" /> Test link
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground">No link saved yet</span>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
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
                  {saving ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <Save className="mr-1 h-3 w-3" />
                  )}
                  Save link
                </Button>
              </div>
            </Card>
          ) : (
            session.status === "confirmed" &&
            !session.meeting_url && (
              <Card className="space-y-2 p-7">
                <p className="eyebrow text-primary">Meeting link</p>
                <p className="text-sm text-muted-foreground">
                  Your video room is being set up. Refresh in a moment.
                </p>
              </Card>
            )
          )}

          <Card className="space-y-5 p-7">
            <p className="eyebrow text-primary">Participants</p>
            <Participant label="Coach" name={coach?.full_name} email={coach?.email} tone="primary" />
            <Participant label="Coachee" name={coachee?.full_name} email={coachee?.email} tone="success" />
          </Card>

          {(isCoach || canCancel) && (
            <Card className="flex flex-wrap gap-2 p-7">
              {isCoach && session.status === "pending_coach_approval" && (
                <Button className="rounded-full" onClick={confirmSession} disabled={saving}>
                  <CheckCircle2 className="mr-1 h-4 w-4" /> Confirm session
                </Button>
              )}
              {isCoach && session.status === "confirmed" && new Date(session.start_time) < new Date() && (
                <Button variant="secondary" className="rounded-full" onClick={completeSession} disabled={saving}>
                  Mark complete
                </Button>
              )}
              {canCancel && (
                <Button
                  variant="destructive"
                  className="rounded-full"
                  onClick={handleCancelSession}
                  disabled={saving}
                >
                  Cancel session
                </Button>
              )}
            </Card>
          )}

          <Card className="flex items-center gap-3 bg-primary-soft/40 p-6">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-card text-primary">
              <HelpCircle className="h-4 w-4" />
            </div>
            <div className="text-sm">
              <p className="font-semibold">Need help with this session?</p>
              <a
                href="mailto:support@example.com"
                className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary"
              >
                Contact platform support
              </a>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function NoteBlock({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-baseline gap-3">
        <p className="eyebrow text-primary">{label}</p>
        {hint && (
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            {hint}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function Participant({
  label,
  name,
  email,
  tone,
}: {
  label: string;
  name?: string | null;
  email?: string | null;
  tone: "primary" | "success";
}) {
  const initials = (name || "?").split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-xl text-sm font-bold",
          tone === "primary" ? "bg-primary-soft text-primary" : "bg-success/12 text-success"
        )}
      >
        {initials}
      </div>
      <div className="min-w-0">
        <p className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-semibold">{name || "—"}</p>
        {email && <p className="truncate text-xs text-muted-foreground">{email}</p>}
      </div>
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
    <Card className="space-y-5 p-8">
      <div>
        <p className="eyebrow text-primary">ICF competency feedback</p>
        <h2 className="font-display mt-3 text-[1.6rem] leading-tight">
          Rate your peer coach{" "}
          {readOnly && <span className="text-sm text-muted-foreground">(read only)</span>}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Score the 8 ICF coaching competencies from 0 to 100.
        </p>
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
        <p className="eyebrow mb-2 text-primary">Written feedback</p>
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
          <Button className="rounded-full" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            {state.existed ? "Update feedback" : "Submit feedback"}
          </Button>
        </div>
      )}
    </Card>
  );
}

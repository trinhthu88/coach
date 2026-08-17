import { useState } from "react";
import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
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
import { canMarkSessionComplete } from "@/hooks/sessions/completionGate";

function getStatusMeta(t: (key: string) => string): Record<
  SessionStatus,
  { label: string; className: string; icon: LucideIcon }
> {
  return {
    pending_coach_approval: {
      label: t("status.pending_coach_approval"),
      className: "bg-warning/12 text-warning",
      icon: AlertCircle,
    },
    confirmed: {
      label: t("status.confirmed"),
      className: "bg-primary-soft text-primary",
      icon: CheckCircle2,
    },
    completed: {
      label: t("status.completed"),
      className: "bg-success/12 text-success",
      icon: CheckCircle2,
    },
    cancelled: {
      label: t("status.cancelled"),
      className: "bg-destructive/10 text-destructive",
      icon: XCircle,
    },
    rescheduled: {
      label: t("status.rescheduled"),
      className: "bg-muted text-muted-foreground",
      icon: Clock,
    },
  };
}

type TabKey = "notes" | "actions" | "files" | "toolbox";

export default function SessionDetail() {
  const { t } = useTranslation("sessions");
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
        <h2 className="text-xl font-semibold">{t("detail.sessionNotFound.title")}</h2>
        <Button asChild variant="outline" className="mt-6">
          <Link to="/sessions">{t("detail.sessionNotFound.backToSessions")}</Link>
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
  const meta = getStatusMeta(t)[session.status];
  const StatusIcon = meta.icon;
  const canCancel =
    session.status !== "cancelled" &&
    session.status !== "completed" &&
    isAfter(start, addHours(new Date(), 24));

  const sessionStarted = start < new Date();
  // Coach can't mark a session complete until the coachee's side of the
  // record exists: their written reflection (regular sessions) or their
  // ICF competency feedback (peer sessions).
  const canMarkComplete = canMarkSessionComplete({
    isPeer,
    coacheeNotes,
    peerFeedbackExisted: feedback.existed,
  });
  const missingRequirementHint = isPeer
    ? t("detail.missingRequirementHintPeer")
    : t("detail.missingRequirementHintCoaching");

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

    toast.success(t("detail.toast.progressSaved"));
    reload();
  };

  const handleCancelSession = () => cancelSession(() => navigate("/sessions"));

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
    { key: "notes", label: t("detail.tabs.notes") },
    { key: "actions", label: t("detail.tabs.actions") },
    { key: "files", label: t("detail.tabs.files") },
    ...(showToolbox ? [{ key: "toolbox" as TabKey, label: t("detail.tabs.toolbox") }] : []),
  ];

  return (
    <div className="space-y-6">
      <Link
        to="/sessions"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {t("detail.allSessions")}
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
                    {isCoach ? t("detail.counterpartRole.coachee") : t("detail.counterpartRole.coach")}
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
                      <Video className="mr-1.5 h-4 w-4" /> {t("detail.joinZoomMeeting")}
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
                    {t("detail.saveProgress")}
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
                    label={t("detail.notes.coachNoteLabel")}
                    hint={isCoach || isAdmin ? undefined : t("detail.notes.readOnly")}
                  >
                    <Textarea
                      value={coachNotes}
                      onChange={(e) => setCoachNotes(e.target.value)}
                      rows={7}
                      disabled={!(isCoach || isAdmin)}
                      className="resize-none border-0 bg-transparent p-0 text-[15px] leading-relaxed shadow-none focus-visible:ring-0 disabled:opacity-100"
                      placeholder={
                        isCoach || isAdmin
                          ? t("detail.notes.coachNotePlaceholderEditable")
                          : t("detail.notes.coachNotePlaceholderReadOnly")
                      }
                    />
                  </NoteBlock>

                  {(isCoach || isAdmin) && (
                    <NoteBlock label={t("detail.notes.privateNoteLabel")} hint={t("detail.notes.onlyYou")}>
                      <Textarea
                        value={coachPrivate}
                        onChange={(e) => setCoachPrivate(e.target.value)}
                        rows={3}
                        placeholder={t("detail.notes.privateNotePlaceholder")}
                        className="resize-none rounded-[14px] bg-muted/40 text-[15px] leading-relaxed"
                      />
                    </NoteBlock>
                  )}

                  <NoteBlock
                    label={t("detail.notes.clientReflectionLabel")}
                    hint={isCoachee || isAdmin ? undefined : t("detail.notes.readOnly")}
                  >
                    <Textarea
                      value={coacheeNotes}
                      onChange={(e) => setCoacheeNotes(e.target.value)}
                      rows={7}
                      disabled={!(isCoachee || isAdmin)}
                      className="resize-none border-0 bg-transparent p-0 text-[15px] leading-relaxed shadow-none focus-visible:ring-0 disabled:opacity-100"
                      placeholder={
                        isCoachee || isAdmin
                          ? t("detail.notes.clientReflectionPlaceholderEditable")
                          : t("detail.notes.clientReflectionPlaceholderReadOnly")
                      }
                    />
                  </NoteBlock>
                </div>
              )}

              {tab === "actions" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="eyebrow text-primary">{t("detail.actions.eyebrow")}</p>
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
                        {t("detail.actions.save")}
                      </Button>
                    )}
                  </div>

                  {session.status === "completed" && (
                    <p className="rounded-[14px] bg-success/8 px-4 py-3 text-xs text-success">
                      {t("detail.actions.completedBanner")}
                    </p>
                  )}

                  <ul className="space-y-3">
                    {items.length === 0 && (
                      <li className="rounded-[16px] border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
                        {t("detail.actions.empty")}
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
                              aria-label={it.done ? t("detail.actions.markIncomplete") : t("detail.actions.markCompleteAria")}
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
                              placeholder={t("detail.actions.itemPlaceholder")}
                            />
                            <button
                              type="button"
                              onClick={() => removeItem(idx)}
                              className="-m-2 mt-0 shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:text-destructive"
                              aria-label={t("detail.actions.removeItem")}
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
                              <option value="">{t("detail.actions.noMilestone")}</option>
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
                      placeholder={t("detail.actions.addPlaceholder")}
                      className="rounded-full"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddItem();
                        }
                      }}
                    />
                    <Button type="button" variant="outline" className="rounded-full" onClick={handleAddItem}>
                      {t("detail.actions.add")}
                    </Button>
                  </div>

                  {milestones.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      {t("detail.actions.tipPrefix")}{" "}
                      <Link to="/coachee/journey" className="text-primary underline">
                        {t("detail.actions.tipLinkText")}
                      </Link>{" "}
                      {t("detail.actions.tipSuffix")}
                    </p>
                  )}
                </div>
              )}

              {tab === "files" && (
                <div className="space-y-3">
                  <p className="eyebrow text-primary">{t("detail.files.eyebrow")}</p>
                  {attachments.length === 0 && (
                    <p className="rounded-[16px] border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
                      {t("detail.files.empty")}
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
                          className="-m-2 shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:text-destructive"
                          aria-label={t("detail.files.removeAttachment")}
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
                      {t("detail.files.addAttachment")}
                    </span>
                    <span className="text-[10px] uppercase tracking-[0.16em]">{t("detail.files.acceptedTypes")}</span>
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
                    <p className="eyebrow text-primary">{t("detail.toolbox.eyebrow")}</p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {t("detail.toolbox.subtitle")}
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

          {/* Peer competency feedback — visible to the peer-coachee as soon as the
              session has been confirmed and has started, not only once it's been
              marked complete, so it can actually gate "Mark complete" below. */}
          {isPeer &&
            isCoachee &&
            (session.status === "completed" || (session.status === "confirmed" && sessionStarted)) && (
              <PeerCompetencyFeedback existing={feedback} onSave={savePeerFeedback} onSaved={reload} />
            )}
          {isPeer && session.status === "completed" && isCoach && feedback.existed && (
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
              <p className="eyebrow text-primary">{t("detail.sessionFocus.eyebrow")}</p>
              <p className="font-display mt-4 text-[1.6rem] leading-snug">{session.topic}</p>
              <div className="mt-7 grid grid-cols-2 gap-4 border-t border-primary-foreground/15 pt-6">
                <div>
                  <p className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-primary">{t("detail.sessionFocus.dateLabel")}</p>
                  <p className="font-display mt-2 text-[1.7rem] leading-none">{format(start, "d MMM")}</p>
                </div>
                <div>
                  <p className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-primary">{t("detail.sessionFocus.durationLabel")}</p>
                  <p className="font-display mt-2 text-[1.7rem] leading-none">
                    {t("detail.sessionFocus.durationValue", { n: session.duration_minutes })}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {openItems.length > 0 && (
            <Card className="animate-rise p-7">
              <p className="eyebrow text-primary">{t("detail.prepare")}</p>
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
              <p className="eyebrow text-primary">{t("detail.meetingLink.adminEyebrow")}</p>
              <Input
                value={meetingUrl}
                onChange={(e) => setMeetingUrl(e.target.value)}
                placeholder={t("detail.meetingLink.placeholder")}
                type="url"
                maxLength={500}
              />
              <p className="text-xs text-muted-foreground">
                {t("detail.meetingLink.helper")}
              </p>
              <div className="flex items-center justify-between gap-2">
                {meetingUrl && /^https?:\/\//i.test(meetingUrl) ? (
                  <a
                    href={meetingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.16em] text-primary hover:underline"
                  >
                    <Video className="h-3 w-3" /> {t("detail.meetingLink.testLink")}
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground">{t("detail.meetingLink.noLinkSaved")}</span>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => {
                    const trimmed = meetingUrl.trim();
                    if (trimmed && !/^https?:\/\//i.test(trimmed)) {
                      toast.error(t("detail.toast.meetingLinkInvalid"));
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
                  {t("detail.meetingLink.save")}
                </Button>
              </div>
            </Card>
          ) : (
            session.status === "confirmed" &&
            !session.meeting_url && (
              <Card className="space-y-2 p-7">
                <p className="eyebrow text-primary">{t("detail.meetingLink.pendingEyebrow")}</p>
                <p className="text-sm text-muted-foreground">
                  {t("detail.meetingLink.pendingBody")}
                </p>
              </Card>
            )
          )}

          <Card className="space-y-5 p-7">
            <p className="eyebrow text-primary">{t("detail.participants")}</p>
            <Participant label={t("detail.counterpartRole.coach")} name={coach?.full_name} email={coach?.email} tone="primary" />
            <Participant label={t("detail.counterpartRole.coachee")} name={coachee?.full_name} email={coachee?.email} tone="success" />
          </Card>

          {(isCoach || canCancel) && (
            <Card className="flex flex-wrap gap-2 p-7">
              {isCoach && session.status === "pending_coach_approval" && (
                <Button className="rounded-full" onClick={confirmSession} disabled={saving}>
                  <CheckCircle2 className="mr-1 h-4 w-4" /> {t("detail.confirmSession")}
                </Button>
              )}
              {isCoach && session.status === "confirmed" && sessionStarted && (
                <div className="w-full space-y-2">
                  <Button
                    variant="secondary"
                    className="rounded-full"
                    onClick={completeSession}
                    disabled={saving || !canMarkComplete}
                  >
                    {t("detail.markComplete")}
                  </Button>
                  {!canMarkComplete && (
                    <p className="text-xs text-muted-foreground">{missingRequirementHint}</p>
                  )}
                </div>
              )}
              {canCancel && (
                <Button
                  variant="destructive"
                  className="rounded-full"
                  onClick={handleCancelSession}
                  disabled={saving}
                >
                  {t("detail.cancelSession")}
                </Button>
              )}
            </Card>
          )}

          <Card className="flex items-center gap-3 bg-primary-soft/40 p-6">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-card text-primary">
              <HelpCircle className="h-4 w-4" />
            </div>
            <div className="text-sm">
              <p className="font-semibold">{t("detail.help.title")}</p>
              <a
                href="mailto:contact@clariva.club"
                className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary"
              >
                {t("detail.help.contact")}
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

const COMPETENCY_KEYS: { key: keyof Omit<PeerFeedbackState, "feedback_note" | "existed">; i18nKey: string }[] = [
  { key: "ethical_practice", i18nKey: "ethicalPractice" },
  { key: "coaching_mindset", i18nKey: "coachingMindset" },
  { key: "maintains_agreements", i18nKey: "maintainsAgreements" },
  { key: "trust_safety", i18nKey: "trustSafety" },
  { key: "maintains_presence", i18nKey: "maintainsPresence" },
  { key: "listens_actively", i18nKey: "listensActively" },
  { key: "evokes_awareness", i18nKey: "evokesAwareness" },
  { key: "facilitates_growth", i18nKey: "facilitatesGrowth" },
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
  const { t } = useTranslation("sessions");
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
        <p className="eyebrow text-primary">{t("detail.peerFeedback.eyebrow")}</p>
        <h2 className="font-display mt-3 text-[1.6rem] leading-tight">
          {t("detail.peerFeedback.heading")}{" "}
          {readOnly && <span className="text-sm text-muted-foreground">{t("detail.peerFeedback.readOnlySuffix")}</span>}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("detail.peerFeedback.subtitle")}
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {COMPETENCY_KEYS.map((c) => (
          <div key={c.key} className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{t(`detail.peerFeedback.competencies.${c.i18nKey}`)}</span>
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
        <p className="eyebrow mb-2 text-primary">{t("detail.peerFeedback.writtenFeedback")}</p>
        <Textarea
          rows={4}
          disabled={readOnly}
          value={state.feedback_note}
          onChange={(e) => setState((p) => ({ ...p, feedback_note: e.target.value }))}
          placeholder={t("detail.peerFeedback.feedbackPlaceholder")}
        />
      </div>
      {!readOnly && (
        <div className="flex justify-end">
          <Button className="rounded-full" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            {state.existed ? t("detail.peerFeedback.updateFeedback") : t("detail.peerFeedback.submitFeedback")}
          </Button>
        </div>
      )}
    </Card>
  );
}

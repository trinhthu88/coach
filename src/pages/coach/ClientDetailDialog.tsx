import { useState } from "react";
import { Link } from "react-router-dom";
import { format, isBefore } from "date-fns";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CheckCircle2, StickyNote, Trash2, ArrowLeft, UserMinus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Tables } from "@/integrations/supabase/types";
import { useClientDetail, type FlatClientAction } from "@/hooks/coach/useClientDetail";
import { paletteFor, initialsOf, FILLS } from "./clientDisplay";

export function ClientDetailDialog({
  coacheeId,
  coachId,
  onClose,
  onChanged,
  onRemoved,
  removeClient,
}: {
  coacheeId: string;
  coachId: string;
  onClose: () => void;
  onChanged: () => void;
  onRemoved: () => void;
  removeClient: (coacheeId: string) => Promise<boolean>;
}) {
  const {
    profile,
    coacheeProfile,
    goals,
    milestones,
    sessions,
    notes,
    saving,
    addNote,
    deleteNote,
    allActions,
    overdue,
    dueWeek,
    completed,
    upcoming,
    past,
    overallPct,
    labelFor,
  } = useClientDetail(coacheeId, coachId, onChanged);

  const [newNote, setNewNote] = useState("");
  const [removing, setRemoving] = useState(false);

  const submitNote = async () => {
    if (!newNote.trim()) return;
    await addNote(newNote);
    setNewNote("");
  };

  const confirmRemove = async () => {
    setRemoving(true);
    const ok = await removeClient(coacheeId);
    setRemoving(false);
    if (ok) onRemoved();
  };

  const avPalette = paletteFor(coacheeId);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="sr-only">{profile?.full_name || "Client"}</DialogTitle>
        </DialogHeader>

        <div className="mb-2 flex items-center justify-between">
          <button onClick={onClose} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
            <ArrowLeft className="h-3 w-3" /> Back to overview
          </button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
                <UserMinus className="h-3.5 w-3.5" /> Remove client
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {profile?.full_name || "this client"}?</AlertDialogTitle>
                <AlertDialogDescription>
                  They'll lose access to book new sessions or message you. Past sessions, notes, and history
                  are kept — this isn't a delete, and you can be re-assigned to them again later if needed.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={confirmRemove}
                  disabled={removing}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {removing ? "Removing…" : "Remove client"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <div className="mb-4 flex items-start gap-3">
          <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-semibold", avPalette)}>
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt={profile.full_name} className="h-full w-full rounded-full object-cover" />
            ) : (
              initialsOf(profile?.full_name || "?")
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold">{profile?.full_name}</p>
            <p className="text-xs text-muted-foreground">
              {profile?.email}
              {coacheeProfile?.job_title && ` · ${coacheeProfile.job_title}`}
              {coacheeProfile?.industry && ` · ${coacheeProfile.industry}`}
            </p>
            {coacheeProfile?.goals && (
              <p className="mt-2 rounded-lg border bg-muted/30 p-2 text-xs">
                <span className="font-semibold">Stated goals:</span> {coacheeProfile.goals}
              </p>
            )}
          </div>
          <div className="hidden grid-cols-3 gap-2 md:grid">
            <MiniMetric label="Overall" value={`${overallPct}%`} />
            <MiniMetric label="Overdue" value={String(overdue.length)} tone={overdue.length ? "danger" : undefined} />
            <MiniMetric label="Next" value={upcoming[0] ? format(new Date(upcoming[upcoming.length - 1].start_time), "MMM d") : "—"} />
          </div>
        </div>

        <Tabs defaultValue="goals">
          <TabsList>
            <TabsTrigger value="goals">Goals & milestones</TabsTrigger>
            <TabsTrigger value="actions">Action items ({allActions.length})</TabsTrigger>
            <TabsTrigger value="sessions">Sessions ({sessions.length})</TabsTrigger>
            <TabsTrigger value="notes">Coach notes ({notes.length})</TabsTrigger>
          </TabsList>

          {/* GOALS */}
          <TabsContent value="goals" className="mt-4 space-y-4">
            {goals.length === 0 ? (
              <p className="text-sm text-muted-foreground">This coachee hasn't set goals yet.</p>
            ) : (
              goals.map((g, gi) => {
                const ms = milestones.filter((m) => m.goal_id === g.id);
                const done = ms.filter((m) => m.is_done).length;
                const pct = ms.length ? Math.round((done / ms.length) * 100) : 0;
                const fill = FILLS[gi % FILLS.length];
                return (
                  <div key={g.id}>
                    <div className="mb-1 flex items-baseline justify-between">
                      <p className="text-sm font-medium">{g.title}</p>
                      <span className="text-xs text-muted-foreground">{pct}% · {done}/{ms.length}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className={cn("h-full rounded-full", fill)} style={{ width: `${pct}%` }} />
                    </div>
                    {ms.length > 0 && (
                      <ul className="ml-1 mt-2 space-y-1.5 border-l-2 border-border pl-3">
                        {ms.map((m) => (
                          <li key={m.id} className="flex items-start gap-2 text-xs">
                            <span
                              className={cn(
                                "mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
                                m.is_done ? "bg-success" : "bg-muted ring-1 ring-border"
                              )}
                            />
                            <div className="flex-1">
                              <p className={cn("flex items-center gap-1", m.is_done && "text-muted-foreground")}>
                                {m.is_done && <CheckCircle2 className="h-3 w-3 text-success" />}
                                {m.title}
                              </p>
                              <p className="text-[10px] text-muted-foreground">
                                {m.is_done && m.done_at
                                  ? `Done ${format(new Date(m.done_at), "MMM d")}`
                                  : m.target_date
                                  ? `Target ${format(new Date(m.target_date), "MMM d")}`
                                  : "No target"}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })
            )}
          </TabsContent>

          {/* ACTIONS */}
          <TabsContent value="actions" className="mt-4">
            {allActions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No action items assigned yet.</p>
            ) : (
              <div className="space-y-4">
                <ActionGroup title="Overdue" tone="danger" items={overdue} labelFor={labelFor} />
                <ActionGroup title="Due this week" items={dueWeek} labelFor={labelFor} />
                <ActionGroup title="Completed" items={completed} labelFor={labelFor} />
              </div>
            )}
          </TabsContent>

          {/* SESSIONS */}
          <TabsContent value="sessions" className="mt-4 space-y-4">
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Upcoming · {upcoming.length}
              </p>
              {upcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground">None scheduled.</p>
              ) : (
                <div className="space-y-2">
                  {upcoming.map((s) => (
                    <SessionRow key={s.id} s={s} />
                  ))}
                </div>
              )}
            </div>
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Past · {past.length}
              </p>
              {past.length === 0 ? (
                <p className="text-sm text-muted-foreground">No past sessions.</p>
              ) : (
                <div className="space-y-2">
                  {past.map((s) => (
                    <SessionRow key={s.id} s={s} showRating />
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* NOTES */}
          <TabsContent value="notes" className="mt-4 space-y-3">
            <p className="text-xs text-muted-foreground">
              Private notes visible only to you. Use to track patterns and coaching strategy.
            </p>
            <Card className="space-y-2 p-3">
              <Textarea
                placeholder="Your private observations about this coachee…"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                rows={3}
              />
              <div className="flex justify-end">
                <Button onClick={submitNote} disabled={saving || !newNote.trim()} size="sm">
                  <StickyNote className="mr-1 h-4 w-4" /> Add note
                </Button>
              </div>
            </Card>
            {notes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No notes yet.</p>
            ) : (
              <div className="space-y-2">
                {notes.map((n) => (
                  <Card key={n.id} className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                      <button
                        onClick={() => deleteNote(n.id)}
                        className="-m-2 shrink-0 rounded-md p-2 text-muted-foreground hover:text-destructive"
                        aria-label="Delete note"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {format(new Date(n.created_at), "MMM d, yyyy · p")}
                    </p>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function MiniMetric({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-2 text-center">
      <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-sm font-semibold", tone === "danger" && "text-destructive")}>{value}</p>
    </div>
  );
}

function ActionGroup({
  title,
  tone,
  items,
  labelFor,
}: {
  title: string;
  tone?: "danger";
  items: FlatClientAction[];
  labelFor: (mid?: string | null) => string | undefined;
}) {
  if (!items.length) return null;
  return (
    <div>
      <p
        className={cn(
          "mb-1 border-b py-1 text-[11px] font-semibold",
          tone === "danger" ? "border-destructive/30 text-destructive" : "border-border text-muted-foreground"
        )}
      >
        {title} · {items.length}
      </p>
      <div className="divide-y">
        {items.map((a) => {
          const overdue = !a.item.done && a.item.due_date && isBefore(new Date(a.item.due_date), new Date());
          const lbl = labelFor(a.item.milestone_id);
          return (
            <div key={`${a.sessionId}-${a.idx}`} className="flex items-start gap-2 py-1.5">
              <span
                className={cn(
                  "mt-1 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border",
                  a.item.done && "border-success bg-success text-success-foreground",
                  !a.item.done && overdue && "border-destructive bg-destructive/10",
                  !a.item.done && !overdue && "border-border bg-muted"
                )}
              >
                {a.item.done && <CheckCircle2 className="h-3 w-3" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn("text-xs", a.item.done && "text-muted-foreground")}>{a.item.text}</p>
                <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px]">
                  {a.item.due_date && (
                    <span className={cn(overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
                      {a.item.done ? "Done" : overdue ? "Overdue" : "Due"} {format(new Date(a.item.due_date), "MMM d")}
                    </span>
                  )}
                  {lbl && <span className="text-primary">· {lbl}</span>}
                  <Link to={`/sessions/${a.sessionId}`} className="text-muted-foreground hover:text-primary">
                    · {a.topic}
                  </Link>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SessionRow({ s, showRating }: { s: Tables<"sessions">; showRating?: boolean }) {
  const d = new Date(s.start_time);
  return (
    <Link to={`/sessions/${s.id}`} className="block rounded-lg border p-3 text-sm transition hover:border-primary/40">
      <div className="flex items-start gap-3">
        <div className="w-10 shrink-0 text-center">
          <p className="text-base font-semibold leading-none">{format(d, "d")}</p>
          <p className="text-[10px] uppercase text-muted-foreground">{format(d, "MMM")}</p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{s.topic}</p>
          <p className="text-[11px] text-muted-foreground">
            {format(d, "p")} · {s.duration_minutes}m
          </p>
          <span className="mt-1 inline-block text-[10px] uppercase tracking-widest text-muted-foreground">
            {String(s.status).replace(/_/g, " ")}
          </span>
          {showRating && s.coachee_rating && (
            <p className="mt-1 text-[11px] text-warning">
              {"★".repeat(s.coachee_rating)}
              {"☆".repeat(5 - s.coachee_rating)}{" "}
              <span className="text-muted-foreground">— rated by coachee</span>
            </p>
          )}
          {showRating && s.coachee_rating_comment && (
            <p className="mt-1 rounded-md bg-muted/40 p-2 text-[11px] italic text-muted-foreground">
              "{s.coachee_rating_comment}"
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}

import { SessionGoalRatings } from "./session/SessionGoalRatings";
import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  ChevronLeft,
  Loader2,
  Video,
  Save,
  Upload,
  FileText,
  CheckCircle2,
} from "lucide-react";
import { format } from "date-fns";
import { useMentoringSessionCore } from "@/hooks/mentoring/useMentoringSessionCore";
import { useMentoringPrepFile } from "@/hooks/mentoring/useMentoringPrepFile";
import { useMentoringFeedback } from "@/hooks/mentoring/useMentoringFeedback";
import { MentorFeedbackForm } from "@/components/mentoring/MentorFeedbackForm";
import { getFriendlyErrorMessage } from "@/lib/errors";
import { getSessionStatusMeta as getStatusMeta } from "@/lib/sessionStatusMeta";
import { SessionDetailHero } from "@/components/sessions/SessionDetailHero";

export default function MentoringSessionDetail() {
  const { t } = useTranslation("mentoring");
  const { sessionId } = useParams<{ sessionId: string }>();
  const { user } = useAuth();

  const {
    session,
    mentor,
    mentee,
    loading,
    saving,
    mentorNotes,
    setMentorNotes,
    menteeNotes,
    setMenteeNotes,
    saveNotes,
    confirmSession,
    completeSession,
    reload,
  } = useMentoringSessionCore({ sessionId });

  const prep = useMentoringPrepFile({ sessionId, onSubmitted: reload });
  const [prepFile, setPrepFile] = useState<File | null>(null);
  const [prepNotes, setPrepNotes] = useState("");

  const feedback = useMentoringFeedback({
    sessionId,
    mentorId: session?.mentor_id,
    menteeId: session?.mentee_id,
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!session) {
    return (
      <Card className="p-12 text-center">
        <h2 className="text-xl font-semibold">{t("sessionDetail.notFound")}</h2>
        <Button asChild variant="outline" className="mt-6">
          <Link to="/mentoring">{t("sessionDetail.backToMentors")}</Link>
        </Button>
      </Card>
    );
  }

  const isMentor = user?.id === session.mentor_id;
  const isMentee = user?.id === session.mentee_id;
  const statusMeta = getStatusMeta(t)[session.status];

  const handleConfirm = async () => {
    const { error } = await confirmSession();
    if (error) toast.error(getFriendlyErrorMessage(error, t));
  };

  const handleComplete = async () => {
    const { error } = await completeSession();
    if (error) {
      // P0001 = the DB hard-gate trigger (enforce_mentoring_prep_file_before_completion)
      // rejecting the transition — show the specific reason instead of the raw message.
      if ((error as { code?: string }).code === "P0001") {
        toast.error(t("sessionDetail.prepFileRequiredToComplete"));
        return;
      }
      toast.error(getFriendlyErrorMessage(error, t));
      return;
    }
    toast.success(t("sessionDetail.markedComplete"));
  };

  const handleSaveNotes = async () => {
    const { error } = await saveNotes({ includeMentorNotes: isMentor, includeMenteeNotes: isMentee });
    if (error) toast.error(getFriendlyErrorMessage(error, t));
    else toast.success(t("sessionDetail.notesSaved"));
  };

  const handleSubmitPrepFile = async () => {
    if (!prepFile) return;
    await prep.submit(prepFile, prepNotes);
    setPrepFile(null);
    setPrepNotes("");
  };

  const counterpartName = isMentor ? mentee?.full_name : mentor?.full_name;

  return (
    <div className="space-y-6">
      <Link
        to="/mentoring"
        className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> {t("sessionDetail.backToMentors")}
      </Link>

      <SessionDetailHero
        type={t("sessionDetail.typeLabel")}
        title={session.topic}
        enrollmentId={session.enrollment_id}
        dateLabel={`${format(new Date(session.start_time), "EEE, MMM d · h:mm a")} · ${session.duration_minutes} ${t("sessionDetail.minutes")}`}
        roleLabel={isMentor ? t("sessionDetail.counterpartRole.mentee") : t("sessionDetail.counterpartRole.mentor")}
        counterpartName={counterpartName ?? null}
        status={{ label: statusMeta.label, className: statusMeta.className }}
        actions={
          <>
            {session.meeting_url &&
              (session.prep_file_path ? (
                <Button asChild size="lg" className="rounded-full bg-primary px-7 text-primary-foreground shadow-glow hover:bg-primary/90">
                  <a href={session.meeting_url} target="_blank" rel="noreferrer">
                    <Video className="mr-1.5 h-4 w-4" /> {t("sessionDetail.joinMeeting")}
                  </a>
                </Button>
              ) : (
                <span
                  className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-full bg-white/5 px-5 py-2.5 text-[12px] font-semibold text-white/50"
                  title={t("sessionDetail.joinLockedPrepFile")}
                >
                  <Video className="h-4 w-4" /> {t("sessionDetail.joinMeeting")}
                </span>
              ))}
            {isMentor && session.status === "pending_coach_approval" && (
              <Button
                onClick={handleConfirm}
                disabled={saving}
                variant="outline"
                className="rounded-full border-white/30 bg-white/5 text-white hover:bg-white/10 hover:text-white"
              >
                {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />}
                {t("sessionDetail.confirmSession")}
              </Button>
            )}
            {isMentor && session.status === "confirmed" && (
              <Button
                onClick={handleComplete}
                disabled={saving}
                variant="outline"
                className="rounded-full border-white/30 bg-white/5 text-white hover:bg-white/10 hover:text-white"
              >
                {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />}
                {t("sessionDetail.markComplete")}
              </Button>
            )}
          </>
        }
      />

      {/* Preparation file */}
      <Card className="space-y-4 p-4 sm:p-6">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("sessionDetail.prepFileSection")}</p>
        {session.prep_file_path ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3">
            <div className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4 text-primary" />
              <span>{t("sessionDetail.prepFileSubmitted")}</span>
            </div>
            <Button size="sm" variant="outline" onClick={() => prep.download(session.prep_file_path!)}>
              {t("sessionDetail.viewFile")}
            </Button>
          </div>
        ) : isMentee ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("sessionDetail.prepFilePrompt")}</p>
            <Input type="file" accept=".pdf,.docx" onChange={(e) => setPrepFile(e.target.files?.[0] || null)} />
            <Textarea
              rows={3}
              placeholder={t("sessionDetail.prepNotesPlaceholder")}
              value={prepNotes}
              onChange={(e) => setPrepNotes(e.target.value)}
            />
            <Button onClick={handleSubmitPrepFile} disabled={!prepFile || prep.uploading}>
              {prep.uploading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />}
              {t("sessionDetail.submitPrepFile")}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("sessionDetail.prepFileAwaited")}</p>
        )}
        {session.prep_file_notes && (
          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("sessionDetail.prepNotesLabel")}</p>
            <p className="text-sm">{session.prep_file_notes}</p>
          </div>
        )}
      </Card>

      {/* Notes */}
      <Card className="space-y-4 p-4 sm:p-6">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("sessionDetail.notesSection")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-semibold text-muted-foreground">{t("sessionDetail.mentorNotes")}</p>
            <Textarea rows={4} value={mentorNotes} disabled={!isMentor} onChange={(e) => setMentorNotes(e.target.value)} />
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-muted-foreground">{t("sessionDetail.menteeNotes")}</p>
            <Textarea rows={4} value={menteeNotes} disabled={!isMentee} onChange={(e) => setMenteeNotes(e.target.value)} />
          </div>
        </div>
        {(isMentor || isMentee) && (
          <Button size="sm" onClick={handleSaveNotes} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {t("sessionDetail.saveNotes")}
          </Button>
        )}
      </Card>

      {session.enrollment_id && <SessionGoalRatings sessionId={session.id} coacheeId={session.mentee_id} enrollmentId={session.enrollment_id} sourceActivityType="mentoring" canCreateGoal={isMentee} canEdit={isMentee && session.status === "completed"} sessionStatus={session.status} />}
      {/* Mentor feedback */}
      {(isMentor || isMentee) && (
        <MentorFeedbackForm feedback={feedback} isMentor={isMentor} canSubmit={isMentor && session.status === "completed"} />
      )}
    </div>
  );
}

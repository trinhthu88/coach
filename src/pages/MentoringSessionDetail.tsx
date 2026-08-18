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
  Clock,
  Loader2,
  Video,
  Save,
  Upload,
  FileText,
  CheckCircle2,
  XCircle,
  AlertCircle,
  LucideIcon,
} from "lucide-react";
import { format } from "date-fns";
import { useMentoringSessionCore } from "@/hooks/mentoring/useMentoringSessionCore";
import { useMentoringPrepFile } from "@/hooks/mentoring/useMentoringPrepFile";
import { getFriendlyErrorMessage } from "@/lib/errors";
import type { Database } from "@/integrations/supabase/types";

type MentoringStatus = Database["public"]["Enums"]["session_status"];

function getStatusMeta(t: (key: string) => string): Record<MentoringStatus, { label: string; className: string; icon: LucideIcon }> {
  return {
    pending_coach_approval: { label: t("status.pending_coach_approval"), className: "bg-warning/12 text-warning", icon: AlertCircle },
    confirmed: { label: t("status.confirmed"), className: "bg-primary-soft text-primary", icon: CheckCircle2 },
    completed: { label: t("status.completed"), className: "bg-success/12 text-success", icon: CheckCircle2 },
    cancelled: { label: t("status.cancelled"), className: "bg-destructive/10 text-destructive", icon: XCircle },
    rescheduled: { label: t("status.rescheduled"), className: "bg-muted text-muted-foreground", icon: Clock },
  };
}

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
  const StatusIcon = statusMeta.icon;

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

      <Card className="space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-[1.4rem] leading-[1.1] tracking-tight sm:text-[1.7rem]">{session.topic}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("sessionDetail.withCounterpart", { name: counterpartName || "—" })}
            </p>
          </div>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-widest ${statusMeta.className}`}>
            <StatusIcon className="h-3.5 w-3.5" /> {statusMeta.label}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-4 w-4" />
            {format(new Date(session.start_time), "EEE, MMM d · h:mm a")} · {session.duration_minutes} {t("sessionDetail.minutes")}
          </span>
          {session.meeting_url && (
            <a
              href={session.meeting_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline"
            >
              <Video className="h-4 w-4" /> {t("sessionDetail.joinMeeting")}
            </a>
          )}
        </div>

        {isMentor && session.status === "pending_coach_approval" && (
          <Button onClick={handleConfirm} disabled={saving}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />}
            {t("sessionDetail.confirmSession")}
          </Button>
        )}
        {isMentor && session.status === "confirmed" && (
          <Button onClick={handleComplete} disabled={saving} variant="outline">
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />}
            {t("sessionDetail.markComplete")}
          </Button>
        )}
      </Card>

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
    </div>
  );
}

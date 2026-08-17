import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { Loader2, Eye, Target, Calendar, Layers } from "lucide-react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Pill } from "../_shared";
import { useCoacheeProfileDetail } from "@/hooks/admin/useCoacheeProfileDetail";
import { STATUS_TONE, programmeCompletionPct, type Row } from "./coacheeDisplay";

interface CoacheeProfileSheetProps {
  row: Row | null;
  onClose: () => void;
}

export function CoacheeProfileSheet({ row, onClose }: CoacheeProfileSheetProps) {
  const { t } = useTranslation("admin");
  const { loading, goals, sessions, profileData } = useCoacheeProfileDetail(row?.id);

  if (!row) return null;
  const pct = programmeCompletionPct(row.enrollment_start_date, row.programme_duration_months);

  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-primary" /> {row.full_name}
          </SheetTitle>
          <SheetDescription>{row.email} · {t("coacheeProfileSheet.readOnly")}</SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-5 text-sm">
          {/* Profile information (from coachee's own profile editor) */}
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("coacheeProfileSheet.profileInformation")}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <ProfileField label={t("coacheeProfileSheet.jobTitle")} value={profileData?.job_title} />
              <ProfileField label={t("coacheeProfileSheet.industry")} value={profileData?.industry} />
              <ProfileField label={t("coacheeProfileSheet.location")} value={profileData?.location} />
              <ProfileField label={t("coacheeProfileSheet.timezone")} value={profileData?.timezone} />
              <ProfileField label={t("coacheeProfileSheet.phone")} value={profileData?.phone} />
              <ProfileField label={t("coacheeProfileSheet.registered")} value={format(new Date(row.created_at), "MMM d, yyyy")} />
            </div>
            {profileData?.bio && (
              <div className="mt-2 rounded-lg border bg-muted/20 p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("coacheeProfileSheet.bio")}</p>
                <p className="mt-1 whitespace-pre-wrap text-[12px]">{profileData.bio}</p>
              </div>
            )}
            {profileData?.goals && (
              <div className="mt-2 rounded-lg border bg-muted/20 p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("coacheeProfileSheet.goalsFreeText")}</p>
                <p className="mt-1 whitespace-pre-wrap text-[12px]">{profileData.goals}</p>
              </div>
            )}
          </div>

          {/* Status + programme */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("coacheeProfileSheet.status")}</p>
              <p className="mt-1"><Pill tone={STATUS_TONE[row.status]}>{t(`coachees.statusLabels.${row.status}`)}</Pill></p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("coacheeProfileSheet.sessions")}</p>
              <p className="mt-1 font-mono text-[13px]">{row.done}/{row.session_limit} <span className="text-muted-foreground">{t("coacheeProfileSheet.bookedSuffix", { count: row.booked })}</span></p>
            </div>
            <div className="sm:col-span-2 rounded-lg border bg-muted/20 p-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5"><Layers className="h-3 w-3" /> {t("coacheeProfileSheet.programme")}</p>
              <p className="mt-1 text-[13px] font-semibold">{row.programme_name || "—"}</p>
              {row.cohort_name && <p className="text-[11px] text-muted-foreground">{t("coacheeProfileSheet.cohortPrefix", { name: row.cohort_name })}</p>}
              {pct !== null && (
                <div className="mt-2">
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>{t("coacheeProfileSheet.programmeProgress")}</span><span className="font-mono">{pct}%</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Goals + ratings */}
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <Target className="h-3 w-3" /> {t("coacheeProfileSheet.goalsAndRatings")}
            </p>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
            {!loading && goals.length === 0 && (
              <p className="rounded-lg border border-dashed p-4 text-center text-[12px] text-muted-foreground">{t("coacheeProfileSheet.noActiveGoals")}</p>
            )}
            <div className="space-y-2">
              {goals.map((g) => (
                <div key={g.id} className="rounded-lg border p-2.5">
                  <p className="text-[12px] font-semibold">{g.title}</p>
                  <div className="mt-1.5 flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span>{t("coacheeProfileSheet.start")} <strong className="text-foreground">{g.start_rating}</strong></span>
                    <span>{t("coacheeProfileSheet.current")} <strong className="text-foreground">{g.current_rating}</strong></span>
                    <span>{t("coacheeProfileSheet.target")} <strong className="text-foreground">{g.target_rating}</strong></span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary" style={{ width: `${Math.min(100, g.current_rating)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Selected coaches */}
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("coacheeProfileSheet.selectedCoaches")}</p>
            <div className="flex flex-wrap gap-1.5">
              {row.selected_coaches.length === 0 && <span className="text-[11px] italic text-muted-foreground">{t("coacheeProfileSheet.none")}</span>}
              {row.selected_coaches.map((c) => (
                <span key={c.id} className="rounded-full border bg-muted/40 px-2 py-0.5 text-[11px]">{c.name}</span>
              ))}
            </div>
          </div>

          {/* Sessions */}
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <Calendar className="h-3 w-3" /> {t("coacheeProfileSheet.recentSessions")}
            </p>
            <div className="space-y-1">
              {sessions.length === 0 && (
                <p className="rounded-lg border border-dashed p-3 text-center text-[12px] text-muted-foreground">{t("coacheeProfileSheet.noSessionsYet")}</p>
              )}
              {sessions.map((s) => (
                <Link
                  key={s.id}
                  to={`/sessions/${s.id}`}
                  className="flex items-center justify-between rounded-lg border px-3 py-2 text-[12px] hover:bg-muted/30"
                >
                  <span className="truncate pr-2">{s.topic}</span>
                  <span className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>{format(new Date(s.start_time), "MMM d")}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5">{s.status}</span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>

        <SheetFooter className="mt-6">
          <Button variant="outline" onClick={onClose}>{t("coacheeProfileSheet.close")}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function ProfileField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-lg border bg-muted/10 px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words text-[12px]">{value || <span className="italic text-muted-foreground">—</span>}</p>
    </div>
  );
}

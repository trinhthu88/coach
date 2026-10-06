import { useTranslation } from "react-i18next";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatAssessmentDate } from "@/lib/assessments";
import { useAdminTranscriptionCalls, type TranscriptionCall } from "@/hooks/assessments/useFinalAssessmentResult";
import { Pill, SectionCard } from "../_shared";

// OpenAI Whisper list price (USD per audio minute). An estimate for Admin; the
// invoice is the authority.
export const WHISPER_USD_PER_MINUTE = 0.006;
const RECENT = 10;

const monthOf = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit" }).format(new Date(iso));

function totals(calls: TranscriptionCall[]) {
  const minutes = calls.reduce((sum, c) => sum + (c.audioMinutes ?? 0), 0);
  return { calls: calls.length, minutes, usd: minutes * WHISPER_USD_PER_MINUTE };
}

/**
 * Admin -> Assessments: the cost of automatic transcription, from the call log
 * (admin_final_assessment_transcriptions: attempt, learner, audio minutes, time).
 */
export function TranscriptionCost() {
  const { t } = useTranslation("admin");
  const { data, isLoading, isError } = useAdminTranscriptionCalls();
  if (isLoading) return null;
  if (isError) return <p className="mb-4 text-[12px] text-destructive">{t("assessments.transcription.loadError")}</p>;
  const calls = data ?? [];
  const thisMonth = monthOf(new Date().toISOString());
  const month = totals(calls.filter((c) => monthOf(c.startedAt) === thisMonth));
  const all = totals(calls);
  const line = (x: ReturnType<typeof totals>) =>
    t("assessments.transcription.totals", { calls: x.calls, minutes: x.minutes.toFixed(1), usd: x.usd.toFixed(2) });

  return (
    <SectionCard label={t("assessments.transcription.title")} className="mb-4">
      <div data-testid="admin-transcription-cost" className="space-y-3">
        <dl className="grid gap-2 text-[12.5px] sm:grid-cols-2">
          <div>
            <dt className="text-[11px] text-muted-foreground">{t("assessments.transcription.thisMonth")}</dt>
            <dd data-testid="admin-transcription-month">{line(month)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted-foreground">{t("assessments.transcription.allTime")}</dt>
            <dd data-testid="admin-transcription-all">{line(all)}</dd>
          </div>
        </dl>
        <p className="text-[11px] text-muted-foreground">
          {t("assessments.transcription.estimate", { price: WHISPER_USD_PER_MINUTE })}
        </p>
        {calls.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("assessments.transcription.when")}</TableHead>
                  <TableHead>{t("assessments.transcription.learner")}</TableHead>
                  <TableHead>{t("assessments.transcription.attempt")}</TableHead>
                  <TableHead>{t("assessments.transcription.minutes")}</TableHead>
                  <TableHead>{t("assessments.transcription.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calls.slice(0, RECENT).map((c) => (
                  <TableRow key={c.id} data-testid="admin-transcription-row">
                    <TableCell>{formatAssessmentDate(c.startedAt)}</TableCell>
                    <TableCell>{c.learnerName ?? "—"}</TableCell>
                    <TableCell>{c.attemptNo}</TableCell>
                    <TableCell>{c.audioMinutes != null ? c.audioMinutes.toFixed(1) : "—"}</TableCell>
                    <TableCell>
                      <Pill tone={c.status === "succeeded" ? "success" : c.status === "failed" ? "destructive" : "muted"}>
                        {t(`assessments.transcription.statuses.${c.status}`)}
                      </Pill>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

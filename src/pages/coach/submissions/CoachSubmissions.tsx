import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { assessmentLabel, formatAssessmentDate } from "@/lib/assessments";
import {
  COACH_INBOX_TABS,
  useCoachAssessmentInbox,
  type CoachInboxRow,
  type CoachInboxTab,
} from "@/hooks/assessments/useCoachAssessments";

const ALL = "all";

/**
 * Coach -> Submissions: everything Admin has assigned this coach to assess,
 * from coach_assessment_inbox, in four tabs. Filter by cohort and kind.
 */
export default function CoachSubmissions() {
  const { t } = useTranslation("assessments");
  const [params, setParams] = useSearchParams();
  const tab = (COACH_INBOX_TABS as string[]).includes(params.get("tab") ?? "") ? (params.get("tab") as CoachInboxTab) : "to_assess";
  const [cohortId, setCohortId] = useState(ALL);
  const [kind, setKind] = useState(ALL);
  const { data: rows = [], isLoading, isError } = useCoachAssessmentInbox();

  const cohorts = useMemo(
    () => Array.from(new Map(rows.map((r) => [r.cohortId, r.cohortName])).entries()).sort((a, b) => a[1].localeCompare(b[1])),
    [rows],
  );
  const filtered = rows.filter((r) => (cohortId === ALL || r.cohortId === cohortId) && (kind === ALL || r.kind === kind));
  const counts = Object.fromEntries(COACH_INBOX_TABS.map((k) => [k, filtered.filter((r) => r.tab === k).length])) as Record<CoachInboxTab, number>;
  const visible = filtered.filter((r) => r.tab === tab);

  return (
    <div>
      <PageHeader eyebrow={t("inbox.eyebrow")} title={t("inbox.title")} subtitle={t("inbox.subtitle")} />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:max-w-xl">
        <div>
          <Label className="text-xs">{t("inbox.filters.cohort")}</Label>
          <Select value={cohortId} onValueChange={setCohortId}>
            <SelectTrigger data-testid="coach-submissions-cohort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("inbox.filters.allCohorts")}</SelectItem>
              {cohorts.map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">{t("inbox.filters.kind")}</Label>
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger data-testid="coach-submissions-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("inbox.filters.allKinds")}</SelectItem>
              <SelectItem value="triad">{t("kind.triad")}</SelectItem>
              <SelectItem value="final_assessment">{t("kind.final_assessment")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setParams(v === "to_assess" ? {} : { tab: v }, { replace: true })}>
        <TabsList className="flex-wrap">
          {COACH_INBOX_TABS.map((k) => (
            <TabsTrigger key={k} value={k} data-testid={`coach-submissions-tab-${k}`}>
              {t(`inbox.tabs.${k}`)} ({counts[k]})
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="mt-4">
        {isError ? (
          <p role="alert" className="text-sm text-destructive" data-testid="coach-submissions-error">
            {t("inbox.loadError")}
          </p>
        ) : isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : visible.length === 0 ? (
          <Card className="p-10 text-center text-sm text-muted-foreground" data-testid="coach-submissions-empty">
            {t(`inbox.empty.${tab}`)}
          </Card>
        ) : (
          <ul className="space-y-2">
            {visible.map((r) => (
              <InboxRow key={r.submissionId} row={r} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function InboxRow({ row }: { row: CoachInboxRow }) {
  const { t } = useTranslation("assessments");
  return (
    <li data-testid="coach-submission-row" data-tab={row.tab}>
      <Link to={`/coach/submissions/${row.submissionId}`}>
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4 transition-colors hover:border-primary">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {row.learnerName} · {assessmentLabel(row, t, "")}
            </p>
            <p className="text-xs text-muted-foreground">
              {row.cohortName} · {t("inbox.submitted", { date: formatAssessmentDate(row.submittedAt) })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {row.tab === "released" ? (
              <span className="text-xs text-muted-foreground">{t("inbox.released", { date: formatAssessmentDate(row.releasedAt) })}</span>
            ) : row.dueOn ? (
              <span className={cn("text-xs", row.isOverdue ? "font-semibold text-destructive" : "text-muted-foreground")}>
                {t("inbox.due", { date: formatAssessmentDate(row.dueOn) })}
              </span>
            ) : null}
            {row.isOverdue && <Badge variant="destructive">{t("inbox.overdue")}</Badge>}
            <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
          </div>
        </Card>
      </Link>
    </li>
  );
}

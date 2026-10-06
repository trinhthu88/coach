import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { format, parseISO } from "date-fns";
import { FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getFriendlyErrorMessage } from "@/lib/errors";
import {
  ASSESSMENT_STATUSES,
  ASSIGNABLE_STATUSES,
  assessmentFileUrl,
  assessmentRefusal,
  useAdminAssessmentMutations,
  useAdminAssessmentQueue,
  useCohortAssessorPools,
  type AssessmentKind,
  type AssessmentQueueRow,
  type AssessmentStatus,
} from "@/hooks/assessments/useAdminAssessments";
import { Pill } from "../_shared";

const ALL = "all";

const STATUS_TONE: Record<AssessmentStatus, "muted" | "primary" | "warning" | "destructive" | "success"> = {
  awaiting_assignment: "warning",
  with_assessor: "primary",
  awaiting_validation: "warning",
  returned: "destructive",
  released: "success",
};

function formatDate(value: string | null) {
  return value ? format(parseISO(value), "d MMM yyyy") : "—";
}

function assessmentLabel(row: Pick<AssessmentQueueRow, "kind" | "requirementOrdinal" | "attemptNo">, t: TFunction) {
  if (row.kind === "triad") return t("assessments.triadN", { n: row.requirementOrdinal });
  return row.attemptNo > 1
    ? t("assessments.finalAttempt", { n: row.attemptNo })
    : t("assessments.kind.final_assessment");
}

/** Show a known server refusal in plain words; anything else gets the generic copy. */
function stepError(e: unknown, t: TFunction) {
  const refusal = assessmentRefusal(e);
  return refusal ? t(`assessments.errors.${refusal}`) : getFriendlyErrorMessage(e, t);
}

/**
 * The Admin assessment queue, on admin_assessment_queue. Used by Admin ->
 * Assessments (every kind) and Admin -> Triads -> Submissions (kind locked to
 * Triad). Admin assigns or reassigns from the cohort's assessor pool, reads
 * the latest review, and approves it (releases + notifies the learner) or
 * returns it to the assessor with a reason.
 */
export function AssessmentQueue({ lockedKind }: { lockedKind?: AssessmentKind }) {
  const { t } = useTranslation("admin");
  const [programmeId, setProgrammeId] = useState<string>(ALL);
  const [cohortId, setCohortId] = useState<string>(ALL);
  const [kind, setKind] = useState<string>(lockedKind ?? ALL);
  const [status, setStatus] = useState<string>(ALL);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assigning, setAssigning] = useState<AssessmentQueueRow[] | null>(null);
  const [reviewing, setReviewing] = useState<AssessmentQueueRow | null>(null);

  const { data: options } = useQuery({
    queryKey: ["admin-assessment-filter-options"],
    queryFn: async () => {
      const [{ data: programmes, error: pErr }, { data: cohorts, error: cErr }] = await Promise.all([
        supabase.from("programmes").select("id, name").order("name"),
        supabase.from("cohorts").select("id, name, programme_id").order("start_date", { ascending: false }),
      ]);
      if (pErr) throw pErr;
      if (cErr) throw cErr;
      return { programmes: programmes ?? [], cohorts: cohorts ?? [] };
    },
  });
  const cohortOptions = (options?.cohorts ?? []).filter((c) => programmeId === ALL || c.programme_id === programmeId);

  const effectiveKind = lockedKind ?? (kind === ALL ? null : (kind as AssessmentKind));
  const { data: rows = [], isLoading, isError } = useAdminAssessmentQueue({
    programmeId: programmeId === ALL ? null : programmeId,
    cohortId: cohortId === ALL ? null : cohortId,
    kind: effectiveKind,
    status: status === ALL ? null : (status as AssessmentStatus),
  });

  const assignable = rows.filter((r) => ASSIGNABLE_STATUSES.includes(r.status));
  // A selection only ever holds rows that are still in the (filtered) queue and assignable.
  const selectedRows = assignable.filter((r) => selected.has(r.submissionId));
  const allSelected = assignable.length > 0 && selectedRows.length === assignable.length;

  const toggleRow = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <div className="space-y-4" data-testid="assessment-queue">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FilterSelect
          label={t("assessments.filters.programme")}
          value={programmeId}
          onChange={(v) => {
            setProgrammeId(v);
            setCohortId(ALL);
          }}
          testId="assessment-filter-programme"
          options={(options?.programmes ?? []).map((p) => ({ value: p.id, label: p.name }))}
          allLabel={t("assessments.filters.allProgrammes")}
        />
        <FilterSelect
          label={t("assessments.filters.cohort")}
          value={cohortId}
          onChange={setCohortId}
          testId="assessment-filter-cohort"
          options={cohortOptions.map((c) => ({ value: c.id, label: c.name }))}
          allLabel={t("assessments.filters.allCohorts")}
        />
        {!lockedKind && (
          <FilterSelect
            label={t("assessments.filters.kind")}
            value={kind}
            onChange={setKind}
            testId="assessment-filter-kind"
            options={(["triad", "final_assessment"] as const).map((k) => ({ value: k, label: t(`assessments.kind.${k}`) }))}
            allLabel={t("assessments.filters.allKinds")}
          />
        )}
        <FilterSelect
          label={t("assessments.filters.status")}
          value={status}
          onChange={setStatus}
          testId="assessment-filter-status"
          options={ASSESSMENT_STATUSES.map((s) => ({ value: s, label: t(`assessments.status.${s}`) }))}
          allLabel={t("assessments.filters.allStatuses")}
        />
      </div>

      {selectedRows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-primary/40 bg-primary-soft px-3 py-2" data-testid="assessment-bulk-bar">
          <span className="text-sm font-medium">{t("assessments.selectedCount", { count: selectedRows.length })}</span>
          <Button size="sm" onClick={() => setAssigning(selectedRows)} data-testid="assessment-bulk-assign">
            {t("assessments.assignSelected")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            {t("assessments.clearSelection")}
          </Button>
        </div>
      )}

      <Card className="overflow-x-auto p-0">
        {isError ? (
          <p role="alert" className="p-6 text-sm text-destructive" data-testid="assessment-queue-error">
            {t("assessments.loadError")}
          </p>
        ) : isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground" data-testid="assessment-queue-empty">
            {t("assessments.empty")}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    checked={allSelected}
                    disabled={assignable.length === 0}
                    onCheckedChange={(v) => setSelected(v ? new Set(assignable.map((r) => r.submissionId)) : new Set())}
                    aria-label={t("assessments.selectAll")}
                  />
                </TableHead>
                <TableHead>{t("assessments.columns.learner")}</TableHead>
                <TableHead>{t("assessments.columns.cohort")}</TableHead>
                <TableHead>{t("assessments.columns.assessment")}</TableHead>
                <TableHead>{t("assessments.columns.submitted")}</TableHead>
                <TableHead>{t("assessments.columns.status")}</TableHead>
                <TableHead>{t("assessments.columns.assessor")}</TableHead>
                <TableHead>{t("assessments.columns.assessorDue")}</TableHead>
                <TableHead>{t("assessments.columns.learnerViewed")}</TableHead>
                <TableHead className="text-right">{t("assessments.columns.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const canAssign = ASSIGNABLE_STATUSES.includes(r.status);
                return (
                  <TableRow key={r.submissionId} data-testid="assessment-row" data-status={r.status}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(r.submissionId) && canAssign}
                        disabled={!canAssign}
                        onCheckedChange={(v) => toggleRow(r.submissionId, !!v)}
                        aria-label={t("assessments.selectRow", { name: r.learnerName })}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{r.learnerName}</TableCell>
                    <TableCell>
                      <div className="text-sm">{r.cohortName}</div>
                      <div className="text-[11px] text-muted-foreground">{r.programmeName}</div>
                    </TableCell>
                    <TableCell>{assessmentLabel(r, t)}</TableCell>
                    <TableCell>{formatDate(r.submittedAt)}</TableCell>
                    <TableCell>
                      <Pill tone={STATUS_TONE[r.status]}>{t(`assessments.status.${r.status}`)}</Pill>
                    </TableCell>
                    <TableCell>{r.assessorName ?? "—"}</TableCell>
                    <TableCell data-testid="assessment-due">
                      {r.dueOn ? (
                        <span className="inline-flex items-center gap-1.5">
                          {formatDate(r.dueOn)}
                          {r.reviewOverdue && <Pill tone="destructive">{t("assessments.overdue")}</Pill>}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell data-testid="assessment-viewed">
                      {r.status !== "released" ? "—" : r.viewedAt ? formatDate(r.viewedAt) : t("assessments.notViewed")}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5">
                        {canAssign && (
                          <Button size="sm" variant="outline" onClick={() => setAssigning([r])} data-testid="assessment-assign">
                            {r.assessorId ? t("assessments.reassign") : t("assessments.assign")}
                          </Button>
                        )}
                        {r.reviewId && (
                          <Button
                            size="sm"
                            variant={r.status === "awaiting_validation" ? "default" : "ghost"}
                            onClick={() => setReviewing(r)}
                            data-testid="assessment-open-review"
                          >
                            {r.status === "awaiting_validation" ? t("assessments.validate") : t("assessments.readReview")}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {assigning && (
        <AssignDialog
          rows={assigning}
          onClose={() => setAssigning(null)}
          onAssigned={() => {
            setAssigning(null);
            setSelected(new Set());
          }}
        />
      )}
      {reviewing && <ReviewDialog row={reviewing} onClose={() => setReviewing(null)} />}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  allLabel: string;
  testId: string;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger data-testid={testId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Assign or reassign one or many submissions. Only a Coach active in the pool
 * of EVERY selected submission's cohort is offered; the server also refuses
 * the learner's own programme coach, and the whole call is one transaction.
 */
function AssignDialog({
  rows,
  onClose,
  onAssigned,
}: {
  rows: AssessmentQueueRow[];
  onClose: () => void;
  onAssigned: () => void;
}) {
  const { t } = useTranslation("admin");
  const cohortIds = useMemo(() => Array.from(new Set(rows.map((r) => r.cohortId))), [rows]);
  const { pools, loading, error } = useCohortAssessorPools(cohortIds);
  const { assign } = useAdminAssessmentMutations();
  const [assessorId, setAssessorId] = useState<string>("");

  const candidates = useMemo(() => {
    if (pools.size < cohortIds.length) return [];
    const [first, ...rest] = cohortIds.map((id) => pools.get(id) ?? []);
    return (first ?? []).filter((c) => rest.every((pool) => pool.some((p) => p.coachId === c.coachId)));
  }, [pools, cohortIds]);

  const submit = () =>
    assign.mutate(
      { submissionIds: rows.map((r) => r.submissionId), assessorId },
      {
        onSuccess: (n) => {
          toast.success(t("assessments.assignedToast", { count: n }));
          onAssigned();
        },
        onError: (e) => toast.error(stepError(e, t)),
      },
    );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-testid="assessment-assign-dialog">
        <DialogHeader>
          <DialogTitle>
            {rows.length === 1
              ? t("assessments.assignTitleOne", { name: rows[0].learnerName, assessment: assessmentLabel(rows[0], t) })
              : t("assessments.assignTitleMany", { count: rows.length })}
          </DialogTitle>
          <DialogDescription>{t("assessments.assignHint")}</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">{t("assessments.poolLoadError")}</p>
        ) : loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : candidates.length === 0 ? (
          <p className="text-sm text-warning" data-testid="assessment-assign-no-pool">
            {cohortIds.length > 1 ? t("assessments.noSharedPool") : t("assessments.noPool")}
          </p>
        ) : (
          <div>
            <Label className="text-xs">{t("assessments.assessorLabel")}</Label>
            <Select value={assessorId} onValueChange={setAssessorId}>
              <SelectTrigger data-testid="assessment-assessor-select">
                <SelectValue placeholder={t("assessments.assessorPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((c) => (
                  <SelectItem key={c.coachId} value={c.coachId}>
                    {c.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {rows.length === 1 && rows[0].assessorName && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {t("assessments.currentAssessor", { name: rows[0].assessorName })}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("assessments.cancel")}
          </Button>
          <Button onClick={submit} disabled={!assessorId || assign.isPending} data-testid="assessment-assign-confirm">
            {assign.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("assessments.assign")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Read the latest review; while it awaits validation, approve it or return it with a reason. */
function ReviewDialog({ row, onClose }: { row: AssessmentQueueRow; onClose: () => void }) {
  const { t } = useTranslation("admin");
  const { validate } = useAdminAssessmentMutations();
  const [reason, setReason] = useState("");
  const [returning, setReturning] = useState(false);
  const canDecide = row.status === "awaiting_validation" && !!row.reviewId && !row.lastDecision;

  const decide = (decision: "approved" | "returned") =>
    validate.mutate(
      { reviewId: row.reviewId!, decision, reason: decision === "returned" ? reason.trim() : undefined },
      {
        onSuccess: () => {
          toast.success(decision === "approved" ? t("assessments.approvedToast") : t("assessments.returnedToast"));
          onClose();
        },
        onError: (e) => toast.error(stepError(e, t)),
      },
    );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="assessment-review-dialog">
        <DialogHeader>
          <DialogTitle>
            {t("assessments.reviewTitle", { name: row.learnerName, assessment: assessmentLabel(row, t) })}
          </DialogTitle>
          <DialogDescription>
            {t("assessments.reviewMeta", {
              assessor: row.assessorName ?? "—",
              version: row.reviewVersion ?? 1,
              date: formatDate(row.reviewSubmittedAt),
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {row.kind === "final_assessment" && row.reviewOutcome && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("assessments.outcomeLabel")}</p>
              <Pill tone={row.reviewOutcome === "pass" ? "success" : row.reviewOutcome === "not_pass" ? "destructive" : "warning"}>
                {t(`assessments.outcome.${row.reviewOutcome}`)}
              </Pill>
            </div>
          )}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("assessments.feedbackLabel")}</p>
            {row.reviewText ? (
              <p className="mt-1 whitespace-pre-wrap rounded-md border border-border bg-muted/20 p-3 text-sm" data-testid="assessment-review-text">
                {row.reviewText}
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">{t("assessments.noFeedbackText")}</p>
            )}
          </div>
          {row.reviewFiles.length > 0 && (
            <ul className="space-y-1.5">
              {row.reviewFiles.map((f) => (
                <ReviewFileLink key={f.storagePath} path={f.storagePath} />
              ))}
            </ul>
          )}
          {row.lastDecision === "returned" && row.lastReason && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm" data-testid="assessment-last-reason">
              <span className="font-semibold">{t("assessments.returnedWith")}</span> {row.lastReason}
            </p>
          )}
          {row.status === "released" && (
            <p className="text-sm text-muted-foreground">
              {t("assessments.releasedOn", { date: formatDate(row.releasedAt) })}{" "}
              {row.viewedAt ? t("assessments.viewedOn", { date: formatDate(row.viewedAt) }) : t("assessments.notViewedYet")}
            </p>
          )}
          {canDecide && returning && (
            <div>
              <Label htmlFor="assessment-return-reason">{t("assessments.returnReasonLabel")}</Label>
              <Textarea
                id="assessment-return-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("assessments.returnReasonPlaceholder")}
                data-testid="assessment-return-reason"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          {!canDecide ? (
            <Button variant="outline" onClick={onClose}>
              {t("assessments.close")}
            </Button>
          ) : returning ? (
            <>
              <Button variant="outline" onClick={() => setReturning(false)}>
                {t("assessments.cancel")}
              </Button>
              <Button
                variant="destructive"
                onClick={() => decide("returned")}
                disabled={!reason.trim() || validate.isPending}
                data-testid="assessment-return-confirm"
              >
                {validate.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("assessments.returnToAssessor")}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setReturning(true)} data-testid="assessment-return">
                {t("assessments.return")}
              </Button>
              <Button onClick={() => decide("approved")} disabled={validate.isPending} data-testid="assessment-approve">
                {validate.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("assessments.approve")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewFileLink({ path }: { path: string }) {
  const { t } = useTranslation("admin");
  const { data: url, isError } = useQuery({
    queryKey: ["assessment-file-url", path],
    queryFn: () => assessmentFileUrl(path),
    // Signed for five minutes; refresh well before that.
    staleTime: 4 * 60 * 1000,
  });
  const name = path.split("/").pop() ?? path;
  return (
    <li className="flex items-center gap-2 text-sm">
      <FileText className="h-4 w-4 text-muted-foreground" />
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
          {name}
        </a>
      ) : isError ? (
        <span className="text-destructive">{t("assessments.fileError")}</span>
      ) : (
        <span className="text-muted-foreground">{name}</span>
      )}
    </li>
  );
}

export default AssessmentQueue;

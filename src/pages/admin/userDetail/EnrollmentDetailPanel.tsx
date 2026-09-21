import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ProgrammeMetricCards } from "@/components/programme/ProgrammeMetricCards";
import { ReflectionFeedItem } from "@/components/programme/ReflectionFeedItem";
import { FeedbackItemCard } from "@/components/programme/FeedbackItemCard";
import { useModuleScopeLabel } from "@/components/programme/profileTheme";
import { useLearnerFeedback } from "@/hooks/dashboard/useLearnerFeedback";
import {
  useAdminEnrollmentDetail,
  type AdminEngagementRow,
  type AdminGoalCheckinRow,
  type AdminUserEnrollment,
} from "@/hooks/admin/useAdminUserDetail";
import { EMPTY_ENGAGEMENT, formatPercent, formatProfileDate } from "@/lib/programmeProfile";
import { sessionDetailPathFor } from "@/lib/sessionPaths";
import { Pill } from "../_shared";
import { ENROLLMENT_STATUS_TONE, MODULE_ORDER } from "./display";

function Section({ title, count, children, testId }: { title: string; count?: number; children: ReactNode; testId: string }) {
  return (
    <Card className="p-4" data-testid={testId}>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <p className="text-[9.5px] font-bold uppercase tracking-widest text-muted-foreground">{title}</p>
        {count != null && <span className="text-[10px] text-muted-foreground">{count}</span>}
      </div>
      {children}
    </Card>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-[12px] italic text-muted-foreground">{text}</p>;
}

/**
 * One enrollment's canonical detail for Admin. Every number is read from an
 * admin_* wrapper over the engine the learner and sponsor read (see
 * useAdminEnrollmentDetail); this component only arranges rows. Feedback is
 * read by the learner's own feedback reader (admin RLS covers those tables),
 * so Admin and Learner see the same items.
 */
export function EnrollmentDetailPanel({ userId, enrollment }: { userId: string; enrollment: AdminUserEnrollment }) {
  const { t } = useTranslation("admin");
  const moduleLabel = useModuleScopeLabel();
  const { data, isLoading, error } = useAdminEnrollmentDetail(enrollment.enrollment_id);
  const feedback = useLearnerFeedback(userId, enrollment.enrollment_id);

  if (isLoading) {
    return (
      <div className="space-y-3" data-testid="enrollment-detail-loading">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (error || !data) return <p className="text-sm text-destructive">{t("userDetail.detailError")}</p>;

  const engagement: AdminEngagementRow | null = data.engagement;
  const modules = MODULE_ORDER.map((key) => data.modules.find((m) => m.module === key)).filter(
    (m): m is NonNullable<typeof m> => !!m && (m.required_units > 0 || m.completed_units > 0 || m.booked_units > 0)
  );
  const checkinsByGoal = new Map<string, AdminGoalCheckinRow[]>();
  for (const c of data.checkins) checkinsByGoal.set(c.goal_id, [...(checkinsByGoal.get(c.goal_id) ?? []), c]);
  const status = enrollment.effective_enrollment_status;

  return (
    <div className="space-y-3" data-testid={`enrollment-detail-${enrollment.enrollment_id}`}>
      <Section title={t("userDetail.sections.enrollment")} testId="section-enrollment">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px] sm:grid-cols-[auto_1fr_auto_1fr]">
          <dt className="text-muted-foreground">{t("userDetail.fields.programme")}</dt><dd>{enrollment.programme_name ?? "—"}</dd>
          <dt className="text-muted-foreground">{t("userDetail.fields.cohort")}</dt><dd>{enrollment.cohort_name ?? "—"}</dd>
          <dt className="text-muted-foreground">{t("userDetail.fields.organization")}</dt><dd>{enrollment.organization_name ?? "—"}</dd>
          <dt className="text-muted-foreground">{t("userDetail.fields.status")}</dt>
          <dd className="flex flex-wrap items-center gap-1.5">
            <Pill tone={ENROLLMENT_STATUS_TONE[status] ?? "muted"}>{t(`userDetail.status.${status}`, { defaultValue: status })}</Pill>
            {enrollment.stored_enrollment_status !== status && (
              <span className="text-[10px] text-muted-foreground">
                {t("userDetail.storedStatus", { status: t(`userDetail.status.${enrollment.stored_enrollment_status}`, { defaultValue: enrollment.stored_enrollment_status }) })}
              </span>
            )}
          </dd>
          <dt className="text-muted-foreground">{t("userDetail.fields.start")}</dt><dd>{formatProfileDate(enrollment.start_date)}</dd>
          <dt className="text-muted-foreground">{t("userDetail.fields.end")}</dt><dd>{enrollment.end_date ? formatProfileDate(enrollment.end_date) : "—"}</dd>
        </dl>
        {data.progress && (
          <ProgrammeMetricCards facts={data.progress} engagement={engagement ?? EMPTY_ENGAGEMENT} viewer="sponsor" />
        )}
      </Section>

      <Section title={t("userDetail.sections.modules")} testId="section-modules">
        {modules.length === 0 ? (
          <Empty text={t("userDetail.empty.modules")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-3 text-left font-semibold">{t("userDetail.moduleHeaders.module")}</th>
                  <th className="px-2 py-1.5 text-right font-semibold">{t("userDetail.moduleHeaders.required")}</th>
                  <th className="px-2 py-1.5 text-right font-semibold">{t("userDetail.moduleHeaders.completed")}</th>
                  <th className="px-2 py-1.5 text-right font-semibold">{t("userDetail.moduleHeaders.due")}</th>
                  <th className="px-2 py-1.5 text-right font-semibold">{t("userDetail.moduleHeaders.booked")}</th>
                  <th className="px-2 py-1.5 text-right font-semibold">{t("userDetail.moduleHeaders.overdue")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {modules.map((m) => (
                  <tr key={m.module} data-testid={`module-row-${m.module}`}>
                    <td className="py-1.5 pr-3">{moduleLabel(m.module)}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{m.required_units}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{m.completed_units}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{m.due_units}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{m.booked_units}</td>
                    <td className={`px-2 py-1.5 text-right font-mono ${m.overdue_units > 0 ? "font-semibold text-destructive" : ""}`}>{m.overdue_units}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title={t("userDetail.sections.sessions")} count={data.sessions.length} testId="section-sessions">
        {data.sessions.length === 0 ? (
          <Empty text={t("userDetail.empty.sessions")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <tbody className="divide-y">
                {data.sessions.map((s) => {
                  const path = sessionDetailPathFor(s.source_table, s.source_id);
                  const title =
                    s.session_type === "triad" && s.requirement_unit_number != null
                      ? t("userDetail.triadN", { n: s.requirement_unit_number })
                      : s.title || t(`userDetail.sessionTypes.${s.session_type}`, { defaultValue: s.session_type });
                  return (
                    <tr key={s.session_key} data-testid="session-row">
                      <td className="whitespace-nowrap py-1.5 pr-3 text-muted-foreground">{formatProfileDate(s.start_time)}</td>
                      <td className="py-1.5 pr-3">
                        <Pill tone="muted">{t(`userDetail.sessionTypes.${s.session_type}`, { defaultValue: s.session_type })}</Pill>
                      </td>
                      <td className="py-1.5 pr-3">
                        {path ? <Link to={path} className="text-primary hover:underline">{title}</Link> : title}
                        {s.counterpart_names.length > 0 && (
                          <span className="block text-[10px] text-muted-foreground">{s.counterpart_names.join(", ")}</span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3">{t(`userDetail.sessionStatus.${s.status}`, { defaultValue: s.status })}</td>
                      <td className="py-1.5 text-right text-[10px] text-muted-foreground">
                        {s.is_programme_evidence ? t("userDetail.countsTowardProgramme") : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title={t("userDetail.sections.goals")} count={data.goals.length} testId="section-goals">
        {data.goals.length === 0 ? (
          <Empty text={t("userDetail.empty.goals")} />
        ) : (
          <ul className="space-y-3">
            {data.goals.map((g) => {
              const history = checkinsByGoal.get(g.goal_id) ?? [];
              return (
                <li key={g.goal_id} className="rounded-md border p-3" data-testid="goal-row">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-[12.5px] font-medium">{g.title}</p>
                    <span className="text-[11px] text-muted-foreground">
                      {g.has_rating
                        ? t("userDetail.goalRating", { start: g.start_rating ?? "—", current: g.current_rating ?? "—", target: g.target_rating ?? "—" })
                        : t("userDetail.goalNotRated")}
                      {" · "}
                      {formatPercent(g.progress_pct)}
                    </span>
                  </div>
                  {history.length > 0 && (
                    <ul className="mt-2 space-y-1 border-t pt-2 text-[11px]" data-testid="goal-checkins">
                      {history.map((c) => (
                        <li key={c.checkin_id} className="flex flex-wrap gap-x-2 text-muted-foreground">
                          <span>{formatProfileDate(c.created_at)}</span>
                          <span className="font-mono text-foreground">{`${c.previous_rating ?? "—"} → ${c.new_rating ?? "—"}`}</span>
                          <span>{t(`userDetail.sessionTypes.${c.source_activity_type}`, { defaultValue: c.source_activity_type })}</span>
                          {c.actor_name && <span>· {c.actor_name}</span>}
                          {c.note && <span className="basis-full italic">“{c.note}”</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title={t("userDetail.sections.actions")} count={data.actions.length} testId="section-actions">
        {engagement && (
          <p className="mb-2 text-[11px] text-muted-foreground">
            {t("userDetail.actionSummary", {
              open: engagement.open_action_count,
              completed: engagement.completed_action_count,
              total: engagement.total_action_count,
            })}
          </p>
        )}
        {data.actions.length === 0 ? (
          <Empty text={t("userDetail.empty.actions")} />
        ) : (
          <ul className="divide-y text-[12px]">
            {data.actions.map((a) => (
              <li key={a.action_id} className="flex flex-wrap items-center justify-between gap-2 py-1.5" data-testid="action-row">
                <span>
                  {a.title}
                  {a.goal_title && <span className="block text-[10px] text-muted-foreground">{a.goal_title}</span>}
                </span>
                <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  {a.due_date && t("userDetail.dueOn", { date: formatProfileDate(a.due_date) })}
                  <Pill tone={a.status === "completed" ? "success" : a.status === "cancelled" ? "muted" : "primary"}>
                    {t(`userDetail.actionStatus.${a.status}`, { defaultValue: a.status })}
                  </Pill>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("userDetail.sections.reflections")} count={data.reflections.length} testId="section-reflections">
        {data.reflections.length === 0 ? (
          <Empty text={t("userDetail.empty.reflections")} />
        ) : (
          <div className="space-y-2">
            {data.reflections.map((r) => <ReflectionFeedItem key={r.key} item={r} compact />)}
          </div>
        )}
      </Section>

      <Section title={t("userDetail.sections.feedback")} count={feedback.feedback.length} testId="section-feedback">
        {feedback.loading ? (
          <Skeleton className="h-16 w-full" />
        ) : feedback.error ? (
          <p className="text-[12px] text-destructive">{t("userDetail.detailError")}</p>
        ) : feedback.feedback.length === 0 ? (
          <Empty text={t("userDetail.empty.feedback")} />
        ) : (
          <div className="space-y-2">
            {feedback.feedback.map((f) => <FeedbackItemCard key={f.id} item={f} />)}
          </div>
        )}
      </Section>

      <Section title={t("userDetail.sections.satisfaction")} testId="section-satisfaction">
        {engagement?.satisfaction_avg == null ? (
          <Empty text={t("userDetail.empty.satisfaction")} />
        ) : (
          <p className="text-[12px]" data-testid="satisfaction-value">
            {t("userDetail.satisfactionValue", {
              value: Number(engagement.satisfaction_avg).toFixed(1),
              count: engagement.satisfaction_rated_count,
            })}
          </p>
        )}
      </Section>
    </div>
  );
}

import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Target } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import { useBookingGoalGate } from "./useBookingGoalGate";

/** Where a learner sets goals: the coachee journey, or a coach-as-learner's own journey. */
export function goalsHrefForRole(role: string | null | undefined): string {
  return role === "coach" ? "/coach/my-journey#goals" : "/coachee/journey#goals";
}

/**
 * The booking goal gate notice. Renders nothing unless the server says the
 * enrollment is blocked (no active goal -- from day 1, no grace period). Past
 * the goal setup deadline (cohort start + 7 days) it also flags "Goal setup
 * overdue" -- an alert only; the booking rule is the same either way.
 * Callers keep sessions/providers visible and disable only the booking action,
 * reading `blocked` from useBookingGoalGate (the same cached query).
 */
export function BookingGoalGate({
  enrollmentId,
  goalsHref,
  className,
}: {
  enrollmentId: string | null | undefined;
  /** Overrides the role-based link to the goals section. */
  goalsHref?: string;
  className?: string;
}) {
  const { t } = useTranslation("common");
  const { role } = useAuth();
  const { blocked, gate } = useBookingGoalGate(enrollmentId);
  if (!blocked) return null;

  return (
    <div
      role="alert"
      data-testid="booking-goal-gate"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm",
        className,
      )}
    >
      <Target className="h-4 w-4 shrink-0 text-warning" aria-hidden />
      <p className="min-w-0 flex-1">
        {gate?.goalSetupOverdue && (
          <strong data-testid="goal-setup-overdue" className="mr-2 text-warning">{t("bookingGoalGate.setupOverdue")}</strong>
        )}
        {t("bookingGoalGate.message")}
      </p>
      <Link to={goalsHref ?? goalsHrefForRole(role)} className="shrink-0 font-semibold text-primary underline-offset-2 hover:underline">
        {t("bookingGoalGate.cta")}
      </Link>
    </div>
  );
}

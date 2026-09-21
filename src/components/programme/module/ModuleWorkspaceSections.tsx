import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BookingGoalGate } from "@/components/goals/BookingGoalGate";
import { useBookingGoalGate } from "@/components/goals/useBookingGoalGate";
import type { useModuleWorkspace } from "@/hooks/journey/useModuleWorkspace";
import { useModuleGoalsActions } from "@/hooks/journey/useModuleGoalsActions";
import { nextOpenSession } from "@/lib/moduleSessions";
import { ModuleEvidenceCard, ModuleGoalsActionsCard, ModuleRequirementCard, ModuleUpcomingCard } from "./ModulePage";

type Workspace = ReturnType<typeof useModuleWorkspace>;

/**
 * The shared middle of every module page (Coaching, Peer, Mentoring, Triads),
 * in one order: progress & next requirement (with the booking goal gate and
 * the page's own booking action), the upcoming session, post-session evidence
 * with outstanding items highlighted, and the goals / actions connected to the
 * module's sessions (listed, not only counted). Every value comes from
 * useModuleWorkspace / useModuleGoalsActions (canonical reads). Each page
 * adds its module-specific cards around it and its full session history.
 */
export function ModuleWorkspaceSections({
  ws,
  module,
  booking,
  goalsHref = "/coachee/journey#goals",
}: {
  ws: Workspace;
  module: "coaching" | "peer" | "mentoring" | "triads";
  /** The page's booking action. Hidden while the booking goal gate blocks. */
  booking?: ReactNode;
  goalsHref?: string;
}) {
  const { t } = useTranslation("dashboard");
  const { blocked } = useBookingGoalGate(ws.enrollmentId);
  const linked = useModuleGoalsActions(ws.enrollmentId, module);
  return (
    <div data-testid="module-workspace-sections" className="flex flex-col gap-4">
      <ModuleRequirementCard
        moduleLabel={t(`learnerModules.shared.moduleUnit.${module}`)}
        state={ws.requirementState}
        loading={ws.requirementsLoading}
        error={ws.requirementsError}
        gate={<BookingGoalGate enrollmentId={ws.enrollmentId} />}
        booking={blocked ? null : booking}
      />
      <ModuleUpcomingCard session={nextOpenSession(ws.sessions)} loading={ws.sessionsLoading} />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(290px,1fr))]">
        <ModuleEvidenceCard
          pending={ws.pendingDeliverables}
          total={ws.deliverables.length}
          loading={ws.deliverablesLoading}
          error={ws.deliverablesError}
        />
        <ModuleGoalsActionsCard
          deliverables={ws.deliverables}
          goalsHref={goalsHref}
          goals={linked.goals}
          actions={linked.actions}
        />
      </div>
    </div>
  );
}

import type { LucideIcon } from "lucide-react";
import { CheckCircle2, XCircle, Clock, AlertCircle } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

export type SessionStatus = Database["public"]["Enums"]["session_status"];

export interface StatusMeta {
  label: string;
  className: string;
  icon: LucideIcon;
}

/**
 * "Soft background, no border" treatment — matches SessionDetail.tsx and
 * MentoringSessionDetail.tsx's existing status badge.
 */
export function getSessionStatusMeta(t: (key: string) => string): Record<SessionStatus, StatusMeta> {
  return {
    pending_coach_approval: { label: t("status.pending_coach_approval"), className: "bg-warning/12 text-warning", icon: AlertCircle },
    confirmed: { label: t("status.confirmed"), className: "bg-primary-soft text-primary", icon: CheckCircle2 },
    completed: { label: t("status.completed"), className: "bg-success/12 text-success", icon: CheckCircle2 },
    cancelled: { label: t("status.cancelled"), className: "bg-destructive/10 text-destructive", icon: XCircle },
    rescheduled: { label: t("status.rescheduled"), className: "bg-muted text-muted-foreground", icon: Clock },
  };
}

/**
 * "Bordered pill" treatment — matches Sessions.tsx's existing compact
 * list-row status badge (a distinct visual style from the one above, not
 * an inconsistency to collapse away).
 */
export function getSessionStatusPillMeta(t: (key: string) => string): Record<SessionStatus, StatusMeta> {
  return {
    pending_coach_approval: { label: t("status.pending_coach_approval"), className: "bg-warning/10 text-warning border-warning/20", icon: AlertCircle },
    confirmed: { label: t("status.confirmed"), className: "bg-primary/10 text-primary border-primary/20", icon: CheckCircle2 },
    completed: { label: t("status.completed"), className: "bg-success/10 text-success border-success/20", icon: CheckCircle2 },
    cancelled: { label: t("status.cancelled"), className: "bg-destructive/10 text-destructive border-destructive/20", icon: XCircle },
    rescheduled: { label: t("status.rescheduled"), className: "bg-secondary text-secondary-foreground border-border", icon: Clock },
  };
}

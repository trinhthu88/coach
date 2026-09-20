import { Target, ListChecks, Users, MessagesSquare, UserCog, Users2, BookOpen, MessageSquareText, Star, type LucideIcon } from "lucide-react";
import type { DevelopmentJourneyEventType } from "@/hooks/journey/developmentJourneyTypes";

/** Icon + tone per Development Journey event type — shared by every
 * presentation of the canonical useEnrollmentDevelopmentJourney timeline
 * (the coach's day-grouped DevelopmentJourneyTimeline and the coachee's
 * single connected-line DevelopmentJourneyList) so they never disagree. */
export const ICON_BY_TYPE: Record<DevelopmentJourneyEventType, LucideIcon> = {
  goal: Target,
  action: ListChecks,
  coaching: Users,
  peer_coaching: MessagesSquare,
  mentoring: UserCog,
  triad: Users2,
  training: BookOpen,
  reflection: MessageSquareText,
  feedback: Star,
};

export const TONE_BY_TYPE: Record<DevelopmentJourneyEventType, string> = {
  goal: "bg-primary-soft text-primary",
  action: "bg-success/15 text-success",
  coaching: "bg-accent/15 text-accent",
  peer_coaching: "bg-warning/15 text-warning",
  mentoring: "bg-accent/15 text-accent",
  triad: "bg-warning/15 text-warning",
  training: "bg-primary-soft text-primary",
  reflection: "bg-muted text-muted-foreground",
  feedback: "bg-success/15 text-success",
};

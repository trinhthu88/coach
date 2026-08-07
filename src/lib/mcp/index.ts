import { auth, defineMcp } from "@lovable.dev/mcp-js";
import approveAccessRequest from "./tools/approve-access-request";
import getCoachProfile from "./tools/get-coach-profile";
import getCoacheeProfile from "./tools/get-coachee-profile";
import getCoacheeProgress from "./tools/get-coachee-progress";
import getSessionDetails from "./tools/get-session-details";
import listCoaches from "./tools/list-coaches";
import listCoacheeGoals from "./tools/list-coachee-goals";
import listCoachees from "./tools/list-coachees";
import listPendingAccessRequests from "./tools/list-pending-access-requests";
import listProgrammes from "./tools/list-programmes";
import listSessions from "./tools/list-sessions";
import rejectAccessRequest from "./tools/reject-access-request";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "clariva-club",
  title: "Clariva Club",
  version: "0.1.0",
  instructions: "Tools for Clariva Club executive coaching platform. Admins can approve access requests and view all people and sessions. Coaches can view their assigned coachees, sessions, and coach directory. Coachees can view their own profile, goals, progress, and sessions.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    listPendingAccessRequests,
    approveAccessRequest,
    rejectAccessRequest,
    listCoachees,
    getCoacheeProfile,
    listCoaches,
    getCoachProfile,
    listProgrammes,
    listSessions,
    getSessionDetails,
    listCoacheeGoals,
    getCoacheeProgress,
  ],
});

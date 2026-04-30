import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/context/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import AppLayout from "@/components/AppLayout";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Coaches from "./pages/Coaches";
import CoachDetail from "./pages/CoachDetail";

import CoachProfileEditor from "./pages/CoachProfileEditor";
import CoachAvailability from "./pages/CoachAvailability";
import CoacheeProfileEditor from "./pages/CoacheeProfileEditor";
import Sessions from "./pages/Sessions";
import SessionDetail from "./pages/SessionDetail";
import BookSession from "./pages/BookSession";
import Messages from "./pages/Messages";
import AdminRegistrations from "./pages/AdminRegistrations";
import AdminCoaches from "./pages/AdminCoaches";
import AdminSessions from "./pages/AdminSessions";
import CoachClients from "./pages/CoachClients";
import CoacheeJourney from "./pages/CoacheeJourney";
import CoachFindCoach from "./pages/CoachFindCoach";
import CoachPeerCoaching from "./pages/CoachPeerCoaching";
import CoachPracticeJourney from "./pages/CoachPracticeJourney";
import CoachMyJourney from "./pages/CoachMyJourney";
import AdminSessionLimits from "./pages/AdminSessionLimits";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminCoachees from "./pages/admin/AdminCoachees";
import AdminTrainees from "./pages/admin/AdminTrainees";
import AdminAlerts from "./pages/admin/AdminAlerts";
import AdminActivity from "./pages/admin/AdminActivity";
import AdminProgrammes from "./pages/admin/AdminProgrammes";
import AdminCohorts from "./pages/admin/AdminCohorts";
import AdminAssignments from "./pages/admin/AdminAssignments";
import AdminCoachAccess from "./pages/admin/AdminCoachAccess";
import AdminAnalytics from "./pages/admin/AdminAnalytics";

import PendingApproval from "./pages/PendingApproval";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />

            <Route
              path="/pending"
              element={
                <ProtectedRoute>
                  <PendingApproval />
                </ProtectedRoute>
              }
            />

            <Route
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/coaches" element={<Coaches />} />
              <Route path="/coaches/:coachId" element={<CoachDetail />} />
              <Route
                path="/coaches/:coachId/book"
                element={
                  <ProtectedRoute>
                    <BookSession />
                  </ProtectedRoute>
                }
              />
              <Route path="/sessions" element={<Sessions />} />
              <Route path="/sessions/:sessionId" element={<SessionDetail />} />
              <Route path="/messages" element={<Messages />} />
              
              <Route
                path="/coachee/profile"
                element={
                  <ProtectedRoute role="coachee">
                    <CoacheeProfileEditor />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/coach/profile"
                element={
                  <ProtectedRoute role="coach">
                    <CoachProfileEditor />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/coach/availability"
                element={
                  <ProtectedRoute role="coach">
                    <CoachAvailability />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/coach/clients"
                element={
                  <ProtectedRoute role="coach">
                    <CoachClients />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/coach/find-coach"
                element={
                  <ProtectedRoute role="coach">
                    <CoachFindCoach />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/coach/peer-coaching"
                element={
                  <ProtectedRoute role="coach">
                    <CoachPeerCoaching />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/coach/practice-journey"
                element={
                  <ProtectedRoute role="coach">
                    <CoachPracticeJourney />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/coach/my-journey"
                element={
                  <ProtectedRoute role="coach">
                    <CoachMyJourney />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/session-limits"
                element={
                  <ProtectedRoute role="admin">
                    <AdminSessionLimits />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/coachee/journey"
                element={
                  <ProtectedRoute role="coachee">
                    <CoacheeJourney />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/coaches"
                element={
                  <ProtectedRoute role="admin">
                    <AdminCoaches />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/registrations"
                element={
                  <ProtectedRoute role="admin">
                    <AdminRegistrations />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/sessions"
                element={
                  <ProtectedRoute role="admin">
                    <AdminSessions />
                  </ProtectedRoute>
                }
              />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

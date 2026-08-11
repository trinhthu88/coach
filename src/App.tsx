import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/context/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import AppLayout from "@/components/AppLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Page-level lazy imports — each becomes a separate chunk
const Index = lazy(() => import("./pages/Index"));
const Auth = lazy(() => import("./pages/Auth"));
const RequestAccess = lazy(() => import("./pages/RequestAccess"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const SetNewPassword = lazy(() => import("./pages/SetNewPassword"));
const PendingApproval = lazy(() => import("./pages/PendingApproval"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Coaches = lazy(() => import("./pages/Coaches"));
const CoachDetail = lazy(() => import("./pages/CoachDetail"));
const CoachProfileEditor = lazy(() => import("./pages/CoachProfileEditor"));
const CoachAvailability = lazy(() => import("./pages/CoachAvailability"));
const CoacheeProfileEditor = lazy(() => import("./pages/CoacheeProfileEditor"));
const Sessions = lazy(() => import("./pages/Sessions"));
const SessionDetail = lazy(() => import("./pages/SessionDetail"));
const BookSession = lazy(() => import("./pages/BookSession"));
const Messages = lazy(() => import("./pages/Messages"));
const AdminRegistrations = lazy(() => import("./pages/AdminRegistrations"));
const AdminSessions = lazy(() => import("./pages/AdminSessions"));
const CoachClients = lazy(() => import("./pages/CoachClients"));
const CoacheeJourney = lazy(() => import("./pages/CoacheeJourney"));
const CoachFindCoach = lazy(() => import("./pages/CoachFindCoach"));
const CoachPeerCoaching = lazy(() => import("./pages/CoachPeerCoaching"));
const CoachPracticeJourney = lazy(() => import("./pages/CoachPracticeJourney"));
const CoachMyJourney = lazy(() => import("./pages/CoachMyJourney"));
const AdminCoaches = lazy(() => import("./pages/admin/AdminCoaches"));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const AdminCoachees = lazy(() => import("./pages/admin/AdminCoachees"));
const AdminAlerts = lazy(() => import("./pages/admin/AdminAlerts"));
const AdminActivity = lazy(() => import("./pages/admin/AdminActivity"));
const AdminProgrammes = lazy(() => import("./pages/admin/AdminProgrammes"));
const AdminCohorts = lazy(() => import("./pages/admin/AdminCohorts"));
const AdminAnalytics = lazy(() => import("./pages/admin/AdminAnalytics"));
const AdminOrganizations = lazy(() => import("./pages/admin/AdminOrganizations"));
const SponsorDashboard = lazy(() => import("./pages/sponsor/SponsorDashboard"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <Suspense fallback={null}>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/auth" element={<Auth />} />
                <Route path="/request-access" element={<RequestAccess />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route
                  path="/set-new-password"
                  element={
                    <ProtectedRoute>
                      <SetNewPassword />
                    </ProtectedRoute>
                  }
                />

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
                  <Route path="/admin" element={<ProtectedRoute role="admin"><AdminDashboard /></ProtectedRoute>} />
                  <Route path="/admin/coachees" element={<ProtectedRoute role="admin"><AdminCoachees /></ProtectedRoute>} />
                  <Route path="/admin/alerts" element={<ProtectedRoute role="admin"><AdminAlerts /></ProtectedRoute>} />
                  <Route path="/admin/activity" element={<ProtectedRoute role="admin"><AdminActivity /></ProtectedRoute>} />
                  <Route path="/admin/programmes" element={<ProtectedRoute role="admin"><AdminProgrammes /></ProtectedRoute>} />
                  <Route path="/admin/cohorts" element={<ProtectedRoute role="admin"><AdminCohorts /></ProtectedRoute>} />
                  <Route path="/admin/analytics" element={<ProtectedRoute role="admin"><AdminAnalytics /></ProtectedRoute>} />
                  <Route path="/admin/organizations" element={<ProtectedRoute role="admin"><AdminOrganizations /></ProtectedRoute>} />
                  <Route path="/sponsor" element={<ProtectedRoute role="sponsor"><SponsorDashboard /></ProtectedRoute>} />
                </Route>

                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;

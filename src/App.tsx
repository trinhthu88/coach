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
import ComingSoon from "./pages/ComingSoon";
import CoachProfileEditor from "./pages/CoachProfileEditor";
import CoachAvailability from "./pages/CoachAvailability";
import CoacheeProfileEditor from "./pages/CoacheeProfileEditor";
import Sessions from "./pages/Sessions";
import SessionDetail from "./pages/SessionDetail";
import AdminRegistrations from "./pages/AdminRegistrations";
import AdminCoaches from "./pages/AdminCoaches";
import AdminSessions from "./pages/AdminSessions";
import AdminLimits from "./pages/AdminLimits";
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
              <Route path="/sessions" element={<Sessions />} />
              <Route path="/sessions/:sessionId" element={<SessionDetail />} />
              <Route path="/messages" element={<ComingSoon title="Messages" description="Real-time chat with your coach or coachees is coming soon." />} />
              <Route path="/settings" element={<ComingSoon title="Settings" />} />
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
              <Route
                path="/admin/limits"
                element={
                  <ProtectedRoute role="admin">
                    <AdminLimits />
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

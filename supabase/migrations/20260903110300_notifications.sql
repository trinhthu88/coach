-- Phase 1 (notifications infrastructure): shared table for daily prompts,
-- reminders, and assignment alerts. Always written server-side (Edge
-- Functions / triggers) — the "user manage own" policy exists so a user can
-- mark their own rows read/delete them, not so the client inserts them.

CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  -- Types: 'daily_prompt', 'assignment_due', 'assignment_overdue',
  --        'triad_reminder', 'triad_booked', 'assessment_invite',
  --        'new_training_week', 'programme_reminder'
  title TEXT NOT NULL,
  title_vi TEXT,
  body TEXT,
  body_vi TEXT,
  link TEXT,                         -- Deep link path, e.g. "/training/uuid-here"
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Notifications: user manage own" ON public.notifications
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Notifications: admin view all" ON public.notifications
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_notifications_user_unread
  ON public.notifications (user_id, is_read, created_at DESC);

ALTER TABLE public.notifications REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

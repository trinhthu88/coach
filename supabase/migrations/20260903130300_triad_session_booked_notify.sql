-- Phase 3 (triads), part 4: "all 3 members get a notification when a
-- session is booked" can't be done client-side — notifications' "user
-- manage own" RLS policy only lets a user insert a row for themselves
-- (user_id = auth.uid()), so the booking member could notify themselves but
-- not the other two. Every other write to `notifications` in this codebase
-- is server-side (an edge function using the service-role key); a
-- SECURITY DEFINER trigger is the equivalent for a plain client insert.

CREATE OR REPLACE FUNCTION public.notify_triad_session_booked()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, notification_type, title, title_vi, body, body_vi, link)
  SELECT
    member_id,
    'triad_booked',
    'New triad session scheduled',
    'Đã đặt lịch session triad mới',
    'A triad session was scheduled for ' || to_char(NEW.session_date, 'FMDay, FMMonth FMDD'),
    'Một session triad đã được đặt lịch vào ' || to_char(NEW.session_date, 'DD/MM/YYYY'),
    '/triads'
  FROM (VALUES (NEW.coach_role_id), (NEW.coachee_role_id), (NEW.observer_role_id)) AS members(member_id);

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_triad_session_booked
  AFTER INSERT ON public.triad_sessions
  FOR EACH ROW EXECUTE FUNCTION public.notify_triad_session_booked();

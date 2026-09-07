-- Fixes notify_triad_session_booked() (20260903130300_triad_session_booked_notify.sql)
-- for the triad redesign (20260906120000_triad_redesign.sql): triad_sessions
-- no longer has coach_role_id/coachee_role_id/observer_role_id/session_date
-- — those were dropped and replaced by triad_groups.member_1/2/3_id +
-- triad_sessions.proposed_start_time. The redesign migration missed
-- updating this trigger, so every triad_sessions INSERT has been failing
-- with "record NEW has no field coach_role_id" (SQLSTATE 42703) since —
-- caught while seeding TASC test data.
CREATE OR REPLACE FUNCTION public.notify_triad_session_booked()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _member_1 UUID;
  _member_2 UUID;
  _member_3 UUID;
BEGIN
  SELECT member_1_id, member_2_id, member_3_id
    INTO _member_1, _member_2, _member_3
    FROM public.triad_groups WHERE id = NEW.triad_group_id;

  INSERT INTO public.notifications (user_id, notification_type, title, title_vi, body, body_vi, link)
  SELECT
    member_id,
    'triad_booked',
    'New triad session scheduled',
    'Đã đặt lịch session triad mới',
    'A triad session was proposed for ' || to_char(NEW.proposed_start_time, 'FMDay, FMMonth FMDD'),
    'Một session triad đã được đề xuất vào ' || to_char(NEW.proposed_start_time, 'DD/MM/YYYY'),
    '/triads'
  -- member_3_id can be NULL for a dyad (redesign migration) — skip it
  -- rather than notifying a NULL user_id.
  FROM (VALUES (_member_1), (_member_2), (_member_3)) AS members(member_id)
  WHERE member_id IS NOT NULL;

  RETURN NEW;
END;
$$;

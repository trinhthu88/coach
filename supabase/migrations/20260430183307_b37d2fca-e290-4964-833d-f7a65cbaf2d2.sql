-- Function: delete the related coach_availability slot when a session books it
CREATE OR REPLACE FUNCTION public.delete_booked_availability_slot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.slot_id IS NOT NULL THEN
    DELETE FROM public.coach_availability WHERE id = NEW.slot_id;
  END IF;
  RETURN NEW;
END;
$$;

-- Triggers for both coaching and peer sessions
DROP TRIGGER IF EXISTS trg_sessions_remove_booked_slot ON public.sessions;
CREATE TRIGGER trg_sessions_remove_booked_slot
AFTER INSERT ON public.sessions
FOR EACH ROW
EXECUTE FUNCTION public.delete_booked_availability_slot();

DROP TRIGGER IF EXISTS trg_peer_sessions_remove_booked_slot ON public.peer_sessions;
CREATE TRIGGER trg_peer_sessions_remove_booked_slot
AFTER INSERT ON public.peer_sessions
FOR EACH ROW
EXECUTE FUNCTION public.delete_booked_availability_slot();

-- Cleanup: remove already-booked slots that are still in the calendar
DELETE FROM public.coach_availability ca
WHERE ca.is_booked = true
  AND (
    EXISTS (SELECT 1 FROM public.sessions s WHERE s.slot_id = ca.id)
    OR EXISTS (SELECT 1 FROM public.peer_sessions ps WHERE ps.slot_id = ca.id)
  );

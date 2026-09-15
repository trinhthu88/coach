-- P0 session hardening: participants may edit only their own notes (and the
-- meeting link), while lifecycle changes are made by one server-authoritative
-- transition function.

CREATE OR REPLACE FUNCTION public.guard_session_protected_fields()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE u uuid := auth.uid();
BEGIN
  IF u IS NULL OR public.has_role(u, 'admin'::public.app_role) THEN RETURN NEW; END IF;
  IF current_setting('app.session_transition', true) = 'on' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'sessions' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id
       OR NEW.coach_id IS DISTINCT FROM OLD.coach_id OR NEW.coachee_id IS DISTINCT FROM OLD.coachee_id
       OR NEW.topic IS DISTINCT FROM OLD.topic OR NEW.start_time IS DISTINCT FROM OLD.start_time
       OR NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
       OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
       OR NEW.action_items IS DISTINCT FROM OLD.action_items
       OR (u <> OLD.coach_id AND NEW.meeting_url IS DISTINCT FROM OLD.meeting_url)
       OR (u <> OLD.coach_id AND NEW.coach_notes IS DISTINCT FROM OLD.coach_notes)
       OR (u <> OLD.coachee_id AND NEW.coachee_notes IS DISTINCT FROM OLD.coachee_notes) THEN
      RAISE EXCEPTION 'Session protected fields may only be changed by the lifecycle service' USING ERRCODE='42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'peer_sessions' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id
       OR NEW.peer_coach_id IS DISTINCT FROM OLD.peer_coach_id OR NEW.peer_coachee_id IS DISTINCT FROM OLD.peer_coachee_id
       OR NEW.topic IS DISTINCT FROM OLD.topic OR NEW.start_time IS DISTINCT FROM OLD.start_time
       OR NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
       OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
       OR NEW.action_items IS DISTINCT FROM OLD.action_items
       OR (u <> OLD.peer_coach_id AND NEW.meeting_url IS DISTINCT FROM OLD.meeting_url)
       OR (u <> OLD.peer_coach_id AND NEW.coach_notes IS DISTINCT FROM OLD.coach_notes)
       OR (u <> OLD.peer_coachee_id AND NEW.coachee_notes IS DISTINCT FROM OLD.coachee_notes) THEN
      RAISE EXCEPTION 'Peer session protected fields may only be changed by the lifecycle service' USING ERRCODE='42501';
    END IF;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id
       OR NEW.peer_provider_id IS DISTINCT FROM OLD.peer_provider_id OR NEW.peer_receiver_id IS DISTINCT FROM OLD.peer_receiver_id
       OR NEW.topic IS DISTINCT FROM OLD.topic OR NEW.start_time IS DISTINCT FROM OLD.start_time
       OR NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
       OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
       OR NEW.action_items IS DISTINCT FROM OLD.action_items
       OR (u <> OLD.peer_provider_id AND NEW.meeting_url IS DISTINCT FROM OLD.meeting_url)
       OR (u <> OLD.peer_provider_id AND NEW.provider_notes IS DISTINCT FROM OLD.provider_notes)
       OR (u <> OLD.peer_receiver_id AND NEW.receiver_notes IS DISTINCT FROM OLD.receiver_notes) THEN
      RAISE EXCEPTION 'Coachee peer session protected fields may only be changed by the lifecycle service' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sessions_protected_fields ON public.sessions;
CREATE TRIGGER sessions_protected_fields BEFORE UPDATE ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.guard_session_protected_fields();
DROP TRIGGER IF EXISTS peer_sessions_protected_fields ON public.peer_sessions;
CREATE TRIGGER peer_sessions_protected_fields BEFORE UPDATE ON public.peer_sessions
  FOR EACH ROW EXECUTE FUNCTION public.guard_session_protected_fields();
DROP TRIGGER IF EXISTS coachee_peer_sessions_protected_fields ON public.coachee_peer_sessions;
CREATE TRIGGER coachee_peer_sessions_protected_fields BEFORE UPDATE ON public.coachee_peer_sessions
  FOR EACH ROW EXECUTE FUNCTION public.guard_session_protected_fields();

CREATE OR REPLACE FUNCTION public.update_session_notes(
  p_session_id uuid, p_kind text, p_field text, p_value text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE u uuid := auth.uid(); t text; sql text;
BEGIN
  IF u IS NULL OR p_field NOT IN ('coach_notes','coachee_notes','provider_notes','receiver_notes','meeting_url')
    OR p_kind NOT IN ('coaching','peer','coachee_peer') THEN
    RAISE EXCEPTION 'Invalid scoped session update' USING ERRCODE='42501';
  END IF;
  t := CASE p_kind WHEN 'coaching' THEN 'sessions' WHEN 'peer' THEN 'peer_sessions' ELSE 'coachee_peer_sessions' END;
  sql := CASE p_kind
    WHEN 'coaching' THEN format('UPDATE public.sessions SET %I=$1 WHERE id=$2 AND (coach_id=$3 OR coachee_id=$3)', p_field)
    WHEN 'peer' THEN format('UPDATE public.peer_sessions SET %I=$1 WHERE id=$2 AND (peer_coach_id=$3 OR peer_coachee_id=$3)', p_field)
    ELSE format('UPDATE public.coachee_peer_sessions SET %I=$1 WHERE id=$2 AND (peer_provider_id=$3 OR peer_receiver_id=$3)', p_field)
  END;
  EXECUTE sql USING p_value, p_session_id, u;
  IF NOT FOUND THEN RAISE EXCEPTION 'Session not found or access denied' USING ERRCODE='42501'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_session_status(
  p_session_id uuid, p_kind text, p_action text, p_reason text DEFAULT NULL
) RETURNS public.session_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r record; u uuid := auth.uid(); next_status public.session_status;
BEGIN
  IF u IS NULL OR p_kind NOT IN ('coaching','peer','coachee_peer')
     OR p_action NOT IN ('confirm','cancel','complete') THEN RAISE EXCEPTION 'Invalid session transition' USING ERRCODE='42501'; END IF;
  EXECUTE format('SELECT * FROM public.%I WHERE id=$1', CASE p_kind WHEN 'coaching' THEN 'sessions' WHEN 'peer' THEN 'peer_sessions' ELSE 'coachee_peer_sessions' END)
    INTO r USING p_session_id;
  IF r IS NULL OR public.has_role(u,'admin'::public.app_role) THEN
    IF r IS NULL THEN RAISE EXCEPTION 'Session not found or access denied' USING ERRCODE='42501'; END IF;
  ELSIF (p_kind='coaching' AND u <> r.coach_id AND u <> r.coachee_id)
     OR (p_kind='peer' AND u <> r.peer_coach_id AND u <> r.peer_coachee_id)
     OR (p_kind='coachee_peer' AND u <> r.peer_provider_id AND u <> r.peer_receiver_id) THEN
    RAISE EXCEPTION 'Session not found or access denied' USING ERRCODE='42501';
  END IF;
  IF p_action='confirm' AND r.status='pending_coach_approval' THEN next_status := 'confirmed';
  ELSIF p_action='cancel' AND r.status IN ('pending_coach_approval','confirmed') AND r.start_time > now()+interval '24 hours' THEN next_status := 'cancelled';
  ELSIF p_action='complete' AND r.status='confirmed' AND r.start_time <= now()
    AND ((p_kind='coaching' AND length(trim(coalesce(r.coachee_notes,'')))>0)
      OR (p_kind='peer' AND EXISTS (SELECT 1 FROM public.peer_session_competency_feedback f WHERE f.peer_session_id=p_session_id))
      OR (p_kind='coachee_peer' AND length(trim(coalesce(r.receiver_notes,'')))>0)) THEN next_status := 'completed';
  ELSE RAISE EXCEPTION 'Session transition is not permitted' USING ERRCODE='42501'; END IF;
  PERFORM set_config('app.session_transition', 'on', true);
  EXECUTE format('UPDATE public.%I SET status=$1, confirmed_at=CASE WHEN $1=''confirmed'' THEN now() ELSE confirmed_at END, cancelled_at=CASE WHEN $1=''cancelled'' THEN now() ELSE cancelled_at END, cancelled_by=CASE WHEN $1=''cancelled'' THEN $2 ELSE cancelled_by END, cancel_reason=CASE WHEN $1=''cancelled'' THEN $3 ELSE cancel_reason END WHERE id=$4', CASE p_kind WHEN 'coaching' THEN 'sessions' WHEN 'peer' THEN 'peer_sessions' ELSE 'coachee_peer_sessions' END)
    USING next_status,u,p_reason,p_session_id;
  RETURN next_status;
END;
$$;

REVOKE ALL ON FUNCTION public.transition_session_status(uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_session_status(uuid,text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.update_session_notes(uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_session_notes(uuid,text,text,text) TO authenticated;
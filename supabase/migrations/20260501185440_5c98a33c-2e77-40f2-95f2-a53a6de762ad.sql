
-- ============================================================
-- 1) PROFILES: tighten SELECT — remove broad "view active" policy
-- ============================================================
DROP POLICY IF EXISTS "Profiles: view active" ON public.profiles;

-- Helper: does the viewer share a session with the target profile?
CREATE OR REPLACE FUNCTION public.shares_session_with(_viewer uuid, _target uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE (s.coach_id = _viewer AND s.coachee_id = _target)
       OR (s.coachee_id = _viewer AND s.coach_id = _target)
  ) OR EXISTS (
    SELECT 1 FROM public.peer_sessions ps
    WHERE (ps.peer_coach_id = _viewer AND ps.peer_coachee_id = _target)
       OR (ps.peer_coachee_id = _viewer AND ps.peer_coach_id = _target)
  );
$$;

-- Coaches can see profiles of coachees in their allowlist (so allowlist UI/booking works)
CREATE OR REPLACE FUNCTION public.is_allowlisted_pair(_viewer uuid, _target uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.coachee_coach_allowlist a
    WHERE (a.coachee_id = _viewer AND a.coach_id = _target)
       OR (a.coach_id   = _viewer AND a.coachee_id = _target)
  );
$$;

CREATE POLICY "Profiles: counterpart via session"
ON public.profiles
FOR SELECT
TO authenticated
USING (public.shares_session_with(auth.uid(), id));

CREATE POLICY "Profiles: counterpart via allowlist"
ON public.profiles
FOR SELECT
TO authenticated
USING (public.is_allowlisted_pair(auth.uid(), id));

-- ============================================================
-- 2) COACH PRIVATE NOTES: move to coach-only tables
-- ============================================================
CREATE TABLE IF NOT EXISTS public.coach_session_private_notes (
  session_id uuid PRIMARY KEY,
  coach_id   uuid NOT NULL,
  body       text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.peer_coach_session_private_notes (
  peer_session_id uuid PRIMARY KEY,
  peer_coach_id   uuid NOT NULL,
  body            text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Backfill from existing columns
INSERT INTO public.coach_session_private_notes (session_id, coach_id, body)
SELECT s.id, s.coach_id, s.coach_private_notes
FROM public.sessions s
WHERE s.coach_private_notes IS NOT NULL AND length(trim(s.coach_private_notes)) > 0
ON CONFLICT (session_id) DO NOTHING;

INSERT INTO public.peer_coach_session_private_notes (peer_session_id, peer_coach_id, body)
SELECT ps.id, ps.peer_coach_id, ps.coach_private_notes
FROM public.peer_sessions ps
WHERE ps.coach_private_notes IS NOT NULL AND length(trim(ps.coach_private_notes)) > 0
ON CONFLICT (peer_session_id) DO NOTHING;

-- Drop the leaky columns
ALTER TABLE public.sessions DROP COLUMN IF EXISTS coach_private_notes;
ALTER TABLE public.peer_sessions DROP COLUMN IF EXISTS coach_private_notes;

-- RLS for new tables
ALTER TABLE public.coach_session_private_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.peer_coach_session_private_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "CSPN: admin manage"
ON public.coach_session_private_notes
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "CSPN: coach manage own"
ON public.coach_session_private_notes
FOR ALL TO authenticated
USING (coach_id = auth.uid())
WITH CHECK (coach_id = auth.uid());

CREATE POLICY "PCSPN: admin manage"
ON public.peer_coach_session_private_notes
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "PCSPN: peer-coach manage own"
ON public.peer_coach_session_private_notes
FOR ALL TO authenticated
USING (peer_coach_id = auth.uid())
WITH CHECK (peer_coach_id = auth.uid());

-- updated_at triggers
CREATE TRIGGER trg_cspn_updated
BEFORE UPDATE ON public.coach_session_private_notes
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_pcspn_updated
BEFORE UPDATE ON public.peer_coach_session_private_notes
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 3) REALTIME: deny broadcast/presence on realtime.messages by default
-- ============================================================
-- postgres_changes events still flow via table RLS; this only restricts
-- broadcast and presence, which we don't use.
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Realtime: deny broadcast/presence by default" ON realtime.messages;
CREATE POLICY "Realtime: deny broadcast/presence by default"
ON realtime.messages
FOR SELECT
TO authenticated
USING (false);

DROP POLICY IF EXISTS "Realtime: deny insert broadcast/presence by default" ON realtime.messages;
CREATE POLICY "Realtime: deny insert broadcast/presence by default"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (false);

-- ============================================================
-- 4) ADMIN EMAIL: remove hardcoded email from handle_new_user
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _requested_role public.app_role;
  _final_role public.app_role;
  _profile_status public.user_status;
BEGIN
  BEGIN
    _requested_role := COALESCE(NULLIF(NEW.raw_user_meta_data->>'role',''), 'coachee')::public.app_role;
  EXCEPTION WHEN OTHERS THEN
    _requested_role := 'coachee'::public.app_role;
  END;

  IF _requested_role = 'coach' THEN
    _final_role := 'coach'::public.app_role;
    _profile_status := 'pending_approval'::public.user_status;
  ELSE
    _final_role := 'coachee'::public.app_role;
    _profile_status := 'pending_approval'::public.user_status;
  END IF;

  INSERT INTO public.profiles (id, full_name, email, status)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    _profile_status
  );

  -- Only insert role if not already present (admin seeded ahead of signup keeps admin role)
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, _final_role)
  ON CONFLICT DO NOTHING;

  IF _final_role = 'coach' AND NOT public.has_role(NEW.id, 'admin'::public.app_role) THEN
    INSERT INTO public.coach_profiles (id, approval_status)
    VALUES (NEW.id, 'pending_approval'::public.user_status)
    ON CONFLICT (id) DO NOTHING;
  ELSIF _final_role = 'coachee' AND NOT public.has_role(NEW.id, 'admin'::public.app_role) THEN
    INSERT INTO public.coachee_profiles (id, approval_status)
    VALUES (NEW.id, 'pending_approval'::public.user_status)
    ON CONFLICT (id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

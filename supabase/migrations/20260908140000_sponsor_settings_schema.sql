-- Schema for the sponsor self-edit page (/sponsor/settings).
--
-- Corrections from the original spec, both because the target columns
-- don't match this schema:
--   - "Job title" / "Department" are NOT profiles columns — they already
--     exist on sponsor_profiles (see 20260811100100_sponsor_schema.sql),
--     which AdminOrganizations.tsx already reads. Phone joins them there
--     for the same reason: it's sponsor-role-specific, not a general
--     profiles field every role needs.
--   - notification_prefs goes on profiles as instructed (a
--     general "how do you want to be notified" field, not role-specific).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notification_prefs jsonb NOT NULL DEFAULT
    '{"weekly_digest": true, "at_risk_alerts": true, "session_milestones": true, "monthly_auto_report": false}'::jsonb;

ALTER TABLE public.sponsor_profiles
  ADD COLUMN IF NOT EXISTS phone text;

-- sponsor_profiles previously only had "view own" (SELECT) + admin-manage
-- for sponsors — title/department/phone were admin-set-only. This adds
-- self-service write, scoped to the caller's own row exactly like
-- "Profiles: update own".
CREATE POLICY "Sponsor profiles: own update" ON public.sponsor_profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Avatar uploads (profiles.avatar_url) had no storage bucket anywhere in
-- this project — CoachProfileEditor/CoacheeProfileEditor don't have one
-- either, so this is new for every role, not sponsor-specific. Public
-- bucket: avatars are displayed to other users (session participants,
-- rosters) the same way avatar_url already is elsewhere, so this mirrors
-- that existing exposure rather than introducing a new one. Path
-- convention: {user_id}/{filename}, same prefix pattern as
-- sponsor-reports/mentoring-prep-files.
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Avatars: public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');

CREATE POLICY "Avatars: owner write"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Avatars: owner update"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Avatars: owner delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

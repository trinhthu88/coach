-- Minimal isolated Deployment 2 rehearsal fixture.
--
-- This is not an application migration and must never be applied to a hosted
-- database. It models the retiring Triad catalog, its intrinsic defaults,
-- indexes and known trigger, the archive boundary, and the canonical
-- structures required by the post-retirement verifier.

\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END $$;

CREATE TYPE public.programme_module_type AS ENUM (
  'coaching', 'training', 'mentoring', 'peer_coaching', 'triads'
);

CREATE TABLE public.programme_enrollments (
  id uuid PRIMARY KEY,
  cohort_id uuid NOT NULL,
  programme_id uuid NOT NULL
);

CREATE TABLE public.cohort_requirement_dates (
  id uuid PRIMARY KEY,
  cohort_id uuid NOT NULL,
  programme_id uuid NOT NULL,
  module public.programme_module_type NOT NULL
);

CREATE TABLE public.triad_cutover_archive (
  object_name text NOT NULL,
  record_id uuid NOT NULL,
  payload jsonb NOT NULL,
  migration_id text NOT NULL,
  PRIMARY KEY (object_name, record_id)
);
ALTER TABLE public.triad_cutover_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.triad_cutover_archive FROM anon, authenticated;

CREATE TABLE public.triad_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id uuid NOT NULL,
  cohort_requirement_date_id uuid NOT NULL,
  programme_id uuid,
  name text DEFAULT 'Triad A',
  round_number integer DEFAULT 1,
  triad_round_id uuid,
  member_1_id uuid,
  member_2_id uuid,
  member_3_id uuid,
  enrollment_1_id uuid,
  enrollment_2_id uuid,
  enrollment_3_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.triad_groups ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.triad_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  triad_group_id uuid NOT NULL,
  coach_enrollment_id uuid,
  coachee_enrollment_id uuid,
  observer_enrollment_id uuid,
  member_1_response jsonb,
  member_2_response jsonb,
  member_3_response jsonb,
  proposed_start_time timestamptz,
  proposed_end_time timestamptz,
  scheduled_start_time timestamptz,
  start_time timestamptz,
  proposed_by uuid,
  status text NOT NULL DEFAULT 'confirmed'
);
ALTER TABLE public.triad_sessions ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.triad_alternative_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  triad_session_id uuid NOT NULL,
  proposed_by uuid,
  member_1_response jsonb,
  member_2_response jsonb,
  member_3_response jsonb
);
ALTER TABLE public.triad_alternative_proposals ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.triad_reflections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  triad_session_id uuid,
  enrollment_id uuid,
  participant_id uuid,
  learned_as_coach text,
  will_use_as_coach text,
  learned_as_coachee text,
  will_use_as_coachee text,
  learned_as_observer text,
  will_use_as_observer text
);
ALTER TABLE public.triad_reflections ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.triad_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id uuid,
  round_number integer DEFAULT 1,
  auto_assign_status text DEFAULT 'pending',
  is_visible boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.programme_triad_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id uuid,
  round_number integer DEFAULT 1
);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER trg_triad_rounds_updated
BEFORE UPDATE ON public.triad_rounds
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.triad_is_seed_identifier(uuid)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT false $$;

CREATE INDEX triad_groups_member_1_retirement_idx
  ON public.triad_groups(member_1_id);
CREATE INDEX triad_groups_retirement_name_idx
  ON public.triad_groups(name);
CREATE INDEX triad_rounds_retirement_programme_idx
  ON public.triad_rounds(programme_id);

CREATE TABLE public.triad_group_members (
  triad_group_id uuid NOT NULL,
  enrollment_id uuid NOT NULL
);
CREATE TABLE public.triad_session_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid,
  enrollment_id uuid
);
CREATE TABLE public.triad_alternative_proposal_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid,
  enrollment_id uuid
);
CREATE TABLE public.triad_reflection_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);
CREATE TABLE public.triad_reflection_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  triad_reflection_id uuid
);
CREATE TABLE public.session_activity_attributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_activity_type text,
  source_activity_id uuid,
  enrollment_id uuid
);

CREATE OR REPLACE FUNCTION public.canonical_module_progress(uuid, date)
RETURNS TABLE (
  module public.programme_module_type,
  required_units integer,
  completed_activity_units integer,
  completed_units integer,
  due_units integer,
  overdue_units integer,
  booked_units integer,
  pace_status text
) LANGUAGE sql STABLE AS $$
  SELECT NULL::public.programme_module_type, 0, 0, 0, 0, 0, 0, 'on_track'::text
  WHERE false
$$;

CREATE OR REPLACE FUNCTION public.canonical_triad_completion(uuid, date)
RETURNS TABLE (
  required_units integer,
  raw_completed_sessions integer,
  completed_by_as_of integer,
  completed_units integer,
  due_units integer,
  overdue_units integer,
  booked_units integer,
  pace_status text
) LANGUAGE sql STABLE AS $$
  SELECT 0, 0, 0, 0, 0, 0, 0, 'on_track'::text
  WHERE false
$$;

CREATE OR REPLACE FUNCTION public.canonical_triad_requirement_fulfilment(uuid)
RETURNS void LANGUAGE sql STABLE AS $$ SELECT NULL::void $$;

CREATE OR REPLACE FUNCTION public.canonical_enrollment_progress(uuid, date)
RETURNS void LANGUAGE sql STABLE AS $$ SELECT NULL::void $$;

CREATE OR REPLACE FUNCTION public.learner_canonical_progress(uuid, date)
RETURNS void LANGUAGE sql STABLE AS $$
  SELECT public.canonical_enrollment_progress($1, $2)
$$;
CREATE OR REPLACE FUNCTION public.admin_canonical_enrollment_progress(uuid, date)
RETURNS void LANGUAGE sql STABLE AS $$
  SELECT public.canonical_enrollment_progress($1, $2)
$$;
CREATE OR REPLACE FUNCTION public.sponsor_canonical_enrollment_progress(uuid, date)
RETURNS void LANGUAGE sql STABLE AS $$
  SELECT public.canonical_enrollment_progress($1, $2)
$$;
CREATE OR REPLACE FUNCTION public.sponsor_canonical_cohort_progress(uuid, date)
RETURNS void LANGUAGE sql STABLE AS $$
  SELECT public.canonical_enrollment_progress($1, $2)
$$;
CREATE OR REPLACE FUNCTION public.sponsor_canonical_organisation_progress(uuid, date)
RETURNS void LANGUAGE sql STABLE AS $$
  SELECT public.canonical_enrollment_progress($1, $2)
$$;

INSERT INTO public.cohort_requirement_dates (id, cohort_id, programme_id, module)
VALUES (
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'triads'
);
INSERT INTO public.programme_enrollments (id, cohort_id, programme_id)
VALUES
  ('40000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001',
   '30000000-0000-4000-8000-000000000001'),
  ('40000000-0000-4000-8000-000000000002',
   '20000000-0000-4000-8000-000000000001',
   '30000000-0000-4000-8000-000000000001');
INSERT INTO public.triad_groups (
  id, cohort_id, cohort_requirement_date_id, programme_id,
  member_1_id, member_2_id, enrollment_1_id, enrollment_2_id
) VALUES (
  '50000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000002',
  '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000002'
);
INSERT INTO public.triad_group_members (triad_group_id, enrollment_id)
VALUES
  ('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001'),
  ('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002');
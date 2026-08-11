-- programmes had no unique constraint on name, only PRIMARY KEY (id) with a
-- fresh gen_random_uuid() per row. The seed insert in
-- 20260430172516_9c6dc92e-63d1-4b6c-bae9-df6bdfe0821b.sql uses
-- ON CONFLICT DO NOTHING, but with no unique index on name that clause has
-- nothing to target — re-running the seed (or seed-demo-data's racy
-- check-then-insert) mints duplicate Foundations/Growth/Executive rows,
-- which then fan out into every view/join that reads programmes raw
-- (AdminProgrammes, AdminCoachees, AdminCoaches, AdminCohorts).
--
-- Same anti-pattern already fixed once for session_limits in
-- 20260811111500_fix_duplicate_global_session_limits.sql.

-- Note: the keeper/dupe logic below groups by lower(name) so pre-existing
-- case variants ("growth" vs "Growth") also collapse to one row, but the
-- guard constraint added at the end is a plain UNIQUE(name) — case-sensitive
-- — since that's what PostgREST/supabase-js upsert(onConflict: "name") can
-- target; an expression index on lower(name) isn't usable as an upsert
-- arbiter there.

-- 1. Determine the row to keep per name (oldest by created_at, tie-broken by id)
--    and repoint every foreign key at it before removing the duplicates.
WITH keepers AS (
  SELECT DISTINCT ON (lower(name)) id, lower(name) AS lname
  FROM public.programmes
  ORDER BY lower(name), created_at ASC, id ASC
),
dupes AS (
  SELECT p.id AS dup_id, k.id AS keep_id
  FROM public.programmes p
  JOIN keepers k ON k.lname = lower(p.name)
  WHERE p.id <> k.id
)
UPDATE public.cohorts c
SET programme_id = d.keep_id
FROM dupes d
WHERE c.programme_id = d.dup_id;

WITH keepers AS (
  SELECT DISTINCT ON (lower(name)) id, lower(name) AS lname
  FROM public.programmes
  ORDER BY lower(name), created_at ASC, id ASC
),
dupes AS (
  SELECT p.id AS dup_id, k.id AS keep_id
  FROM public.programmes p
  JOIN keepers k ON k.lname = lower(p.name)
  WHERE p.id <> k.id
)
UPDATE public.staged_enrollments s
SET programme_id = d.keep_id
FROM dupes d
WHERE s.programme_id = d.dup_id;

-- programme_enrollments has UNIQUE (coachee_id, programme_id): repointing a
-- duplicate's enrollment onto the keeper could collide with one that already
-- exists there. Drop the redundant enrollment in that case, otherwise
-- repoint it.
WITH keepers AS (
  SELECT DISTINCT ON (lower(name)) id, lower(name) AS lname
  FROM public.programmes
  ORDER BY lower(name), created_at ASC, id ASC
),
dupes AS (
  SELECT p.id AS dup_id, k.id AS keep_id
  FROM public.programmes p
  JOIN keepers k ON k.lname = lower(p.name)
  WHERE p.id <> k.id
)
DELETE FROM public.programme_enrollments pe
USING dupes d
WHERE pe.programme_id = d.dup_id
  AND EXISTS (
    SELECT 1 FROM public.programme_enrollments existing
    WHERE existing.coachee_id = pe.coachee_id
      AND existing.programme_id = d.keep_id
  );

WITH keepers AS (
  SELECT DISTINCT ON (lower(name)) id, lower(name) AS lname
  FROM public.programmes
  ORDER BY lower(name), created_at ASC, id ASC
),
dupes AS (
  SELECT p.id AS dup_id, k.id AS keep_id
  FROM public.programmes p
  JOIN keepers k ON k.lname = lower(p.name)
  WHERE p.id <> k.id
)
UPDATE public.programme_enrollments pe
SET programme_id = d.keep_id
FROM dupes d
WHERE pe.programme_id = d.dup_id;

-- 2. Remove the now-unreferenced duplicate programme rows.
DELETE FROM public.programmes p
WHERE p.id NOT IN (
  SELECT DISTINCT ON (lower(name)) id
  FROM public.programmes
  ORDER BY lower(name), created_at ASC, id ASC
);

-- 3. Guard against recurrence: a unique constraint on name gives
--    ON CONFLICT / supabase-js upsert(onConflict: "name") something to
--    actually target (an expression index on lower(name) is not usable as
--    an upsert arbiter via PostgREST).
ALTER TABLE public.programmes ADD CONSTRAINT ux_programmes_name UNIQUE (name);

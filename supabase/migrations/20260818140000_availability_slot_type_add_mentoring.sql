-- Standalone migration: Postgres won't let a freshly-added enum value be
-- used inside the same transaction it was added in, so this value addition
-- is kept in its own file, ahead of any migration that filters on
-- slot_type = 'mentoring' (mentoring_sessions, added next).
--
-- Confirmed before writing this: availability_slot_type currently has
-- ('coaching', 'peer') (20260430143232_*.sql, added for peer coaching).

ALTER TYPE public.availability_slot_type ADD VALUE IF NOT EXISTS 'mentoring';

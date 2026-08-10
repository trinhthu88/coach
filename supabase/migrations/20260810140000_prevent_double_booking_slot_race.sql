-- Prevent two concurrent bookings from claiming the same availability slot.
-- The frontend reads available slots (coach_availability where is_booked = false),
-- then inserts a session referencing that slot_id. Without a DB-level constraint,
-- two clients racing on the same slot can both succeed, since the row that removes
-- the slot from availability (trg_*_remove_booked_slot, see prior migration) only
-- runs AFTER INSERT and does not itself prevent a second concurrent insert.
-- A partial unique index on slot_id makes the second insert fail atomically instead.

CREATE UNIQUE INDEX IF NOT EXISTS sessions_slot_id_unique
  ON public.sessions (slot_id)
  WHERE slot_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS peer_sessions_slot_id_unique
  ON public.peer_sessions (slot_id)
  WHERE slot_id IS NOT NULL;

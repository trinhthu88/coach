-- Required post-Deployment-2 verification sequence (READ-ONLY).
--
-- Deployment 2 is deliberately outside supabase/migrations. Run this wrapper
-- with psql after the candidate commits; it runs both the structural/runtime
-- verifier and the archive reconstruction proof.

\set ON_ERROR_STOP on
\ir triad-deployment-2-verification.sql
\ir triad-deployment-2-archive-reconstruction.sql
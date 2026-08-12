-- access_requests_email_unique previously blocked an email forever after its
-- first submission, regardless of outcome. That meant a user approved, then
-- later deleted from Supabase Auth (profiles cascades on delete, but
-- access_requests has no FK to auth.users so the old row survives), could
-- never submit a new access request with the same email again.
--
-- Scope the uniqueness to pending requests only: still blocks a duplicate
-- pending application, but lets someone whose prior request was approved
-- (account since deleted) or rejected apply again.
DROP INDEX IF EXISTS public.access_requests_email_unique;

CREATE UNIQUE INDEX access_requests_email_unique
ON public.access_requests (lower(email))
WHERE status = 'pending';

CREATE TABLE public.admin_user_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  email TEXT NOT NULL,
  temporary_password TEXT NOT NULL,
  issued_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  issued_by UUID,
  must_reset BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT admin_user_credentials_user_id_key UNIQUE (user_id),
  CONSTRAINT admin_user_credentials_email_key UNIQUE (email)
);

ALTER TABLE public.admin_user_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin credentials: admin view"
ON public.admin_user_credentials
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin credentials: admin insert"
ON public.admin_user_credentials
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin credentials: admin update"
ON public.admin_user_credentials
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin credentials: admin delete"
ON public.admin_user_credentials
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER set_admin_user_credentials_updated_at
BEFORE UPDATE ON public.admin_user_credentials
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE UNIQUE INDEX access_requests_email_unique
ON public.access_requests (lower(email));
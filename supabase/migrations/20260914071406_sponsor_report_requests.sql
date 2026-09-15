-- P1 sponsor report requests. Reports are prepared manually; no report
-- artifact, private source row, or signed URL is stored here.
CREATE TABLE public.sponsor_report_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  cohort_id uuid NOT NULL REFERENCES public.cohorts(id) ON DELETE RESTRICT,
  requested_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'in_progress', 'ready', 'declined')),
  request_notes text,
  admin_notes text,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sponsor_report_requests_org_created
  ON public.sponsor_report_requests (organization_id, created_at DESC);
ALTER TABLE public.sponsor_report_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY sponsor_report_requests_sponsor_read ON public.sponsor_report_requests
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sponsor_profiles sp
    WHERE sp.user_id = auth.uid() AND sp.organization_id = organization_id
  ));
CREATE POLICY sponsor_report_requests_admin_read ON public.sponsor_report_requests
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.sponsor_submit_report_request(
  p_cohort_id uuid, p_request_notes text DEFAULT NULL
) RETURNS public.sponsor_report_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE result public.sponsor_report_requests;
BEGIN
  INSERT INTO public.sponsor_report_requests (organization_id, cohort_id, requested_by, request_notes)
  SELECT sp.organization_id, c.id, auth.uid(), NULLIF(left(p_request_notes, 2000), '')
  FROM public.sponsor_profiles sp
  JOIN public.cohorts c ON c.organization_id = sp.organization_id AND c.id = p_cohort_id
  WHERE sp.user_id = auth.uid()
  RETURNING * INTO result;
  IF result.id IS NULL THEN RAISE EXCEPTION 'Cohort is not available to this sponsor'; END IF;
  RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.sponsor_list_report_requests()
RETURNS SETOF public.sponsor_report_requests
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.* FROM public.sponsor_report_requests r
  JOIN public.sponsor_profiles sp ON sp.organization_id = r.organization_id
  WHERE sp.user_id = auth.uid()
  ORDER BY r.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_report_requests()
RETURNS TABLE (
  id uuid, organization_id uuid, cohort_id uuid, requested_by uuid,
  status text, request_notes text, admin_notes text, updated_by uuid,
  created_at timestamptz, updated_at timestamptz,
  organization_name text, cohort_name text, requester_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.id, r.organization_id, r.cohort_id, r.requested_by, r.status,
    r.request_notes, r.admin_notes, r.updated_by, r.created_at, r.updated_at,
    o.name, c.name, p.full_name
  FROM public.sponsor_report_requests r
  JOIN public.organizations o ON o.id = r.organization_id
  JOIN public.cohorts c ON c.id = r.cohort_id
  JOIN public.profiles p ON p.id = r.requested_by
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
  ORDER BY r.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_report_request(
  p_request_id uuid, p_status text, p_admin_notes text DEFAULT NULL
) RETURNS public.sponsor_report_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE result public.sponsor_report_requests;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role)
     OR p_status NOT IN ('submitted', 'in_progress', 'ready', 'declined')
  THEN RAISE EXCEPTION 'Not authorized or invalid status'; END IF;
  UPDATE public.sponsor_report_requests SET status = p_status,
    admin_notes = NULLIF(left(p_admin_notes, 4000), ''),
    updated_by = auth.uid(), updated_at = now()
  WHERE id = p_request_id RETURNING * INTO result;
  IF result.id IS NULL THEN RAISE EXCEPTION 'Report request not found'; END IF;
  RETURN result;
END; $$;

REVOKE ALL ON TABLE public.sponsor_report_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.sponsor_report_requests TO authenticated;
REVOKE ALL ON FUNCTION public.sponsor_submit_report_request(uuid,text),
  public.sponsor_list_report_requests(),
  public.admin_list_report_requests(),
  public.admin_update_report_request(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sponsor_submit_report_request(uuid,text),
  public.sponsor_list_report_requests() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_report_requests(),
  public.admin_update_report_request(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.notify_sponsor_report_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.notifications(user_id, notification_type, title, title_vi, body, body_vi, link)
    VALUES (NEW.requested_by, 'sponsor_report_request',
      CASE WHEN NEW.status = 'submitted' THEN 'Report request received' ELSE 'Report request updated' END,
      CASE WHEN NEW.status = 'submitted' THEN 'Đã nhận yêu cầu báo cáo' ELSE 'Yêu cầu báo cáo đã được cập nhật' END,
      'Your sponsor report request is now ' || replace(NEW.status, '_', ' ') || '.',
      'Yêu cầu báo cáo của bạn hiện ở trạng thái ' || replace(NEW.status, '_', ' ') || '.',
      '/sponsor/report');
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER sponsor_report_status_notification
  AFTER INSERT OR UPDATE OF status ON public.sponsor_report_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_sponsor_report_status();
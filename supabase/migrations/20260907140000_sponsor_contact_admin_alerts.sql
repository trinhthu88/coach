-- Lets a sponsor raise a "Contact the programme team" request from their
-- dashboard. admin_alerts previously had exactly one policy — admin-only,
-- FOR ALL — so a sponsor-side client insert would have failed every time
-- with a 42501 RLS violation. This adds a narrowly-scoped INSERT policy:
-- a sponsor may only insert rows they are the (implicit) author of, and
-- only with alert_type = 'sponsor_request' — they cannot resolve alerts,
-- read other alerts, or use this to write an arbitrary alert_type.
CREATE POLICY "Alerts: sponsor insert own request"
  ON public.admin_alerts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'sponsor'::app_role)
    AND alert_type = 'sponsor_request'
    AND resolved = false
  );

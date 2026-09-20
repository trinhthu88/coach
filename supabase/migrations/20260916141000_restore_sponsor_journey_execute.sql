-- The canonical Sponsor journey remains a sponsor-safe SECURITY DEFINER RPC.
-- Restore the authenticated execution grant after the canonical spine
-- migration revoked the legacy public grant set.
GRANT EXECUTE ON FUNCTION public.get_sponsor_programme_journey(uuid, date)
  TO authenticated;
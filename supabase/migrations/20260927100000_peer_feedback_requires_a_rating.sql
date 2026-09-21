-- P1-9b: peer competency feedback is never saved with values the rater did
-- not set. The client used to seed every ICF competency at 70 and persist it;
-- competencies now start unrated (NULL) and a save needs at least one
-- competency the rater actually set. NOT VALID: enforced for every new write
-- without rejecting historical rows.
ALTER TABLE public.peer_session_competency_feedback
  DROP CONSTRAINT IF EXISTS peer_session_competency_feedback_rated;
ALTER TABLE public.peer_session_competency_feedback
  ADD CONSTRAINT peer_session_competency_feedback_rated CHECK (
    num_nonnulls(ethical_practice, coaching_mindset, maintains_agreements, trust_safety,
                 maintains_presence, listens_actively, evokes_awareness, facilitates_growth) > 0
  ) NOT VALID;

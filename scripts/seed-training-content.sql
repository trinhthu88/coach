-- ===========================================================================
-- Clariva demo TRAINING content.
--
-- Adds the Training module on top of the canonical demo seed
-- (supabase/seed-demo.sql). It touches no existing row: it inserts training
-- weeks, a Training programme_modules row per programme, quizzes, practical
-- assignments, reflections, daily prompts, and learner progress.
--
-- THREE THINGS THE SCHEMA DICTATES, WHICH SHAPED THIS FILE
--
--   1. There is no skill_card_elements table. A skills card IS
--      training_weeks.skill_card_html.
--
--   2. assignment_type is exactly {quiz, reflection}. There is no
--      'assignment' type, so each week's practical exercise is a
--      reflection-type assignment carrying the exercise in `instructions`.
--
--   3. canonical_training_week_fulfilment() counts one required unit per
--      week, requiring the skill card, quiz, and reflection. Prompts are
--      optional evidence and never add to the parent Training denominator.
--      The weeks are therefore created FIRST and the Training module row is
--      written afterwards, pointing at their real ids.
--
-- Training progress is written straight into training_progress because that
-- IS the canonical path: no RPC writes that table, and src/hooks/training/
-- useSkillCard.ts inserts into it directly. validate_enrollment_activity and
-- attribute_new_activity_trigger fire on it exactly as they do in the app.
--
-- PACING. due_on for a week is cohort_start + (week-1)*7 days unless a
-- cohort_week_overrides row says otherwise, so on an in-flight cohort every
-- week would already be due and an "on track" learner would read as behind.
-- Overrides below put the later weeks of each ongoing cohort in the future,
-- which is the mechanism the product provides for exactly this.
--
-- USAGE
--   psql "$DEMO_DB_URL" -v ON_ERROR_STOP=1 \
--        -c "SET app.seed_environment='demo'" -f scripts/seed-training-content.sql
-- ===========================================================================

BEGIN;

DO $guard$
BEGIN
  IF coalesce(current_setting('app.seed_environment', true), '') NOT IN
     ('local', 'development', 'preview', 'test', 'demo') THEN
    RAISE EXCEPTION
      'Refusing to seed training content: set app.seed_environment (local|development|preview|test|demo)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.programmes WHERE name = 'Emerging Leaders') THEN
    RAISE EXCEPTION 'The canonical demo seed has not been applied: run supabase/seed-demo.sql first';
  END IF;
END
$guard$;

-- ========================================================================
-- Emerging Leaders - 8 training weeks
-- ========================================================================

-- Skills cards live on the week itself (finding 1).
INSERT INTO public.training_weeks
  (programme_id, week_number, title, subtitle, skill_card_html,
   is_visible, skill_card_visible, sort_order)
SELECT p.id, v.week_number, v.title, v.subtitle, v.skill_card_html, true, true, v.week_number
FROM public.programmes p
CROSS JOIN (VALUES
  (1, 'Self-Awareness & Emotional Intelligence', 'Noticing your own state before it drives your behaviour', '<h3>Self-Awareness & Emotional Intelligence</h3><p class="lead">Noticing your own state before it drives your behaviour</p><p>Emotional intelligence starts with interoception: naming what you feel while you feel it. Leaders who can label an emotion precisely ("I am frustrated because the deadline moved", not "this is a mess") recover their judgement faster. The practice is a pause, a label, and a choice — in that order.</p><h4>Practise this week</h4><p>For five working days, record one moment where your emotional state shaped a decision. Note the trigger, the label you gave the feeling, and what you chose to do. Bring the pattern you notice to your next coaching session.</p>'),
  (2, 'Communication & Active Listening', 'Listening to understand rather than to reply', '<h3>Communication & Active Listening</h3><p class="lead">Listening to understand rather than to reply</p><p>Most listening is a pause before speaking. Active listening replaces that with three moves: reflect the content, check the meaning, and hold the silence. The third is the hardest and the most productive — people say their most important sentence after the pause you did not fill.</p><h4>Practise this week</h4><p>In three conversations this week, practise reflect-check-pause. Afterwards, write down what the other person said AFTER your silence that they had not said before it.</p>'),
  (3, 'Coaching Mindset for Leaders', 'Asking before telling, and meaning it', '<h3>Coaching Mindset for Leaders</h3><p class="lead">Asking before telling, and meaning it</p><p>A coaching mindset assumes the other person is resourceful. It trades the satisfaction of having the answer for the longer return of building someone who finds their own. The tell is in your first sentence after they describe a problem: a question or an instruction.</p><h4>Practise this week</h4><p>For one week, respond to every problem brought to you with a question before any suggestion. Log the three hardest moments and what you wanted to say instead.</p>'),
  (4, 'Giving & Receiving Feedback', 'Specific, timely, and about behaviour', '<h3>Giving & Receiving Feedback</h3><p class="lead">Specific, timely, and about behaviour</p><p>Useful feedback names an observable behaviour, its effect, and a request. Praise follows the same structure. The receiving half matters more than most leaders admit: how you take feedback sets the ceiling for how honestly your team gives it.</p><h4>Practise this week</h4><p>Give one piece of specific behavioural feedback and explicitly request one in return. Write down what you noticed about your own reaction to receiving it.</p>'),
  (5, 'Building Trust in Teams', 'Trust as a product of consistency, not warmth', '<h3>Building Trust in Teams</h3><p class="lead">Trust as a product of consistency, not warmth</p><p>Trust is built where reliability, candour and care overlap. Teams tolerate a demanding leader; they do not tolerate an unpredictable one. The fastest way to build trust is to make and keep small visible commitments, and to say plainly when you cannot.</p><h4>Practise this week</h4><p>List every commitment you made to your team in the last two weeks and mark each kept, missed, or renegotiated. Share the pattern with your coach.</p>'),
  (6, 'Delegation & Empowerment', 'Delegating the outcome, not the steps', '<h3>Delegation & Empowerment</h3><p class="lead">Delegating the outcome, not the steps</p><p>Delegation fails when the leader transfers the task but keeps the judgement. Name the outcome, the constraints, and the decision rights explicitly — especially which decisions come back to you. Ambiguity about authority is the usual cause of both under- and over-reach.</p><h4>Practise this week</h4><p>Choose one task you currently hold. Write the outcome, the constraints, the decision rights and the escalation threshold, then hand it over using exactly that wording.</p>'),
  (7, 'Managing Conflict', 'Separating the position from the interest', '<h3>Managing Conflict</h3><p class="lead">Separating the position from the interest</p><p>Most workplace conflict is two positions competing for one solution. Underneath, the interests are often compatible. The leader''s job is to slow the conversation down enough to surface the interest — "what would that get you?" — before negotiating the solution.</p><h4>Practise this week</h4><p>Take a live disagreement. Write each party''s stated position, then the interest beneath it. Identify one option that serves both interests and test it.</p>'),
  (8, 'Leading Change', 'People adopt change at the speed they understand it', '<h3>Leading Change</h3><p class="lead">People adopt change at the speed they understand it</p><p>Change resistance is usually an information or agency problem, not an attitude problem. Explain the reason before the plan, name what will not change, and give people a genuine decision inside the change. The middle of a change is where leaders disappear and should not.</p><h4>Practise this week</h4><p>Identify a change you are leading. Write a one-page note covering why, what stays the same, and one decision your team genuinely owns. Deliver it and record the questions you got.</p>')
) AS v(week_number, title, subtitle, skill_card_html)
WHERE p.name = 'Emerging Leaders';

-- Finding 3: the module must name the weeks, so it is written after them.
INSERT INTO public.programme_modules (programme_id, module, enabled, config)
SELECT p.id, 'training'::public.programme_module_type, true,
  jsonb_build_object(
    'required', true, 'required_units', 8,
    -- Child learning types that count as evidence inside each week (never extra units).
    'learning_components', jsonb_build_array('skill_cards', 'quizzes', 'reflections', 'daily_prompts'),
    'distribution_settings', jsonb_build_object(
      'training_week_ids', (SELECT jsonb_agg(tw.id ORDER BY tw.week_number)
                            FROM public.training_weeks tw WHERE tw.programme_id = p.id)))
FROM public.programmes p WHERE p.name = 'Emerging Leaders'
ON CONFLICT (programme_id, module) DO UPDATE SET enabled = true, config = EXCLUDED.config;

-- One quiz and one practical exercise per week (finding 2: the exercise
-- is a reflection-type assignment; there is no 'assignment' type).
INSERT INTO public.assignments
  (training_week_id, assignment_type, title, instructions, is_visible, due_offset_days, sort_order)
SELECT tw.id, v.kind::public.assignment_type, v.title, v.instructions, true, 7, v.sort_order
FROM public.training_weeks tw
JOIN public.programmes p ON p.id = tw.programme_id
JOIN (VALUES
  (1, 'quiz', 'Week 1 quiz: Self-Awareness & Emotional Intelligence', 'Four questions on the key ideas from this week.', 1),
  (1, 'reflection', 'Emotion log', 'For five working days, record one moment where your emotional state shaped a decision. Note the trigger, the label you gave the feeling, and what you chose to do. Bring the pattern you notice to your next coaching session.', 2),
  (2, 'quiz', 'Week 2 quiz: Communication & Active Listening', 'Four questions on the key ideas from this week.', 1),
  (2, 'reflection', 'Listening audit', 'In three conversations this week, practise reflect-check-pause. Afterwards, write down what the other person said AFTER your silence that they had not said before it.', 2),
  (3, 'quiz', 'Week 3 quiz: Coaching Mindset for Leaders', 'Four questions on the key ideas from this week.', 1),
  (3, 'reflection', 'Ask-first week', 'For one week, respond to every problem brought to you with a question before any suggestion. Log the three hardest moments and what you wanted to say instead.', 2),
  (4, 'quiz', 'Week 4 quiz: Giving & Receiving Feedback', 'Four questions on the key ideas from this week.', 1),
  (4, 'reflection', 'Feedback exchange', 'Give one piece of specific behavioural feedback and explicitly request one in return. Write down what you noticed about your own reaction to receiving it.', 2),
  (5, 'quiz', 'Week 5 quiz: Building Trust in Teams', 'Four questions on the key ideas from this week.', 1),
  (5, 'reflection', 'Commitment ledger', 'List every commitment you made to your team in the last two weeks and mark each kept, missed, or renegotiated. Share the pattern with your coach.', 2),
  (6, 'quiz', 'Week 6 quiz: Delegation & Empowerment', 'Four questions on the key ideas from this week.', 1),
  (6, 'reflection', 'Delegation design', 'Choose one task you currently hold. Write the outcome, the constraints, the decision rights and the escalation threshold, then hand it over using exactly that wording.', 2),
  (7, 'quiz', 'Week 7 quiz: Managing Conflict', 'Four questions on the key ideas from this week.', 1),
  (7, 'reflection', 'Interest mapping', 'Take a live disagreement. Write each party''s stated position, then the interest beneath it. Identify one option that serves both interests and test it.', 2),
  (8, 'quiz', 'Week 8 quiz: Leading Change', 'Four questions on the key ideas from this week.', 1),
  (8, 'reflection', 'Change conversation', 'Identify a change you are leading. Write a one-page note covering why, what stays the same, and one decision your team genuinely owns. Deliver it and record the questions you got.', 2)
) AS v(week_number, kind, title, instructions, sort_order) ON v.week_number = tw.week_number
WHERE p.name = 'Emerging Leaders';

-- Quiz questions: four per week, one correct option, with explanations.
INSERT INTO public.quiz_questions
  (assignment_id, question_text, options, explanation, sort_order)
SELECT a.id, v.question_text, v.options::jsonb, v.explanation, v.sort_order
FROM public.assignments a
JOIN public.training_weeks tw ON tw.id = a.training_week_id
JOIN public.programmes p ON p.id = tw.programme_id
JOIN (VALUES
  (1, 'A leader feels irritation rising during a status meeting. What does the pause-label-choose sequence ask them to do first?', '[{"id": "a", "text": "Raise the concern immediately while it is fresh", "is_correct": false}, {"id": "b", "text": "Notice the physical signal and name the emotion internally", "is_correct": true}, {"id": "c", "text": "Leave the meeting to cool down", "is_correct": false}, {"id": "d", "text": "Redirect the conversation to another agenda item", "is_correct": false}]', 'Naming the state interrupts the automatic reaction and restores access to judgement.', 1),
  (1, 'Which statement shows the highest self-awareness?', '[{"id": "a", "text": "\"The team is being difficult today\"", "is_correct": false}, {"id": "b", "text": "\"I am impatient because I have not had time to prepare\"", "is_correct": true}, {"id": "c", "text": "\"Nobody listens in these meetings\"", "is_correct": false}, {"id": "d", "text": "\"This project was always going to fail\"", "is_correct": false}]', 'It locates the feeling in the speaker and attaches a specific cause.', 2),
  (1, 'Self-awareness most directly improves which leadership capability?', '[{"id": "a", "text": "Technical decision speed", "is_correct": false}, {"id": "b", "text": "Regulating your response under pressure", "is_correct": true}, {"id": "c", "text": "Delegating routine work", "is_correct": false}, {"id": "d", "text": "Forecasting accuracy", "is_correct": false}]', 'You cannot regulate a reaction you have not noticed.', 3),
  (1, 'What is the most useful frequency for a self-awareness practice?', '[{"id": "a", "text": "Once a quarter in a formal review", "is_correct": false}, {"id": "b", "text": "Brief and daily", "is_correct": true}, {"id": "c", "text": "Only when conflict arises", "is_correct": false}, {"id": "d", "text": "During annual appraisal", "is_correct": false}]', 'Short daily repetition builds the noticing habit; infrequent deep dives do not.', 4),
  (2, 'What distinguishes active listening from ordinary attentive listening?', '[{"id": "a", "text": "Taking detailed notes", "is_correct": false}, {"id": "b", "text": "Reflecting back and checking understanding before responding", "is_correct": true}, {"id": "c", "text": "Maintaining eye contact throughout", "is_correct": false}, {"id": "d", "text": "Summarising at the end of the meeting", "is_correct": false}]', 'The check for meaning is what makes it active rather than merely polite.', 1),
  (2, 'A team member finishes a difficult sentence and stops. What is usually the most useful next move?', '[{"id": "a", "text": "Offer a solution", "is_correct": false}, {"id": "b", "text": "Move to the next agenda item", "is_correct": false}, {"id": "c", "text": "Leave a deliberate silence", "is_correct": true}, {"id": "d", "text": "Reassure them it will be fine", "is_correct": false}]', 'Silence invites the sentence underneath the first one.', 2),
  (2, 'Which response most reliably signals that you understood?', '[{"id": "a", "text": "\"I completely agree\"", "is_correct": false}, {"id": "b", "text": "\"What I am hearing is that the deadline matters less than the rework \u2014 have I got that right?\"", "is_correct": true}, {"id": "c", "text": "\"Let me tell you what I would do\"", "is_correct": false}, {"id": "d", "text": "\"That happened to me once too\"", "is_correct": false}]', 'It paraphrases and explicitly invites correction.', 3),
  (2, 'Why does restating someone''s point before disagreeing improve the outcome?', '[{"id": "a", "text": "It delays the disagreement", "is_correct": false}, {"id": "b", "text": "It proves you were paying attention and lowers defensiveness", "is_correct": true}, {"id": "c", "text": "It is required by most meeting protocols", "is_correct": false}, {"id": "d", "text": "It shortens the conversation", "is_correct": false}]', 'People argue less hard once they are satisfied they have been understood.', 4),
  (3, 'What is the core assumption of a coaching mindset?', '[{"id": "a", "text": "The leader usually knows best", "is_correct": false}, {"id": "b", "text": "The person is resourceful and capable of finding their own answer", "is_correct": true}, {"id": "c", "text": "Advice should be withheld on principle", "is_correct": false}, {"id": "d", "text": "Performance issues are always skill issues", "is_correct": false}]', 'Resourcefulness is the premise; without it coaching becomes disguised instruction.', 1),
  (3, 'When is directing more appropriate than coaching?', '[{"id": "a", "text": "When the person is inexperienced and the stakes are immediate", "is_correct": true}, {"id": "b", "text": "Whenever the leader is busy", "is_correct": false}, {"id": "c", "text": "When the person disagrees with you", "is_correct": false}, {"id": "d", "text": "In performance reviews", "is_correct": false}]', 'Coaching is a choice, not a rule; genuine urgency with a novice calls for direction.', 2),
  (3, 'Which opening most reflects a coaching stance?', '[{"id": "a", "text": "\"Here is what I would do\"", "is_correct": false}, {"id": "b", "text": "\"What have you already considered?\"", "is_correct": true}, {"id": "c", "text": "\"Have you tried the usual approach?\"", "is_correct": false}, {"id": "d", "text": "\"Let me escalate this for you\"", "is_correct": false}]', 'It opens the other person''s thinking rather than substituting yours.', 3),
  (3, 'A common failure mode of leader-as-coach is:', '[{"id": "a", "text": "Asking too many open questions", "is_correct": false}, {"id": "b", "text": "Asking questions that are advice in disguise", "is_correct": true}, {"id": "c", "text": "Allowing too much silence", "is_correct": false}, {"id": "d", "text": "Meeting too frequently", "is_correct": false}]', '"Have you thought about doing X?" is a recommendation wearing a question mark.', 4),
  (4, 'Which feedback is most actionable?', '[{"id": "a", "text": "\"You need to be more strategic\"", "is_correct": false}, {"id": "b", "text": "\"In Tuesday''s review you answered the client''s objection before they finished \u2014 it read as defensive. Could you let them finish?\"", "is_correct": true}, {"id": "c", "text": "\"Your communication could improve\"", "is_correct": false}, {"id": "d", "text": "\"Great work this quarter\"", "is_correct": false}]', 'It names the behaviour, the effect, and a specific request.', 1),
  (4, 'Why is timeliness a property of good feedback?', '[{"id": "a", "text": "It reduces the leader''s discomfort", "is_correct": false}, {"id": "b", "text": "Recall is accurate and the behaviour is still changeable", "is_correct": true}, {"id": "c", "text": "It fills the meeting agenda", "is_correct": false}, {"id": "d", "text": "It avoids the need for documentation", "is_correct": false}]', 'Delay degrades both the accuracy and the usefulness of the observation.', 2),
  (4, 'What most strongly predicts whether a team gives its leader honest feedback?', '[{"id": "a", "text": "The formal review cycle", "is_correct": false}, {"id": "b", "text": "How the leader visibly responds the first few times", "is_correct": true}, {"id": "c", "text": "An anonymous survey tool", "is_correct": false}, {"id": "d", "text": "Team size", "is_correct": false}]', 'People calibrate to what happened last time.', 3),
  (4, 'Receiving feedback well begins with:', '[{"id": "a", "text": "Explaining the context immediately", "is_correct": false}, {"id": "b", "text": "Asking a question to understand before responding", "is_correct": true}, {"id": "c", "text": "Thanking the person and moving on", "is_correct": false}, {"id": "d", "text": "Noting it for the appraisal", "is_correct": false}]', 'Understanding first prevents the explanation becoming a defence.', 4),
  (5, 'Which most reliably builds trust in a team?', '[{"id": "a", "text": "Social events and informal time", "is_correct": false}, {"id": "b", "text": "Consistently doing what you said you would do", "is_correct": true}, {"id": "c", "text": "Being liked by everyone", "is_correct": false}, {"id": "d", "text": "Avoiding difficult conversations", "is_correct": false}]', 'Reliability compounds; warmth without it does not.', 1),
  (5, 'A leader cannot meet a commitment they made to the team. The most trust-preserving action is to:', '[{"id": "a", "text": "Deliver something partial without mentioning it", "is_correct": false}, {"id": "b", "text": "Say so early, explain the change, and re-commit", "is_correct": true}, {"id": "c", "text": "Wait until asked", "is_correct": false}, {"id": "d", "text": "Delegate the commitment quietly", "is_correct": false}]', 'Early disclosure preserves predictability, which is the substance of trust.', 2),
  (5, 'Psychological safety in a team primarily means:', '[{"id": "a", "text": "Members are comfortable at all times", "is_correct": false}, {"id": "b", "text": "Members can take interpersonal risks without fear of humiliation", "is_correct": true}, {"id": "c", "text": "Conflict is avoided", "is_correct": false}, {"id": "d", "text": "Everyone agrees with decisions", "is_correct": false}]', 'It is about the safety to speak up, not the absence of discomfort.', 3),
  (5, 'Which leader behaviour most damages trust?', '[{"id": "a", "text": "Setting a high standard", "is_correct": false}, {"id": "b", "text": "Changing the standard without saying so", "is_correct": true}, {"id": "c", "text": "Giving direct feedback", "is_correct": false}, {"id": "d", "text": "Declining a request", "is_correct": false}]', 'Unannounced change makes the environment unpredictable.', 4),
  (6, 'The most common cause of failed delegation is:', '[{"id": "a", "text": "Choosing the wrong person", "is_correct": false}, {"id": "b", "text": "Unclear decision rights", "is_correct": true}, {"id": "c", "text": "Insufficient deadlines", "is_correct": false}, {"id": "d", "text": "Lack of documentation", "is_correct": false}]', 'People need to know which calls are theirs to make.', 1),
  (6, 'Which instruction delegates best?', '[{"id": "a", "text": "\"Handle the client escalation\"", "is_correct": false}, {"id": "b", "text": "\"Own the client escalation through to resolution; you decide the remedy up to \u00a35k, bring anything above that to me\"", "is_correct": true}, {"id": "c", "text": "\"Do what I would do with the escalation\"", "is_correct": false}, {"id": "d", "text": "\"Keep me updated on the escalation\"", "is_correct": false}]', 'It names the outcome, the authority, and the escalation threshold.', 2),
  (6, 'A leader who re-does delegated work is usually signalling:', '[{"id": "a", "text": "High standards", "is_correct": false}, {"id": "b", "text": "That the delegation was never real", "is_correct": true}, {"id": "c", "text": "Efficient use of expertise", "is_correct": false}, {"id": "d", "text": "Appropriate quality control", "is_correct": false}]', 'Taking the work back withdraws the authority that made it delegation.', 3),
  (6, 'Empowerment without capability produces:', '[{"id": "a", "text": "Faster development", "is_correct": false}, {"id": "b", "text": "Predictable failure and lost confidence", "is_correct": true}, {"id": "c", "text": "Higher engagement", "is_correct": false}, {"id": "d", "text": "Reduced leader workload", "is_correct": false}]', 'Authority has to be matched to readiness, and readiness built deliberately.', 4),
  (7, 'In interest-based conflict resolution, a position is:', '[{"id": "a", "text": "The underlying need", "is_correct": false}, {"id": "b", "text": "The stated demand", "is_correct": true}, {"id": "c", "text": "The relationship history", "is_correct": false}, {"id": "d", "text": "The agreed outcome", "is_correct": false}]', 'Positions are what people ask for; interests are why they want it.', 1),
  (7, 'Two managers both demand the same engineer. The most useful first question is:', '[{"id": "a", "text": "\"Who asked first?\"", "is_correct": false}, {"id": "b", "text": "\"What would having them let you achieve?\"", "is_correct": true}, {"id": "c", "text": "\"Can you share them?\"", "is_correct": false}, {"id": "d", "text": "\"Which project is more important?\"", "is_correct": false}]', 'It moves from the contested position to the underlying interest.', 2),
  (7, 'Avoiding a conflict usually:', '[{"id": "a", "text": "Allows it to resolve naturally", "is_correct": false}, {"id": "b", "text": "Defers it at increasing cost", "is_correct": true}, {"id": "c", "text": "Preserves the relationship", "is_correct": false}, {"id": "d", "text": "Demonstrates emotional control", "is_correct": false}]', 'Unaddressed conflict tends to compound rather than dissipate.', 3),
  (7, 'A leader mediating between two reports should first establish:', '[{"id": "a", "text": "Who is at fault", "is_correct": false}, {"id": "b", "text": "What each person actually needs and what both can agree is true", "is_correct": true}, {"id": "c", "text": "A compromise position", "is_correct": false}, {"id": "d", "text": "A deadline for resolution", "is_correct": false}]', 'Shared facts and surfaced interests come before solution-finding.', 4),
  (8, 'Resistance to change most often reflects:', '[{"id": "a", "text": "An unwillingness to adapt", "is_correct": false}, {"id": "b", "text": "Unanswered questions about impact and agency", "is_correct": true}, {"id": "c", "text": "Poor hiring", "is_correct": false}, {"id": "d", "text": "Generational difference", "is_correct": false}]', 'People resist unexplained loss of control more than they resist change itself.', 1),
  (8, 'Which should a change communication lead with?', '[{"id": "a", "text": "The implementation timeline", "is_correct": false}, {"id": "b", "text": "The reason the change is necessary", "is_correct": true}, {"id": "c", "text": "The list of affected roles", "is_correct": false}, {"id": "d", "text": "The governance structure", "is_correct": false}]', 'Reason first; plan second. Reversing them produces compliance without commitment.', 2),
  (8, 'Naming what will NOT change during a transition:', '[{"id": "a", "text": "Slows adoption", "is_correct": false}, {"id": "b", "text": "Gives people stable ground and reduces anxiety", "is_correct": true}, {"id": "c", "text": "Is usually unnecessary", "is_correct": false}, {"id": "d", "text": "Undermines the case for change", "is_correct": false}]', 'Continuity is what makes discontinuity tolerable.', 3),
  (8, 'The riskiest phase of most change programmes is:', '[{"id": "a", "text": "The announcement", "is_correct": false}, {"id": "b", "text": "The middle, when novelty has worn off and benefits are not yet visible", "is_correct": true}, {"id": "c", "text": "The final review", "is_correct": false}, {"id": "d", "text": "The planning stage", "is_correct": false}]', 'That is where sponsorship typically thins out and momentum is lost.', 4)
) AS v(week_number, question_text, options, explanation, sort_order)
  ON v.week_number = tw.week_number
WHERE p.name = 'Emerging Leaders' AND a.assignment_type = 'quiz';

-- The open-ended reflection prompt for each week.
INSERT INTO public.programme_reflections
  (programme_id, reflection_number, title, instructions, appears_at_week, is_visible)
SELECT p.id, v.n, v.title, v.instructions, v.n, true
FROM public.programmes p CROSS JOIN (VALUES
  (1, 'Week 1 reflection', 'Which emotion most often shapes your leadership decisions without your noticing, and what does it cost you?'),
  (2, 'Week 2 reflection', 'Where in your work do you listen in order to reply rather than to understand, and what are you missing?'),
  (3, 'Week 3 reflection', 'What do you gain by giving the answer, and what does your team lose?'),
  (4, 'Week 4 reflection', 'When did you last change something because of feedback, and what made that feedback land?'),
  (5, 'Week 5 reflection', 'What does your team currently predict about you, and is that prediction accurate?'),
  (6, 'Week 6 reflection', 'What are you still doing yourself because it is faster, and what is that costing your team''s growth?'),
  (7, 'Week 7 reflection', 'Which conflict are you currently avoiding, and what is the avoidance costing?'),
  (8, 'Week 8 reflection', 'In a change you have led, where did you lose people, and what would you do differently?')
) AS v(n, title, instructions)
WHERE p.name = 'Emerging Leaders';

INSERT INTO public.reflection_questions
  (reflection_id, question_text, question_type, is_required, sort_order)
SELECT r.id, v.question_text, v.question_type, true, v.sort_order
FROM public.programme_reflections r
JOIN public.programmes p ON p.id = r.programme_id
JOIN (VALUES
  (1, 'Which emotion most often shapes your leadership decisions without your noticing, and what does it cost you?', 'open_text', 1),
  (1, 'How confident do you feel applying this over the next two weeks?', 'scale_1_10', 2),
  (2, 'Where in your work do you listen in order to reply rather than to understand, and what are you missing?', 'open_text', 1),
  (2, 'How confident do you feel applying this over the next two weeks?', 'scale_1_10', 2),
  (3, 'What do you gain by giving the answer, and what does your team lose?', 'open_text', 1),
  (3, 'How confident do you feel applying this over the next two weeks?', 'scale_1_10', 2),
  (4, 'When did you last change something because of feedback, and what made that feedback land?', 'open_text', 1),
  (4, 'How confident do you feel applying this over the next two weeks?', 'scale_1_10', 2),
  (5, 'What does your team currently predict about you, and is that prediction accurate?', 'open_text', 1),
  (5, 'How confident do you feel applying this over the next two weeks?', 'scale_1_10', 2),
  (6, 'What are you still doing yourself because it is faster, and what is that costing your team''s growth?', 'open_text', 1),
  (6, 'How confident do you feel applying this over the next two weeks?', 'scale_1_10', 2),
  (7, 'Which conflict are you currently avoiding, and what is the avoidance costing?', 'open_text', 1),
  (7, 'How confident do you feel applying this over the next two weeks?', 'scale_1_10', 2),
  (8, 'In a change you have led, where did you lose people, and what would you do differently?', 'open_text', 1),
  (8, 'How confident do you feel applying this over the next two weeks?', 'scale_1_10', 2)
) AS v(n, question_text, question_type, sort_order) ON v.n = r.reflection_number
WHERE p.name = 'Emerging Leaders';

-- Daily prompts. The table hangs each prompt off a training week.
INSERT INTO public.daily_prompts (training_week_id, day_offset, prompt_text, is_visible, sort_order)
SELECT tw.id, v.day_offset, v.prompt_text, true, v.day_offset
FROM public.training_weeks tw
JOIN public.programmes p ON p.id = tw.programme_id
JOIN (VALUES
  (1, 1, 'What is one assumption you made today that you did not test?'),
  (2, 2, 'Who on your team needed something from you today that they did not ask for?'),
  (3, 3, 'Where did you choose comfort over candour this week?'),
  (4, 4, 'What did you delegate today, and did you also delegate the decision?'),
  (5, 5, 'Name one thing you are avoiding. What would make it easier to start?')
) AS v(week_number, day_offset, prompt_text) ON v.week_number = tw.week_number
WHERE p.name = 'Emerging Leaders';

-- ========================================================================
-- Executive Excellence - 10 training weeks
-- ========================================================================

-- Skills cards live on the week itself (finding 1).
INSERT INTO public.training_weeks
  (programme_id, week_number, title, subtitle, skill_card_html,
   is_visible, skill_card_visible, sort_order)
SELECT p.id, v.week_number, v.title, v.subtitle, v.skill_card_html, true, true, v.week_number
FROM public.programmes p
CROSS JOIN (VALUES
  (1, 'Strategic Thinking', 'Choosing what not to do', '<h3>Strategic Thinking</h3><p class="lead">Choosing what not to do</p><p>Strategy is a set of deliberate choices about where to compete and, crucially, where not to. A plan that has no sacrifice in it is a budget, not a strategy. Executives are tested on the trade-offs they are willing to name publicly.</p><h4>Practise this week</h4><p>Write a one-page memo naming three things your function will stop doing next quarter and the capacity that releases. Circulate it to one peer for challenge.</p>'),
  (2, 'Executive Presence', 'Credibility under observation', '<h3>Executive Presence</h3><p class="lead">Credibility under observation</p><p>Presence is the match between what you say, how you say it, and what you do next. It is built less by charisma than by composure under scrutiny and by visible follow-through. The fastest route to more presence is usually fewer, better-kept commitments.</p><h4>Practise this week</h4><p>Record a five-minute update to your leadership team. Watch it back and note one thing you over-claimed and one thing you buried. Re-record it.</p>'),
  (3, 'Stakeholder Management', 'Mapping influence and interest honestly', '<h3>Stakeholder Management</h3><p class="lead">Mapping influence and interest honestly</p><p>Stakeholder work fails when it is treated as communication rather than negotiation. Map who has influence, what they actually need, and where your interests genuinely conflict. Then decide which relationships you will invest in and which you will merely maintain.</p><h4>Practise this week</h4><p>Map the eight stakeholders most able to affect your current priority. For each, record their real interest, their influence, and one action. Test two assumptions by asking them directly.</p>'),
  (4, 'Decision-Making Under Uncertainty', 'Deciding well when you cannot know', '<h3>Decision-Making Under Uncertainty</h3><p class="lead">Deciding well when you cannot know</p><p>Judge decisions by the process, not only the outcome. Under uncertainty, name the reversibility, the information that would change your mind, and the cost of delay. Reversible decisions should be made fast; irreversible ones deserve the extra week.</p><h4>Practise this week</h4><p>For your next significant decision, write the options, the reversibility, what would change your mind, and the decision. Revisit it in 30 days and score the process, not the outcome.</p>'),
  (5, 'Organizational Culture', 'What actually gets rewarded', '<h3>Organizational Culture</h3><p class="lead">What actually gets rewarded</p><p>Culture is the set of behaviours that get rewarded and punished in practice, regardless of stated values. To read a culture, watch who gets promoted and what gets tolerated. To change one, change the consequences, not the posters.</p><h4>Practise this week</h4><p>List your function''s three stated values. For each, find one recent decision that contradicted it. Bring the gap to your leadership team.</p>'),
  (6, 'Innovation & Disruption', 'Protecting the new from the efficient', '<h3>Innovation & Disruption</h3><p class="lead">Protecting the new from the efficient</p><p>Established organisations are optimised to defend existing revenue, which is precisely what kills new bets. Innovation requires different metrics, different timelines, and explicit protection from the core business''s efficiency logic.</p><h4>Practise this week</h4><p>Design one small bet with an explicit hypothesis, a learning metric, a time box, and a kill criterion. Get it approved on those terms rather than a revenue forecast.</p>'),
  (7, 'Leading Through Crisis', 'Stability first, then direction', '<h3>Leading Through Crisis</h3><p class="lead">Stability first, then direction</p><p>In a crisis people need a visible leader, a short cadence, and honest uncertainty. Say what you know, what you do not, and when you will next speak. Over-promising early is the most common and most expensive error.</p><h4>Practise this week</h4><p>Draft a one-page protocol for your function: who leads, cadence, first-hour actions, and what you will say when you do not yet know. Test it in a 30-minute tabletop.</p>'),
  (8, 'Board & Investor Relations', 'Managing the information relationship', '<h3>Board & Investor Relations</h3><p class="lead">Managing the information relationship</p><p>Boards need the bad news early and the context with it. The relationship is built between meetings, not in them. A board that is surprised in the room will discount everything else you present.</p><h4>Practise this week</h4><p>Write a one-page board note on a live issue: the decision required, your recommendation, the risk, and what you do not yet know. Have your chair or a mentor critique it.</p>'),
  (9, 'Succession Planning', 'Building the bench before you need it', '<h3>Succession Planning</h3><p class="lead">Building the bench before you need it</p><p>Succession is a leadership output, not an HR process. If no one could take your role within a year, that is a finding about how you lead. Develop successors by giving real decisions away early, not by nominating names on a chart.</p><h4>Practise this week</h4><p>For your role, name two people who could do it in 12 months and the specific decision authority each lacks. Transfer one of those decisions this quarter.</p>'),
  (10, 'Legacy & Impact', 'What remains when you leave', '<h3>Legacy & Impact</h3><p class="lead">What remains when you leave</p><p>Legacy is not reputation. It is the capability, the people, and the standards that persist without you. The practical question is what you are building that would survive your departure — and what only works because you are personally holding it up.</p><h4>Practise this week</h4><p>List five things in your remit that only work because of your personal involvement. Choose one and design its independence over the next quarter.</p>')
) AS v(week_number, title, subtitle, skill_card_html)
WHERE p.name = 'Executive Excellence';

-- Finding 3: the module must name the weeks, so it is written after them.
INSERT INTO public.programme_modules (programme_id, module, enabled, config)
SELECT p.id, 'training'::public.programme_module_type, true,
  jsonb_build_object(
    'required', true, 'required_units', 10,
    -- Child learning types that count as evidence inside each week (never extra units).
    'learning_components', jsonb_build_array('skill_cards', 'quizzes', 'reflections', 'daily_prompts'),
    'distribution_settings', jsonb_build_object(
      'training_week_ids', (SELECT jsonb_agg(tw.id ORDER BY tw.week_number)
                            FROM public.training_weeks tw WHERE tw.programme_id = p.id)))
FROM public.programmes p WHERE p.name = 'Executive Excellence'
ON CONFLICT (programme_id, module) DO UPDATE SET enabled = true, config = EXCLUDED.config;

-- One quiz and one practical exercise per week (finding 2: the exercise
-- is a reflection-type assignment; there is no 'assignment' type).
INSERT INTO public.assignments
  (training_week_id, assignment_type, title, instructions, is_visible, due_offset_days, sort_order)
SELECT tw.id, v.kind::public.assignment_type, v.title, v.instructions, true, 7, v.sort_order
FROM public.training_weeks tw
JOIN public.programmes p ON p.id = tw.programme_id
JOIN (VALUES
  (1, 'quiz', 'Week 1 quiz: Strategic Thinking', 'Four questions on the key ideas from this week.', 1),
  (1, 'reflection', 'Trade-off memo', 'Write a one-page memo naming three things your function will stop doing next quarter and the capacity that releases. Circulate it to one peer for challenge.', 2),
  (2, 'quiz', 'Week 2 quiz: Executive Presence', 'Four questions on the key ideas from this week.', 1),
  (2, 'reflection', 'Recorded review', 'Record a five-minute update to your leadership team. Watch it back and note one thing you over-claimed and one thing you buried. Re-record it.', 2),
  (3, 'quiz', 'Week 3 quiz: Stakeholder Management', 'Four questions on the key ideas from this week.', 1),
  (3, 'reflection', 'Influence map', 'Map the eight stakeholders most able to affect your current priority. For each, record their real interest, their influence, and one action. Test two assumptions by asking them directly.', 2),
  (4, 'quiz', 'Week 4 quiz: Decision-Making Under Uncertainty', 'Four questions on the key ideas from this week.', 1),
  (4, 'reflection', 'Decision record', 'For your next significant decision, write the options, the reversibility, what would change your mind, and the decision. Revisit it in 30 days and score the process, not the outcome.', 2),
  (5, 'quiz', 'Week 5 quiz: Organizational Culture', 'Four questions on the key ideas from this week.', 1),
  (5, 'reflection', 'Culture audit', 'List your function''s three stated values. For each, find one recent decision that contradicted it. Bring the gap to your leadership team.', 2),
  (6, 'quiz', 'Week 6 quiz: Innovation & Disruption', 'Four questions on the key ideas from this week.', 1),
  (6, 'reflection', 'Bet design', 'Design one small bet with an explicit hypothesis, a learning metric, a time box, and a kill criterion. Get it approved on those terms rather than a revenue forecast.', 2),
  (7, 'quiz', 'Week 7 quiz: Leading Through Crisis', 'Four questions on the key ideas from this week.', 1),
  (7, 'reflection', 'Crisis protocol', 'Draft a one-page protocol for your function: who leads, cadence, first-hour actions, and what you will say when you do not yet know. Test it in a 30-minute tabletop.', 2),
  (8, 'quiz', 'Week 8 quiz: Board & Investor Relations', 'Four questions on the key ideas from this week.', 1),
  (8, 'reflection', 'Board note', 'Write a one-page board note on a live issue: the decision required, your recommendation, the risk, and what you do not yet know. Have your chair or a mentor critique it.', 2),
  (9, 'quiz', 'Week 9 quiz: Succession Planning', 'Four questions on the key ideas from this week.', 1),
  (9, 'reflection', 'Bench review', 'For your role, name two people who could do it in 12 months and the specific decision authority each lacks. Transfer one of those decisions this quarter.', 2),
  (10, 'quiz', 'Week 10 quiz: Legacy & Impact', 'Four questions on the key ideas from this week.', 1),
  (10, 'reflection', 'Legacy inventory', 'List five things in your remit that only work because of your personal involvement. Choose one and design its independence over the next quarter.', 2)
) AS v(week_number, kind, title, instructions, sort_order) ON v.week_number = tw.week_number
WHERE p.name = 'Executive Excellence';

-- Quiz questions: four per week, one correct option, with explanations.
INSERT INTO public.quiz_questions
  (assignment_id, question_text, options, explanation, sort_order)
SELECT a.id, v.question_text, v.options::jsonb, v.explanation, v.sort_order
FROM public.assignments a
JOIN public.training_weeks tw ON tw.id = a.training_week_id
JOIN public.programmes p ON p.id = tw.programme_id
JOIN (VALUES
  (1, 'The clearest marker of a real strategy is:', '[{"id": "a", "text": "An ambitious growth target", "is_correct": false}, {"id": "b", "text": "An explicit choice not to pursue something", "is_correct": true}, {"id": "c", "text": "A detailed implementation plan", "is_correct": false}, {"id": "d", "text": "Board approval", "is_correct": false}]', 'Without a sacrifice, there is no choice being made.', 1),
  (1, 'Strategic thinking differs from operational planning mainly in:', '[{"id": "a", "text": "Time horizon alone", "is_correct": false}, {"id": "b", "text": "Whether it selects between mutually exclusive options", "is_correct": true}, {"id": "c", "text": "Level of detail", "is_correct": false}, {"id": "d", "text": "Who signs it off", "is_correct": false}]', 'Selection between exclusive options is the strategic act.', 2),
  (1, 'A strategy that pleases every stakeholder usually indicates:', '[{"id": "a", "text": "Strong alignment", "is_correct": false}, {"id": "b", "text": "That no real trade-off has been made", "is_correct": true}, {"id": "c", "text": "Effective consultation", "is_correct": false}, {"id": "d", "text": "Mature governance", "is_correct": false}]', 'Universal comfort is a symptom of avoided choices.', 3),
  (1, 'Which question best tests a proposed strategy?', '[{"id": "a", "text": "What is the expected return?", "is_correct": false}, {"id": "b", "text": "What are we choosing to be bad at?", "is_correct": true}, {"id": "c", "text": "How long will it take?", "is_correct": false}, {"id": "d", "text": "Who owns delivery?", "is_correct": false}]', 'It forces the sacrifice into the open.', 4),
  (2, 'Executive presence is best understood as:', '[{"id": "a", "text": "Natural charisma", "is_correct": false}, {"id": "b", "text": "Consistency between message, manner and subsequent action", "is_correct": true}, {"id": "c", "text": "Confident public speaking", "is_correct": false}, {"id": "d", "text": "Seniority signalling", "is_correct": false}]', 'Alignment over time is what registers as presence.', 1),
  (2, 'Under hostile questioning, the highest-presence response is to:', '[{"id": "a", "text": "Match the energy of the questioner", "is_correct": false}, {"id": "b", "text": "Slow down, acknowledge the question, and answer the hardest part directly", "is_correct": true}, {"id": "c", "text": "Defer to a colleague", "is_correct": false}, {"id": "d", "text": "Return to prepared messaging", "is_correct": false}]', 'Composure plus directness reads as credibility.', 2),
  (2, 'Which most undermines presence?', '[{"id": "a", "text": "Admitting you do not know", "is_correct": false}, {"id": "b", "text": "Over-claiming and later quietly retreating", "is_correct": true}, {"id": "c", "text": "Speaking briefly", "is_correct": false}, {"id": "d", "text": "Disagreeing with a peer", "is_correct": false}]', 'Retreat from an over-claim damages trust more than the original gap.', 3),
  (2, 'Presence in writing depends most on:', '[{"id": "a", "text": "Length and thoroughness", "is_correct": false}, {"id": "b", "text": "Clarity about what you are asking for", "is_correct": true}, {"id": "c", "text": "Formal register", "is_correct": false}, {"id": "d", "text": "Use of data", "is_correct": false}]', 'Ambiguity about the ask is the most common executive-writing failure.', 4),
  (3, 'A stakeholder map is most useful when it records:', '[{"id": "a", "text": "Job titles and reporting lines", "is_correct": false}, {"id": "b", "text": "Each stakeholder''s interest and their influence over your outcome", "is_correct": true}, {"id": "c", "text": "Meeting frequency", "is_correct": false}, {"id": "d", "text": "Communication preferences", "is_correct": false}]', 'Interest and influence determine where effort pays.', 1),
  (3, 'A high-influence, low-support stakeholder should usually be:', '[{"id": "a", "text": "Avoided until the decision is made", "is_correct": false}, {"id": "b", "text": "Engaged early and directly on their specific concern", "is_correct": true}, {"id": "c", "text": "Managed through your sponsor", "is_correct": false}, {"id": "d", "text": "Informed via general updates", "is_correct": false}]', 'Late engagement of an influential sceptic is a common cause of failure.', 2),
  (3, 'Which is the clearest sign a stakeholder relationship is transactional rather than trusted?', '[{"id": "a", "text": "Infrequent contact", "is_correct": false}, {"id": "b", "text": "They only hear from you when you need something", "is_correct": true}, {"id": "c", "text": "Formal communication style", "is_correct": false}, {"id": "d", "text": "Disagreement on priorities", "is_correct": false}]', 'Contact correlated with need is the defining pattern.', 3),
  (3, 'Conflicting stakeholder interests should first be:', '[{"id": "a", "text": "Escalated to a common sponsor", "is_correct": false}, {"id": "b", "text": "Named explicitly rather than smoothed over", "is_correct": true}, {"id": "c", "text": "Resolved by compromise", "is_correct": false}, {"id": "d", "text": "Deferred to governance", "is_correct": false}]', 'Unnamed conflicts resurface at the worst moment.', 4),
  (4, 'A good decision under uncertainty is best judged by:', '[{"id": "a", "text": "The outcome achieved", "is_correct": false}, {"id": "b", "text": "The quality of the process and information used", "is_correct": true}, {"id": "c", "text": "Stakeholder satisfaction", "is_correct": false}, {"id": "d", "text": "Speed of execution", "is_correct": false}]', 'Good processes sometimes produce bad outcomes; that does not make them bad decisions.', 1),
  (4, 'Reversible decisions should generally be:', '[{"id": "a", "text": "Delayed until more data arrives", "is_correct": false}, {"id": "b", "text": "Made quickly and revisited", "is_correct": true}, {"id": "c", "text": "Escalated for approval", "is_correct": false}, {"id": "d", "text": "Treated like irreversible ones", "is_correct": false}]', 'The cost of being wrong is low and the cost of delay is real.', 2),
  (4, 'Which question most improves a difficult decision?', '[{"id": "a", "text": "Who else has done this?", "is_correct": false}, {"id": "b", "text": "What would change my mind?", "is_correct": true}, {"id": "c", "text": "What is the worst case?", "is_correct": false}, {"id": "d", "text": "How long do we have?", "is_correct": false}]', 'It surfaces the assumptions the decision rests on.', 3),
  (4, 'Analysis paralysis is most often a symptom of:', '[{"id": "a", "text": "Insufficient data", "is_correct": false}, {"id": "b", "text": "Unnamed fear of being blamed for the wrong call", "is_correct": true}, {"id": "c", "text": "Weak analytical skill", "is_correct": false}, {"id": "d", "text": "Complex problems", "is_correct": false}]', 'The missing element is usually psychological safety, not information.', 4),
  (5, 'The most reliable indicator of an organisation''s real culture is:', '[{"id": "a", "text": "Its stated values", "is_correct": false}, {"id": "b", "text": "Who gets promoted and what gets tolerated", "is_correct": true}, {"id": "c", "text": "Employee survey scores", "is_correct": false}, {"id": "d", "text": "Its onboarding materials", "is_correct": false}]', 'Consequences reveal culture; statements describe aspiration.', 1),
  (5, 'A values statement that contradicts daily experience produces:', '[{"id": "a", "text": "Gradual alignment", "is_correct": false}, {"id": "b", "text": "Cynicism and reduced trust in leadership", "is_correct": true}, {"id": "c", "text": "Neutral effect", "is_correct": false}, {"id": "d", "text": "Improved retention", "is_correct": false}]', 'The gap itself becomes the message.', 2),
  (5, 'The most effective lever for changing culture is:', '[{"id": "a", "text": "Communication campaigns", "is_correct": false}, {"id": "b", "text": "Changing what is measured and rewarded", "is_correct": true}, {"id": "c", "text": "Training programmes", "is_correct": false}, {"id": "d", "text": "Restructuring", "is_correct": false}]', 'Behaviour follows consequence.', 3),
  (5, 'Subcultures within a large organisation are:', '[{"id": "a", "text": "A failure of alignment", "is_correct": false}, {"id": "b", "text": "Normal, and sometimes a source of adaptation", "is_correct": true}, {"id": "c", "text": "Always harmful", "is_correct": false}, {"id": "d", "text": "Evidence of weak leadership", "is_correct": false}]', 'Local variation is often where useful practice originates.', 4),
  (6, 'New ventures inside established firms most often fail because:', '[{"id": "a", "text": "Poor ideas", "is_correct": false}, {"id": "b", "text": "They are measured by the core business''s metrics", "is_correct": true}, {"id": "c", "text": "Insufficient funding", "is_correct": false}, {"id": "d", "text": "Weak leadership", "is_correct": false}]', 'Judging a young bet on mature-business metrics kills it early.', 1),
  (6, 'Disruption theory suggests incumbents lose because they:', '[{"id": "a", "text": "Ignore technology", "is_correct": false}, {"id": "b", "text": "Rationally serve their best customers and ignore low-end entrants", "is_correct": true}, {"id": "c", "text": "Underinvest in R&D", "is_correct": false}, {"id": "d", "text": "Lack talent", "is_correct": false}]', 'The failure is a rational response to existing incentives.', 2),
  (6, 'An innovation portfolio should be judged on:', '[{"id": "a", "text": "Average return per project", "is_correct": false}, {"id": "b", "text": "Learning rate and option value across the portfolio", "is_correct": true}, {"id": "c", "text": "Individual project ROI", "is_correct": false}, {"id": "d", "text": "Time to market", "is_correct": false}]', 'Portfolio logic, not project logic, applies to uncertain bets.', 3),
  (6, 'The clearest sign an organisation is not serious about innovation is:', '[{"id": "a", "text": "Small budgets", "is_correct": false}, {"id": "b", "text": "Requiring a business case with certain revenue forecasts", "is_correct": true}, {"id": "c", "text": "Few dedicated staff", "is_correct": false}, {"id": "d", "text": "Long approval cycles", "is_correct": false}]', 'Demanding certainty at the outset excludes anything genuinely new.', 4),
  (7, 'The first priority in the opening hours of a crisis is:', '[{"id": "a", "text": "A full root-cause analysis", "is_correct": false}, {"id": "b", "text": "Establishing a visible leader, a communication cadence and known facts", "is_correct": true}, {"id": "c", "text": "Reassuring external stakeholders", "is_correct": false}, {"id": "d", "text": "Assigning accountability", "is_correct": false}]', 'Stability and rhythm precede analysis.', 1),
  (7, 'Communicating uncertainty during a crisis:', '[{"id": "a", "text": "Undermines confidence", "is_correct": false}, {"id": "b", "text": "Preserves credibility for when you do have answers", "is_correct": true}, {"id": "c", "text": "Should be avoided", "is_correct": false}, {"id": "d", "text": "Is only appropriate internally", "is_correct": false}]', 'Credibility spent on false certainty is not recoverable.', 2),
  (7, 'A crisis cadence should be:', '[{"id": "a", "text": "Whenever there is news", "is_correct": false}, {"id": "b", "text": "Fixed and predictable, even when there is little to report", "is_correct": true}, {"id": "c", "text": "Daily regardless of scale", "is_correct": false}, {"id": "d", "text": "Set by communications", "is_correct": false}]', 'Predictability reduces the rumour cycle.', 3),
  (7, 'The most common leadership error in crisis is:', '[{"id": "a", "text": "Acting too slowly", "is_correct": false}, {"id": "b", "text": "Promising resolution timelines that cannot be met", "is_correct": true}, {"id": "c", "text": "Involving too many people", "is_correct": false}, {"id": "d", "text": "Over-communicating", "is_correct": false}]', 'Missed promises compound the original problem with a trust problem.', 4),
  (8, 'Bad news should reach the board:', '[{"id": "a", "text": "At the next scheduled meeting with a solution", "is_correct": false}, {"id": "b", "text": "Early, with context and your intended response", "is_correct": true}, {"id": "c", "text": "Once fully resolved", "is_correct": false}, {"id": "d", "text": "Through the chair informally", "is_correct": false}]', 'Early disclosure with a plan preserves confidence; surprises destroy it.', 1),
  (8, 'Most of the board relationship is built:', '[{"id": "a", "text": "In formal meetings", "is_correct": false}, {"id": "b", "text": "Between meetings, one to one", "is_correct": true}, {"id": "c", "text": "Through board papers", "is_correct": false}, {"id": "d", "text": "At the annual strategy day", "is_correct": false}]', 'The meeting ratifies understanding that was built beforehand.', 2),
  (8, 'A board paper is most effective when it:', '[{"id": "a", "text": "Presents all available analysis", "is_correct": false}, {"id": "b", "text": "Leads with the decision required and the recommendation", "is_correct": true}, {"id": "c", "text": "Follows a standard template", "is_correct": false}, {"id": "d", "text": "Includes extensive appendices", "is_correct": false}]', 'Boards need the ask first; evidence supports it.', 3),
  (8, 'A board that is repeatedly surprised will typically:', '[{"id": "a", "text": "Increase delegated authority", "is_correct": false}, {"id": "b", "text": "Increase scrutiny and reduce trust in management", "is_correct": true}, {"id": "c", "text": "Change strategy", "is_correct": false}, {"id": "d", "text": "Replace the chair", "is_correct": false}]', 'Surprise is read as a control failure.', 4),
  (9, 'The strongest evidence of good succession planning is:', '[{"id": "a", "text": "A completed succession chart", "is_correct": false}, {"id": "b", "text": "Internal candidates who have already held real decision authority", "is_correct": true}, {"id": "c", "text": "A talent review process", "is_correct": false}, {"id": "d", "text": "Low attrition", "is_correct": false}]', 'Readiness is built by exercised authority, not designation.', 1),
  (9, 'A leader with no viable successor after two years in post has most likely:', '[{"id": "a", "text": "Hired poorly", "is_correct": false}, {"id": "b", "text": "Retained too many decisions", "is_correct": true}, {"id": "c", "text": "Been under-resourced", "is_correct": false}, {"id": "d", "text": "Faced unusual conditions", "is_correct": false}]', 'Concentrated decision-making prevents the bench from forming.', 2),
  (9, 'Successor development is best accelerated by:', '[{"id": "a", "text": "Formal training programmes", "is_correct": false}, {"id": "b", "text": "Stretch assignments with genuine consequences", "is_correct": true}, {"id": "c", "text": "Mentoring relationships", "is_correct": false}, {"id": "d", "text": "Job rotation", "is_correct": false}]', 'Real stakes create the judgement that training cannot.', 3),
  (9, 'Naming a single successor too early risks:', '[{"id": "a", "text": "Nothing significant", "is_correct": false}, {"id": "b", "text": "Disengaging other capable candidates and narrowing the pool", "is_correct": true}, {"id": "c", "text": "Faster transition", "is_correct": false}, {"id": "d", "text": "Better planning", "is_correct": false}]', 'Premature designation shrinks the bench you were trying to build.', 4),
  (10, 'A leader''s legacy is best measured by:', '[{"id": "a", "text": "Results achieved during tenure", "is_correct": false}, {"id": "b", "text": "What continues to function well after they leave", "is_correct": true}, {"id": "c", "text": "Reputation among peers", "is_correct": false}, {"id": "d", "text": "Positions held", "is_correct": false}]', 'Persistence without the leader is the test.', 1),
  (10, 'Which is the clearest warning sign for legacy?', '[{"id": "a", "text": "High personal workload", "is_correct": false}, {"id": "b", "text": "Processes that only work when you intervene", "is_correct": true}, {"id": "c", "text": "Frequent travel", "is_correct": false}, {"id": "d", "text": "A demanding board", "is_correct": false}]', 'Personal indispensability is fragility, not value.', 2),
  (10, 'Building durable capability requires:', '[{"id": "a", "text": "Documenting processes", "is_correct": false}, {"id": "b", "text": "Transferring judgement, not only procedure", "is_correct": true}, {"id": "c", "text": "Hiring senior people", "is_correct": false}, {"id": "d", "text": "Standardising decisions", "is_correct": false}]', 'Procedure transfers easily; judgement is the hard part.', 3),
  (10, 'Legacy thinking is most useful when applied:', '[{"id": "a", "text": "At retirement", "is_correct": false}, {"id": "b", "text": "Continuously, as a design constraint on how you lead", "is_correct": true}, {"id": "c", "text": "At appraisal", "is_correct": false}, {"id": "d", "text": "When changing roles", "is_correct": false}]', 'It is a way of working, not a closing exercise.', 4)
) AS v(week_number, question_text, options, explanation, sort_order)
  ON v.week_number = tw.week_number
WHERE p.name = 'Executive Excellence' AND a.assignment_type = 'quiz';

-- The open-ended reflection prompt for each week.
INSERT INTO public.programme_reflections
  (programme_id, reflection_number, title, instructions, appears_at_week, is_visible)
SELECT p.id, v.n, v.title, v.instructions, v.n, true
FROM public.programmes p CROSS JOIN (VALUES
  (1, 'Week 1 reflection', 'What are you currently trying to be good at that you should deliberately give up?'),
  (2, 'Week 2 reflection', 'Where does your stated position and your actual behaviour diverge, and who has noticed?'),
  (3, 'Week 3 reflection', 'Whose support are you assuming that you have not actually confirmed?'),
  (4, 'Week 4 reflection', 'Which decision are you delaying, and is the delay buying information or avoiding accountability?'),
  (5, 'Week 5 reflection', 'What behaviour does your organisation reward that it would never state publicly?'),
  (6, 'Week 6 reflection', 'What would your organisation have to stop doing for a genuinely new idea to survive here?'),
  (7, 'Week 7 reflection', 'In the last difficult period you led through, what did you promise that you could not control?'),
  (8, 'Week 8 reflection', 'What are you currently not telling your board, and what is your real reason?'),
  (9, 'Week 9 reflection', 'What would break if you were unavailable for three months, and what does that tell you?'),
  (10, 'Week 10 reflection', 'What are you holding up personally that should be able to stand without you?')
) AS v(n, title, instructions)
WHERE p.name = 'Executive Excellence';

INSERT INTO public.reflection_questions
  (reflection_id, question_text, question_type, is_required, sort_order)
SELECT r.id, v.question_text, v.question_type, true, v.sort_order
FROM public.programme_reflections r
JOIN public.programmes p ON p.id = r.programme_id
JOIN (VALUES
  (1, 'What are you currently trying to be good at that you should deliberately give up?', 'open_text', 1),
  (1, 'How confident do you feel applying this over the next two weeks?', 'scale_1_10', 2),
  (2, 'Where does your stated position and your actual behaviour diverge, and who has noticed?', 'open_text', 1),
  (2, 'How confident do you feel applying this over the next two weeks?', 'scale_1_10', 2),
  (3, 'Whose support are you assuming that you have not actually confirmed?', 'open_text', 1),
  (3, 'How confident do you feel applying this over the next two weeks?', 'scale_1_10', 2),
  (4, 'Which decision are you delaying, and is the delay buying information or avoiding accountability?', 'open_text', 1),
  (4, 'How confident do you feel applying this over the next two weeks?', 'scale_1_10', 2),
  (5, 'What behaviour does your organisation reward that it would never state publicly?', 'open_text', 1),
  (5, 'How confident do you feel applying this over the next two weeks?', 'scale_1_10', 2),
  (6, 'What would your organisation have to stop doing for a genuinely new idea to survive here?', 'open_text', 1),
  (6, 'How confident do you feel applying this over the next two weeks?', 'scale_1_10', 2),
  (7, 'In the last difficult period you led through, what did you promise that you could not control?', 'open_text', 1),
  (7, 'How confident do you feel applying this over the next two weeks?', 'scale_1_10', 2),
  (8, 'What are you currently not telling your board, and what is your real reason?', 'open_text', 1),
  (8, 'How confident do you feel applying this over the next two weeks?', 'scale_1_10', 2),
  (9, 'What would break if you were unavailable for three months, and what does that tell you?', 'open_text', 1),
  (9, 'How confident do you feel applying this over the next two weeks?', 'scale_1_10', 2),
  (10, 'What are you holding up personally that should be able to stand without you?', 'open_text', 1),
  (10, 'How confident do you feel applying this over the next two weeks?', 'scale_1_10', 2)
) AS v(n, question_text, question_type, sort_order) ON v.n = r.reflection_number
WHERE p.name = 'Executive Excellence';

-- Daily prompts. The table hangs each prompt off a training week.
INSERT INTO public.daily_prompts (training_week_id, day_offset, prompt_text, is_visible, sort_order)
SELECT tw.id, v.day_offset, v.prompt_text, true, v.day_offset
FROM public.training_weeks tw
JOIN public.programmes p ON p.id = tw.programme_id
JOIN (VALUES
  (1, 1, 'What are you choosing not to do this quarter, and who knows it?'),
  (2, 2, 'Which stakeholder have you not spoken to when you should have?'),
  (3, 3, 'What decision are you delaying, and is the delay buying information?'),
  (4, 4, 'Where does your stated priority and your calendar disagree?'),
  (5, 5, 'What would your successor change first?')
) AS v(week_number, day_offset, prompt_text) ON v.week_number = tw.week_number
WHERE p.name = 'Executive Excellence';

-- ========================================================================
-- TASC Essential - 6 training weeks
-- ========================================================================

-- Skills cards live on the week itself (finding 1).
INSERT INTO public.training_weeks
  (programme_id, week_number, title, subtitle, skill_card_html,
   is_visible, skill_card_visible, sort_order)
SELECT p.id, v.week_number, v.title, v.subtitle, v.skill_card_html, true, true, v.week_number
FROM public.programmes p
CROSS JOIN (VALUES
  (1, 'Foundations of Coaching', 'The contract, the alliance, and the boundary', '<h3>Foundations of Coaching</h3><p class="lead">The contract, the alliance, and the boundary</p><p>Coaching is a structured relationship with an explicit agreement: what we will work on, how we will work, and what is out of scope. Most difficulties later trace back to a contracting conversation that was skipped at the start.</p><h4>Practise this week</h4><p>Run a full contracting conversation with a practice client. Write the agreed goal, method and boundaries in three sentences and have them confirm it.</p>'),
  (2, 'The GROW Model', 'A structure that keeps the client thinking', '<h3>The GROW Model</h3><p class="lead">A structure that keeps the client thinking</p><p>GROW — Goal, Reality, Options, Will — is a sequence, not a script. Its value is that it stops coaches from jumping to Options before Reality is honest. Most stalled sessions have skipped or rushed Reality.</p><h4>Practise this week</h4><p>Run a 30-minute GROW session. Record how long you spent in each stage and note where you were tempted to skip ahead.</p>'),
  (3, 'Powerful Questions', 'Short, open, and free of your hypothesis', '<h3>Powerful Questions</h3><p class="lead">Short, open, and free of your hypothesis</p><p>A powerful question is usually short, open, and carries no embedded recommendation. "What matters most here?" outperforms "Do you think you should prioritise the client work?" — the second is advice with a question mark.</p><h4>Practise this week</h4><p>Record a practice session. Transcribe every question you asked, mark those containing advice, and rewrite five of them.</p>'),
  (4, 'Active Listening Deep Dive', 'Levels of listening and what each misses', '<h3>Active Listening Deep Dive</h3><p class="lead">Levels of listening and what each misses</p><p>Listening operates at levels: to yourself, to the words, and to the whole person including tone, pace and what is absent. Level-three listening notices the sentence the client did not finish.</p><h4>Practise this week</h4><p>In three sessions, note one thing the client did not say. Offer the observation tentatively and record what happened.</p>'),
  (5, 'Ethics & Boundaries', 'Confidentiality, competence, and the third party', '<h3>Ethics & Boundaries</h3><p class="lead">Confidentiality, competence, and the third party</p><p>Coaching ethics turn on three questions: is this within my competence, who is the client when an organisation is paying, and what exactly did I promise about confidentiality. Ambiguity on any of these creates harm.</p><h4>Practise this week</h4><p>Write your three-way confidentiality terms in plain language — what the sponsor receives and what they never receive. Test it against two awkward scenarios.</p>'),
  (6, 'Building a Coaching Practice', 'Sustaining quality over volume', '<h3>Building a Coaching Practice</h3><p class="lead">Sustaining quality over volume</p><p>A durable practice rests on supervision, deliberate reflection, and a referral network — not on volume. Coaches who skip supervision drift without noticing. Build the reflective infrastructure before the client load.</p><h4>Practise this week</h4><p>Write a one-page plan: supervision cadence, reflective practice, competence boundaries, and referral contacts. Book the first supervision session.</p>')
) AS v(week_number, title, subtitle, skill_card_html)
WHERE p.name = 'TASC Essential';

-- Finding 3: the module must name the weeks, so it is written after them.
INSERT INTO public.programme_modules (programme_id, module, enabled, config)
SELECT p.id, 'training'::public.programme_module_type, true,
  jsonb_build_object(
    'required', true, 'required_units', 6,
    -- Child learning types that count as evidence inside each week (never extra units).
    'learning_components', jsonb_build_array('skill_cards', 'quizzes', 'reflections', 'daily_prompts'),
    'distribution_settings', jsonb_build_object(
      'training_week_ids', (SELECT jsonb_agg(tw.id ORDER BY tw.week_number)
                            FROM public.training_weeks tw WHERE tw.programme_id = p.id)))
FROM public.programmes p WHERE p.name = 'TASC Essential'
ON CONFLICT (programme_id, module) DO UPDATE SET enabled = true, config = EXCLUDED.config;

-- One quiz and one practical exercise per week (finding 2: the exercise
-- is a reflection-type assignment; there is no 'assignment' type).
INSERT INTO public.assignments
  (training_week_id, assignment_type, title, instructions, is_visible, due_offset_days, sort_order)
SELECT tw.id, v.kind::public.assignment_type, v.title, v.instructions, true, 7, v.sort_order
FROM public.training_weeks tw
JOIN public.programmes p ON p.id = tw.programme_id
JOIN (VALUES
  (1, 'quiz', 'Week 1 quiz: Foundations of Coaching', 'Four questions on the key ideas from this week.', 1),
  (1, 'reflection', 'Contracting practice', 'Run a full contracting conversation with a practice client. Write the agreed goal, method and boundaries in three sentences and have them confirm it.', 2),
  (2, 'quiz', 'Week 2 quiz: The GROW Model', 'Four questions on the key ideas from this week.', 1),
  (2, 'reflection', 'GROW session', 'Run a 30-minute GROW session. Record how long you spent in each stage and note where you were tempted to skip ahead.', 2),
  (3, 'quiz', 'Week 3 quiz: Powerful Questions', 'Four questions on the key ideas from this week.', 1),
  (3, 'reflection', 'Question log', 'Record a practice session. Transcribe every question you asked, mark those containing advice, and rewrite five of them.', 2),
  (4, 'quiz', 'Week 4 quiz: Active Listening Deep Dive', 'Four questions on the key ideas from this week.', 1),
  (4, 'reflection', 'Level-three practice', 'In three sessions, note one thing the client did not say. Offer the observation tentatively and record what happened.', 2),
  (5, 'quiz', 'Week 5 quiz: Ethics & Boundaries', 'Four questions on the key ideas from this week.', 1),
  (5, 'reflection', 'Ethics scenario', 'Write your three-way confidentiality terms in plain language — what the sponsor receives and what they never receive. Test it against two awkward scenarios.', 2),
  (6, 'quiz', 'Week 6 quiz: Building a Coaching Practice', 'Four questions on the key ideas from this week.', 1),
  (6, 'reflection', 'Practice plan', 'Write a one-page plan: supervision cadence, reflective practice, competence boundaries, and referral contacts. Book the first supervision session.', 2)
) AS v(week_number, kind, title, instructions, sort_order) ON v.week_number = tw.week_number
WHERE p.name = 'TASC Essential';

-- Quiz questions: four per week, one correct option, with explanations.
INSERT INTO public.quiz_questions
  (assignment_id, question_text, options, explanation, sort_order)
SELECT a.id, v.question_text, v.options::jsonb, v.explanation, v.sort_order
FROM public.assignments a
JOIN public.training_weeks tw ON tw.id = a.training_week_id
JOIN public.programmes p ON p.id = tw.programme_id
JOIN (VALUES
  (1, 'The coaching contract primarily establishes:', '[{"id": "a", "text": "Fees and scheduling", "is_correct": false}, {"id": "b", "text": "The goal, the working method and the boundaries", "is_correct": true}, {"id": "c", "text": "Confidentiality only", "is_correct": false}, {"id": "d", "text": "The number of sessions", "is_correct": false}]', 'It is the shared agreement that makes the work safe and focused.', 1),
  (1, 'Coaching is distinguished from mentoring mainly by:', '[{"id": "a", "text": "Session length", "is_correct": false}, {"id": "b", "text": "Whether the practitioner supplies their own expertise and answers", "is_correct": true}, {"id": "c", "text": "Formality", "is_correct": false}, {"id": "d", "text": "Seniority of the client", "is_correct": false}]', 'Mentors lend experience; coaches develop the client''s own thinking.', 2),
  (1, 'A coach who begins advising has usually:', '[{"id": "a", "text": "Adapted appropriately", "is_correct": false}, {"id": "b", "text": "Stepped outside the coaching contract without renegotiating it", "is_correct": true}, {"id": "c", "text": "Saved time", "is_correct": false}, {"id": "d", "text": "Demonstrated expertise", "is_correct": false}]', 'Switching modes is legitimate only if it is named and agreed.', 3),
  (1, 'The working alliance in coaching refers to:', '[{"id": "a", "text": "Personal rapport", "is_correct": false}, {"id": "b", "text": "The shared agreement on goals, tasks and the bond between coach and client", "is_correct": true}, {"id": "c", "text": "The contract document", "is_correct": false}, {"id": "d", "text": "The organisational sponsor relationship", "is_correct": false}]', 'Goals, tasks and bond together predict outcome more than technique does.', 4),
  (2, 'In GROW, the stage most often rushed is:', '[{"id": "a", "text": "Goal", "is_correct": false}, {"id": "b", "text": "Reality", "is_correct": true}, {"id": "c", "text": "Options", "is_correct": false}, {"id": "d", "text": "Will", "is_correct": false}]', 'Coaches move to solutions before the current situation is honestly described.', 1),
  (2, 'The Will stage is complete when the client has:', '[{"id": "a", "text": "Chosen an option", "is_correct": false}, {"id": "b", "text": "Committed to a specific action with a time and a first step", "is_correct": true}, {"id": "c", "text": "Expressed motivation", "is_correct": false}, {"id": "d", "text": "Agreed to reflect", "is_correct": false}]', 'Commitment is specific, not general.', 2),
  (2, 'A well-formed Goal in GROW is:', '[{"id": "a", "text": "Ambitious and inspiring", "is_correct": false}, {"id": "b", "text": "Specific enough that both parties would recognise achievement", "is_correct": true}, {"id": "c", "text": "Set by the coach", "is_correct": false}, {"id": "d", "text": "Aligned to organisational objectives", "is_correct": false}]', 'Recognisability is the practical test.', 3),
  (2, 'If a client produces only two weak options, the coach should:', '[{"id": "a", "text": "Suggest a third", "is_correct": false}, {"id": "b", "text": "Ask for more before evaluating any", "is_correct": true}, {"id": "c", "text": "Move to Will", "is_correct": false}, {"id": "d", "text": "Return to Goal", "is_correct": false}]', 'Premature evaluation collapses the option space.', 4),
  (3, 'Which is the most powerful question?', '[{"id": "a", "text": "\"Have you considered delegating that?\"", "is_correct": false}, {"id": "b", "text": "\"What matters most here?\"", "is_correct": true}, {"id": "c", "text": "\"Don''t you think that is risky?\"", "is_correct": false}, {"id": "d", "text": "\"Why did you do it that way?\"", "is_correct": false}]', 'It is short, open, and carries no hypothesis.', 1),
  (3, '"Why" questions often work poorly in coaching because they:', '[{"id": "a", "text": "Take too long to answer", "is_correct": false}, {"id": "b", "text": "Tend to prompt justification rather than exploration", "is_correct": true}, {"id": "c", "text": "Are too open", "is_correct": false}, {"id": "d", "text": "Sound informal", "is_correct": false}]', 'They invite defence of a past choice.', 2),
  (3, 'Embedded advice in a question is problematic because it:', '[{"id": "a", "text": "Wastes time", "is_correct": false}, {"id": "b", "text": "Returns the thinking to the coach", "is_correct": true}, {"id": "c", "text": "Confuses the client", "is_correct": false}, {"id": "d", "text": "Breaks the contract", "is_correct": false}]', 'The client responds to your idea instead of developing their own.', 3),
  (3, 'Question length in coaching tends to correlate with:', '[{"id": "a", "text": "Depth of enquiry", "is_correct": false}, {"id": "b", "text": "Inversely with usefulness", "is_correct": true}, {"id": "c", "text": "Client engagement", "is_correct": false}, {"id": "d", "text": "Coach experience", "is_correct": false}]', 'Long questions usually contain the coach''s thinking.', 4),
  (4, 'Level-one listening is characterised by:', '[{"id": "a", "text": "Focus on the client''s meaning", "is_correct": false}, {"id": "b", "text": "The listener attending mainly to their own reaction and next question", "is_correct": true}, {"id": "c", "text": "Attention to tone and body language", "is_correct": false}, {"id": "d", "text": "Silence", "is_correct": false}]', 'Internal focus is level one; it is where most conversation happens.', 1),
  (4, 'Noticing what a client does NOT say is an example of:', '[{"id": "a", "text": "Interpretation", "is_correct": false}, {"id": "b", "text": "Level-three listening", "is_correct": true}, {"id": "c", "text": "Projection", "is_correct": false}, {"id": "d", "text": "Summarising", "is_correct": false}]', 'Absence carries information.', 2),
  (4, 'The most common barrier to deep listening in coaching is:', '[{"id": "a", "text": "Environment", "is_correct": false}, {"id": "b", "text": "The coach''s urge to be useful", "is_correct": true}, {"id": "c", "text": "Client reticence", "is_correct": false}, {"id": "d", "text": "Session length", "is_correct": false}]', 'Helpfulness pulls attention back to the coach''s own thinking.', 3),
  (4, 'Reflecting a client''s exact words rather than paraphrasing is useful when:', '[{"id": "a", "text": "Always", "is_correct": false}, {"id": "b", "text": "The specific word choice appears to carry weight", "is_correct": true}, {"id": "c", "text": "The client is unclear", "is_correct": false}, {"id": "d", "text": "Time is short", "is_correct": false}]', 'Their word may hold meaning your paraphrase would smooth away.', 4),
  (5, 'An organisation sponsors coaching and asks for a progress summary. The coach should:', '[{"id": "a", "text": "Provide it \u2014 the sponsor is paying", "is_correct": false}, {"id": "b", "text": "Follow the confidentiality terms agreed in contracting with all parties", "is_correct": true}, {"id": "c", "text": "Decline all contact with the sponsor", "is_correct": false}, {"id": "d", "text": "Provide it with the client''s verbal agreement afterwards", "is_correct": false}]', 'Three-way contracting at the outset determines what may be shared.', 1),
  (5, 'A client discloses an issue outside the coach''s competence. The appropriate response is:', '[{"id": "a", "text": "Research the area and continue", "is_correct": false}, {"id": "b", "text": "Name the limit and discuss referral", "is_correct": true}, {"id": "c", "text": "Continue with caution", "is_correct": false}, {"id": "d", "text": "Terminate the relationship", "is_correct": false}]', 'Competence boundaries require naming, not quiet avoidance.', 2),
  (5, 'Dual relationships in coaching are problematic because they:', '[{"id": "a", "text": "Are prohibited in all cases", "is_correct": false}, {"id": "b", "text": "Create conflicting obligations that can compromise the client", "is_correct": true}, {"id": "c", "text": "Reduce rapport", "is_correct": false}, {"id": "d", "text": "Complicate scheduling", "is_correct": false}]', 'Competing loyalties are the core risk.', 3),
  (5, 'Confidentiality in coaching is:', '[{"id": "a", "text": "Absolute", "is_correct": false}, {"id": "b", "text": "Bounded by agreed exceptions established in advance", "is_correct": true}, {"id": "c", "text": "At the coach''s discretion", "is_correct": false}, {"id": "d", "text": "Determined by the sponsor", "is_correct": false}]', 'Limits must be explicit before they are needed.', 4),
  (6, 'Regular supervision primarily serves to:', '[{"id": "a", "text": "Meet accreditation requirements", "is_correct": false}, {"id": "b", "text": "Surface the coach''s blind spots and protect client work", "is_correct": true}, {"id": "c", "text": "Provide business development", "is_correct": false}, {"id": "d", "text": "Resolve scheduling", "is_correct": false}]', 'Supervision exists to catch what the coach cannot see alone.', 1),
  (6, 'The most common cause of quality decline in a growing practice is:', '[{"id": "a", "text": "Client mix", "is_correct": false}, {"id": "b", "text": "Volume outpacing reflective capacity", "is_correct": true}, {"id": "c", "text": "Pricing", "is_correct": false}, {"id": "d", "text": "Marketing effort", "is_correct": false}]', 'Reflection is the first thing squeezed and the last thing noticed.', 2),
  (6, 'A referral network is valuable mainly because it:', '[{"id": "a", "text": "Generates income", "is_correct": false}, {"id": "b", "text": "Lets you decline work outside your competence without abandoning the client", "is_correct": true}, {"id": "c", "text": "Builds reputation", "is_correct": false}, {"id": "d", "text": "Reduces marketing cost", "is_correct": false}]', 'It makes the competence boundary practical to hold.', 3),
  (6, 'Continuing professional development in coaching should be driven by:', '[{"id": "a", "text": "Accreditation minimums", "is_correct": false}, {"id": "b", "text": "Patterns identified in supervision and client feedback", "is_correct": true}, {"id": "c", "text": "Market trends", "is_correct": false}, {"id": "d", "text": "Peer recommendation", "is_correct": false}]', 'Evidence from your own practice targets development where it is needed.', 4)
) AS v(week_number, question_text, options, explanation, sort_order)
  ON v.week_number = tw.week_number
WHERE p.name = 'TASC Essential' AND a.assignment_type = 'quiz';

-- The open-ended reflection prompt for each week.
INSERT INTO public.programme_reflections
  (programme_id, reflection_number, title, instructions, appears_at_week, is_visible)
SELECT p.id, v.n, v.title, v.instructions, v.n, true
FROM public.programmes p CROSS JOIN (VALUES
  (1, 'Week 1 reflection', 'What did you assume about your client''s goal that turned out to be your own?'),
  (2, 'Week 2 reflection', 'Which GROW stage do you personally find hardest to stay in, and why?'),
  (3, 'Week 3 reflection', 'What question do you avoid asking your clients, and what are you protecting?'),
  (4, 'Week 4 reflection', 'When you listen, whose agenda is actually in the room?'),
  (5, 'Week 5 reflection', 'Where are your own boundaries least clear, and who would be harmed by that?'),
  (6, 'Week 6 reflection', 'What in your practice are you avoiding looking at, and what would supervision surface?')
) AS v(n, title, instructions)
WHERE p.name = 'TASC Essential';

INSERT INTO public.reflection_questions
  (reflection_id, question_text, question_type, is_required, sort_order)
SELECT r.id, v.question_text, v.question_type, true, v.sort_order
FROM public.programme_reflections r
JOIN public.programmes p ON p.id = r.programme_id
JOIN (VALUES
  (1, 'What did you assume about your client''s goal that turned out to be your own?', 'open_text', 1),
  (1, 'How confident do you feel applying this over the next two weeks?', 'scale_1_10', 2),
  (2, 'Which GROW stage do you personally find hardest to stay in, and why?', 'open_text', 1),
  (2, 'How confident do you feel applying this over the next two weeks?', 'scale_1_10', 2),
  (3, 'What question do you avoid asking your clients, and what are you protecting?', 'open_text', 1),
  (3, 'How confident do you feel applying this over the next two weeks?', 'scale_1_10', 2),
  (4, 'When you listen, whose agenda is actually in the room?', 'open_text', 1),
  (4, 'How confident do you feel applying this over the next two weeks?', 'scale_1_10', 2),
  (5, 'Where are your own boundaries least clear, and who would be harmed by that?', 'open_text', 1),
  (5, 'How confident do you feel applying this over the next two weeks?', 'scale_1_10', 2),
  (6, 'What in your practice are you avoiding looking at, and what would supervision surface?', 'open_text', 1),
  (6, 'How confident do you feel applying this over the next two weeks?', 'scale_1_10', 2)
) AS v(n, question_text, question_type, sort_order) ON v.n = r.reflection_number
WHERE p.name = 'TASC Essential';

-- Daily prompts. The table hangs each prompt off a training week.
INSERT INTO public.daily_prompts (training_week_id, day_offset, prompt_text, is_visible, sort_order)
SELECT tw.id, v.day_offset, v.prompt_text, true, v.day_offset
FROM public.training_weeks tw
JOIN public.programmes p ON p.id = tw.programme_id
JOIN (VALUES
  (1, 1, 'What question did you ask today that you were genuinely curious about?'),
  (2, 2, 'Where did you give advice when a question would have served better?'),
  (3, 3, 'What did a client say today that you nearly missed?'),
  (4, 4, 'Which of your own reactions got in the way of listening this week?')
) AS v(week_number, day_offset, prompt_text) ON v.week_number = tw.week_number
WHERE p.name = 'TASC Essential';

-- ===========================================================================
-- Pacing: put the later weeks of each ONGOING cohort in the future
-- ===========================================================================
-- Without this every week of an in-flight cohort is already due, and an
-- "on track" learner is indistinguishable from one who is behind. Cohort A
-- has finished, so it keeps its natural (all past) schedule.
INSERT INTO public.cohort_week_overrides (cohort_id, training_week_id, unlock_date, is_visible)
SELECT c.id, tw.id,
  CASE WHEN tw.week_number <= v.past_through
       THEN current_date - ((v.past_through - tw.week_number + 1) * 12)
       ELSE current_date + ((tw.week_number - v.past_through) * 14)
  END,
  true
FROM public.cohorts c
JOIN public.training_weeks tw ON tw.programme_id = c.programme_id
JOIN (VALUES
  ('Emerging Leaders · Cohort B', 5),
  ('Executive Excellence · Cohort C', 6),
  ('TASC Essential · Cohort D', 4)
) AS v(cohort_name, past_through) ON v.cohort_name = c.name
ON CONFLICT (cohort_id, training_week_id) DO UPDATE
  SET unlock_date = EXCLUDED.unlock_date, is_visible = true;

-- ===========================================================================
-- Learner training progress
-- ===========================================================================
-- Enrollments are resolved by the learner's e-mail and their cohort's name --
-- never by a hard-coded id -- so this stays correct if the demo seed is
-- re-applied with fresh uuids.
--
-- weeks_done per learner mirrors the state the demo seed already produced for
-- Coaching, Mentoring, Peer and Triads.
CREATE TEMP TABLE _tp (email text, cohort_name text, weeks_done integer) ON COMMIT DROP;
INSERT INTO _tp VALUES
  -- Cohort A finished: everyone completed everything.
  ('learner1@clariva.demo', 'Emerging Leaders · Cohort A (completed)', 8),
  ('alum1@clariva.demo',    'Emerging Leaders · Cohort A (completed)', 8),
  ('alum2@clariva.demo',    'Emerging Leaders · Cohort A (completed)', 8),
  ('alum3@clariva.demo',    'Emerging Leaders · Cohort A (completed)', 8),
  ('alum4@clariva.demo',    'Emerging Leaders · Cohort A (completed)', 8),
  -- Cohort B, Org A: complete / mid / behind. Org B: just started (Ana Silva) / mid / partial.
  ('learner1@clariva.demo', 'Emerging Leaders · Cohort B', 5),
  ('learner2@clariva.demo', 'Emerging Leaders · Cohort B', 5),
  ('learner3@clariva.demo', 'Emerging Leaders · Cohort B', 2),
  ('learner4@clariva.demo', 'Emerging Leaders · Cohort B', 0),
  ('learner5@clariva.demo', 'Emerging Leaders · Cohort B', 5),
  ('learner6@clariva.demo', 'Emerging Leaders · Cohort B', 2),
  -- Cohort C.
  ('learner9@clariva.demo',  'Executive Excellence · Cohort C', 6),
  ('learner11@clariva.demo', 'Executive Excellence · Cohort C', 6),
  ('learner7@clariva.demo',  'Executive Excellence · Cohort C', 2),
  ('learner8@clariva.demo',  'Executive Excellence · Cohort C', 0),
  ('learner10@clariva.demo', 'Executive Excellence · Cohort C', 0),
  -- Cohort D.
  ('tasc1@clariva.demo', 'TASC Essential · Cohort D', 4),
  ('tasc2@clariva.demo', 'TASC Essential · Cohort D', 4),
  ('tasc3@clariva.demo', 'TASC Essential · Cohort D', 1),
  ('tasc4@clariva.demo', 'TASC Essential · Cohort D', 0),
  ('tasc5@clariva.demo', 'TASC Essential · Cohort D', 0);

CREATE TEMP TABLE _tp_enr ON COMMIT DROP AS
SELECT t.weeks_done, e.id AS enrollment_id, e.user_id, e.programme_id, e.cohort_id, pr.email
FROM _tp t
JOIN public.profiles pr ON pr.email = t.email
JOIN public.cohorts c ON c.name = t.cohort_name
JOIN public.programme_enrollments e ON e.user_id = pr.id AND e.cohort_id = c.id;

DO $check$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM _tp_enr;
  IF n <> (SELECT count(*) FROM _tp) THEN
    RAISE EXCEPTION 'Training seed: resolved % of % enrollments -- the demo seed shape has changed',
      n, (SELECT count(*) FROM _tp);
  END IF;
END
$check$;

-- Each completed week is finished on its own cohort requirement date (the
-- Training requirement Admin configures), never after today -- so a finished
-- cohort's history sits inside the cohort and its checkpoints read complete,
-- and a learner who is ahead finished future weeks early.
CREATE TEMP TABLE _tp_week ON COMMIT DROP AS
SELECT te.enrollment_id, te.user_id, tw.id AS training_week_id, tw.week_number,
  least(d.due_on::timestamptz + interval '9 hours',
        now() - interval '1 day' - make_interval(hours => 8 - tw.week_number)) AS done_at
FROM _tp_enr te
JOIN public.training_weeks tw ON tw.programme_id = te.programme_id AND tw.week_number <= te.weeks_done
JOIN public.cohort_requirement_dates d
  ON d.cohort_id = te.cohort_id AND d.programme_id = te.programme_id
 AND d.module = 'training' AND d.training_week_id = tw.id;

-- Skill cards: THE canonical training unit.
INSERT INTO public.training_progress (user_id, enrollment_id, training_week_id, viewed_at, completed_at)
SELECT w.user_id, w.enrollment_id, w.training_week_id, w.done_at - interval '2 days', w.done_at
FROM _tp_week w
ON CONFLICT DO NOTHING;

-- Quiz submissions for the weeks each learner completed. Scores vary by
-- learner so the Admin engagement view has a real distribution.
INSERT INTO public.assignment_submissions
  (assignment_id, user_id, enrollment_id, answers, score_pct, correct_count, total_count, submitted_at)
SELECT a.id, te.user_id, te.enrollment_id,
  (SELECT jsonb_object_agg(qq.id::text, (qq.options->0->>'id'))
     FROM public.quiz_questions qq WHERE qq.assignment_id = a.id),
  sc.pct, round(sc.pct * 4 / 100.0)::integer, 4,
  w.done_at + interval '1 hour'
FROM _tp_enr te
JOIN public.training_weeks tw ON tw.programme_id = te.programme_id AND tw.week_number <= te.weeks_done
JOIN _tp_week w ON w.enrollment_id = te.enrollment_id AND w.training_week_id = tw.id
JOIN public.assignments a ON a.training_week_id = tw.id AND a.assignment_type = 'quiz'
CROSS JOIN LATERAL (SELECT (75 + ((('x' || substr(md5(te.user_id::text || tw.id::text), 1, 8))::bit(32)::bigint) % 26))::numeric AS pct) sc
ON CONFLICT DO NOTHING;

-- Practical exercises (reflection-type assignments).
INSERT INTO public.assignment_submissions
  (assignment_id, user_id, enrollment_id, answers, reflection_text, submitted_at)
SELECT a.id, te.user_id, te.enrollment_id, '{}'::jsonb,
  'Completed the exercise for ' || tw.title || '. The hardest part was staying with the '
    || 'practice when the week got busy; the pattern I noticed is worth bringing to my next session.',
  w.done_at + interval '2 hours'
FROM _tp_enr te
JOIN public.training_weeks tw ON tw.programme_id = te.programme_id AND tw.week_number <= te.weeks_done
JOIN _tp_week w ON w.enrollment_id = te.enrollment_id AND w.training_week_id = tw.id
JOIN public.assignments a ON a.training_week_id = tw.id AND a.assignment_type = 'reflection'
ON CONFLICT DO NOTHING;

-- Programme reflections, with a confidence score and both answers.
INSERT INTO public.reflection_submissions (reflection_id, user_id, enrollment_id, confidence_score, submitted_at)
SELECT r.id, te.user_id, te.enrollment_id,
  6 + ((('x' || substr(md5(te.user_id::text || r.id::text), 1, 8))::bit(32)::bigint) % 4)::smallint,
  w.done_at + interval '3 hours'
FROM _tp_enr te
JOIN public.programme_reflections r ON r.programme_id = te.programme_id
JOIN _tp_week w ON w.enrollment_id = te.enrollment_id AND w.week_number = r.appears_at_week
WHERE r.reflection_number <= te.weeks_done
ON CONFLICT DO NOTHING;

INSERT INTO public.reflection_answers (submission_id, question_id, answer_text, answer_value)
SELECT s.id, rq.id,
  CASE WHEN rq.question_type = 'open_text'
       THEN 'Writing this down changed what I thought the answer was. The honest version is less '
            || 'flattering than my first draft, and more useful.'
       ELSE NULL END,
  CASE WHEN rq.question_type = 'scale_1_10' THEN s.confidence_score ELSE NULL END
FROM public.reflection_submissions s
JOIN public.reflection_questions rq ON rq.reflection_id = s.reflection_id
WHERE s.enrollment_id IN (SELECT enrollment_id FROM _tp_enr)
ON CONFLICT DO NOTHING;

-- Daily prompts answered for every week the learner completed, on the
-- prompt's own day of that week. Private text: learner-only, never Sponsor.
INSERT INTO public.daily_prompt_responses
  (daily_prompt_id, user_id, enrollment_id, opened_at, response_text, confidence_score, responded_at)
SELECT dp.id, w.user_id, w.enrollment_id,
  least(w.done_at - interval '2 days' + make_interval(days => coalesce(dp.day_offset, 1) - 1), now() - interval '5 hours'),
  'Noted it in the moment rather than afterwards, which is new for me.',
  7, least(w.done_at - interval '2 days' + make_interval(days => coalesce(dp.day_offset, 1) - 1) + interval '4 hours',
           now() - interval '1 hour')
FROM _tp_week w
JOIN public.daily_prompts dp ON dp.training_week_id = w.training_week_id AND dp.is_visible
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- VERIFICATION -- Training must now be a real canonical module
-- ===========================================================================
DO $verify$
DECLARE bad text; n integer;
BEGIN
  -- 1. Every enrollment sees a Training requirement equal to its week count.
  SELECT string_agg(format('%s: required=%s expected=%s', x.email, x.required_units, x.weeks), '; ')
    INTO bad
  FROM (
    SELECT te.email, p.required_units,
           (SELECT count(*) FROM public.training_weeks tw WHERE tw.programme_id = te.programme_id) AS weeks
    FROM _tp_enr te
    CROSS JOIN LATERAL public.canonical_module_progress(te.enrollment_id, current_date) p
    WHERE p.module = 'training'
  ) x WHERE x.required_units <> x.weeks;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY 1 FAILED: Training required_units wrong for %', bad;
  END IF;

  -- 2. Complete learners: Training completed = required.
  SELECT string_agg(format('%s %s/%s', x.email, x.completed_units, x.required_units), '; ') INTO bad
  FROM (
    SELECT te.email, p.completed_units, p.required_units
    FROM _tp_enr te
    CROSS JOIN LATERAL public.canonical_module_progress(te.enrollment_id, current_date) p
    WHERE p.module = 'training'
      AND te.weeks_done = (SELECT count(*) FROM public.training_weeks tw WHERE tw.programme_id = te.programme_id)
  ) x WHERE x.completed_units <> x.required_units;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY 2 FAILED: complete learners are not complete in Training: %', bad;
  END IF;

  -- 3. Just-started learners: no Training progress at all.
  SELECT string_agg(format('%s = %s', x.email, x.completed_units), '; ') INTO bad
  FROM (
    SELECT te.email, p.completed_units
    FROM _tp_enr te
    CROSS JOIN LATERAL public.canonical_module_progress(te.enrollment_id, current_date) p
    WHERE p.module = 'training' AND te.weeks_done = 0
  ) x WHERE x.completed_units <> 0;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY 3 FAILED: a just-started learner has Training progress: %', bad;
  END IF;

  SELECT count(*) INTO n FROM public.training_progress tp
  JOIN _tp_enr te ON te.enrollment_id = tp.enrollment_id
  WHERE te.weeks_done = 0;
  IF n > 0 THEN
    RAISE EXCEPTION 'VERIFY 3 FAILED: % training_progress rows exist for just-started learners', n;
  END IF;

  -- 4. On-track learners have nothing overdue; behind learners do. This is
  --    what the cohort_week_overrides pacing above exists to produce.
  SELECT string_agg(format('%s overdue=%s', x.email, x.overdue_units), '; ') INTO bad
  FROM (
    SELECT te.email, p.overdue_units
    FROM _tp_enr te
    CROSS JOIN LATERAL public.canonical_module_progress(te.enrollment_id, current_date) p
    WHERE p.module = 'training'
      AND te.email IN ('learner2@clariva.demo', 'learner5@clariva.demo', 'learner11@clariva.demo', 'tasc2@clariva.demo')
  ) x WHERE x.overdue_units <> 0;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY 4 FAILED: an on-track learner has overdue Training: %', bad;
  END IF;

  SELECT string_agg(format('%s overdue=%s', x.email, x.overdue_units), '; ') INTO bad
  FROM (
    SELECT te.email, p.overdue_units
    FROM _tp_enr te
    CROSS JOIN LATERAL public.canonical_module_progress(te.enrollment_id, current_date) p
    WHERE p.module = 'training'
      AND te.email IN ('learner3@clariva.demo', 'learner6@clariva.demo', 'learner7@clariva.demo')
  ) x WHERE x.overdue_units = 0;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY 4 FAILED: a behind learner has no overdue Training: %', bad;
  END IF;

  -- 5. Content is complete: 4 questions on every quiz, both assignment kinds
  --    on every week, a reflection prompt per week.
  SELECT string_agg(format('%s wk%s has %s questions', p.name, tw.week_number, x.n), '; ') INTO bad
  FROM public.assignments a
  JOIN public.training_weeks tw ON tw.id = a.training_week_id
  JOIN public.programmes p ON p.id = tw.programme_id
  CROSS JOIN LATERAL (SELECT count(*) AS n FROM public.quiz_questions qq WHERE qq.assignment_id = a.id) x
  WHERE a.assignment_type = 'quiz' AND x.n <> 4;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY 5 FAILED: quiz question count wrong: %', bad;
  END IF;

  SELECT string_agg(format('%s wk%s', p.name, tw.week_number), '; ') INTO bad
  FROM public.training_weeks tw
  JOIN public.programmes p ON p.id = tw.programme_id
  WHERE (SELECT count(*) FROM public.assignments a WHERE a.training_week_id = tw.id) <> 2
     OR tw.skill_card_html IS NULL;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY 5 FAILED: week missing a skill card or an assignment: %', bad;
  END IF;

  -- 6. Every quiz question has exactly one correct option.
  SELECT count(*) INTO n FROM public.quiz_questions qq
  WHERE (SELECT count(*) FROM jsonb_array_elements(qq.options) o
          WHERE (o->>'is_correct')::boolean) <> 1;
  IF n > 0 THEN
    RAISE EXCEPTION 'VERIFY 6 FAILED: % quiz questions do not have exactly one correct option', n;
  END IF;

  -- 7. The rest of the demo is untouched: the canonical invariant still holds.
  SELECT count(*) INTO n FROM public.cohort_schedule_violations() WHERE violation <> 'missing_deadline';
  IF n > 0 THEN
    RAISE EXCEPTION 'VERIFY 7 FAILED: % cohort modules now violate the quantity invariant', n;
  END IF;

  -- 8. The headline numbers, read from the canonical engine the dashboard,
  --    Admin and Sponsor all use, must equal the canonical requirement
  --    calendar -- never a constant. learner1 is 100% complete with nothing
  --    overdue; learner4 (Ana Silva) has completed nothing, so her overdue
  --    count is exactly the number of requirements already due, and fewer
  --    than all 18 are due (some units lie in the future). "Needs your
  --    attention" sums to the same number.
  SELECT string_agg(format('%s: %s%% / %s of %s done / due %s (calendar %s) / overdue %s (calendar %s) / attention %s',
           pr.email, round(cp.full_completion_pct), cp.completed_units, cp.required_units,
           cp.due_units, cal.due, cp.overdue_units, cal.overdue, att.total), '; ') INTO bad
  FROM public.programme_enrollments e
  JOIN public.profiles pr ON pr.id = e.user_id
  JOIN public.cohorts c ON c.id = e.cohort_id
  CROSS JOIN LATERAL public.canonical_enrollment_progress(e.id, current_date) cp
  CROSS JOIN LATERAL (SELECT count(*) FILTER (WHERE k.is_due_as_of) AS due,
                             count(*) FILTER (WHERE k.is_overdue) AS overdue,
                             count(*) AS required
                      FROM public.canonical_enrollment_requirement_calendar(e.id, current_date) k) cal
  CROSS JOIN LATERAL (SELECT coalesce(sum(o.overdue_units), 0) AS total
                      FROM public.canonical_overdue_items(e.id, current_date) o) att
  WHERE c.name = 'Emerging Leaders · Cohort B'
    AND ((pr.email = 'learner1@clariva.demo' AND (cp.full_completion_pct <> 100 OR cp.overdue_units <> 0))
      OR (pr.email = 'learner4@clariva.demo' AND (cp.completed_units <> 0 OR cp.overdue_units <> cp.due_units
                                                 OR cp.due_units = 0 OR cp.due_units >= cp.required_units))
      OR cp.due_units <> cal.due OR cp.overdue_units <> cal.overdue OR cp.required_units <> cal.required
      OR att.total <> cp.overdue_units);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY 8 FAILED: Cohort B headline numbers: %', bad;
  END IF;
  RAISE NOTICE 'Training content verification passed.';
END
$verify$;

-- ===========================================================================
-- Summary
-- ===========================================================================
DO $summary$
DECLARE r record;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '== TRAINING (canonical_module_progress, module = training) ==';
  RAISE NOTICE '%', rpad('learner',24)||rpad('cohort',34)||lpad('req',4)||lpad('done',6)||lpad('due',5)||lpad('over',6)||'  status';
  FOR r IN
    SELECT pr.full_name, c.name AS cohort, p.required_units, p.completed_units,
           p.due_units, p.overdue_units, p.pace_status
    FROM _tp_enr te
    JOIN public.profiles pr ON pr.id = te.user_id
    JOIN public.cohorts c ON c.id = te.cohort_id
    CROSS JOIN LATERAL public.canonical_module_progress(te.enrollment_id, current_date) p
    WHERE p.module = 'training'
    ORDER BY c.name, pr.full_name
  LOOP
    RAISE NOTICE '%', rpad(substr(r.full_name,1,23),24)||rpad(substr(r.cohort,1,33),34)
                 ||lpad(r.required_units::text,4)||lpad(r.completed_units::text,6)
                 ||lpad(r.due_units::text,5)||lpad(r.overdue_units::text,6)||'  '||r.pace_status;
  END LOOP;
  RAISE NOTICE '';
  FOR r IN
    SELECT p.name, count(DISTINCT tw.id) weeks,
           count(DISTINCT a.id) FILTER (WHERE a.assignment_type='quiz') quizzes,
           count(DISTINCT qq.id) questions,
           count(DISTINCT a2.id) FILTER (WHERE a2.assignment_type='reflection') exercises,
           count(DISTINCT dp.id) prompts
    FROM public.programmes p
    JOIN public.training_weeks tw ON tw.programme_id = p.id
    LEFT JOIN public.assignments a  ON a.training_week_id = tw.id
    LEFT JOIN public.assignments a2 ON a2.training_week_id = tw.id
    LEFT JOIN public.quiz_questions qq ON qq.assignment_id = a.id
    LEFT JOIN public.daily_prompts dp ON dp.training_week_id = tw.id
    GROUP BY p.name ORDER BY p.name
  LOOP
    RAISE NOTICE '% : % weeks, % quizzes (% questions), % exercises, % daily prompts',
      rpad(r.name,22), r.weeks, r.quizzes, r.questions, r.exercises, r.prompts;
  END LOOP;
END
$summary$;

COMMIT;

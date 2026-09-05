-- For each existing assignment with assignment_type='reflection' that has
-- submissions, we need to migrate the data. This is a best-effort migration
-- — old reflections had a single text field, so we create a programme_reflection
-- with one open_text question per old assignment, and convert each
-- assignment_submission into a reflection_submission + reflection_answer.

DO $$
DECLARE
  _a RECORD;
  _new_reflection_id UUID;
  _new_question_id UUID;
  _s RECORD;
  _new_submission_id UUID;
BEGIN
  FOR _a IN
    SELECT a.id, a.training_week_id, a.title, a.title_vi,
           a.instructions, a.instructions_vi,
           tw.programme_id, tw.week_number
    FROM public.assignments a
    JOIN public.training_weeks tw ON tw.id = a.training_week_id
    WHERE a.assignment_type = 'reflection'
  LOOP
    _new_reflection_id := gen_random_uuid();
    _new_question_id := gen_random_uuid();

    INSERT INTO public.programme_reflections
      (id, programme_id, reflection_number, title, title_vi,
       instructions, instructions_vi, appears_at_week, is_visible)
    VALUES
      (_new_reflection_id, _a.programme_id, _a.week_number,
       _a.title, _a.title_vi, _a.instructions, _a.instructions_vi,
       _a.week_number, true)
    ON CONFLICT (programme_id, reflection_number) DO NOTHING;

    -- If ON CONFLICT hit, look up the existing id
    SELECT id INTO _new_reflection_id FROM public.programme_reflections
    WHERE programme_id = _a.programme_id AND reflection_number = _a.week_number;

    INSERT INTO public.reflection_questions
      (id, reflection_id, question_text, question_text_vi,
       question_type, is_required, sort_order)
    VALUES
      (_new_question_id, _new_reflection_id, _a.title, _a.title_vi,
       'open_text', true, 0)
    ON CONFLICT DO NOTHING;

    -- Look up the question id
    SELECT id INTO _new_question_id FROM public.reflection_questions
    WHERE reflection_id = _new_reflection_id LIMIT 1;

    FOR _s IN
      SELECT user_id, reflection_text, submitted_at
      FROM public.assignment_submissions
      WHERE assignment_id = _a.id AND reflection_text IS NOT NULL
    LOOP
      _new_submission_id := gen_random_uuid();

      INSERT INTO public.reflection_submissions
        (id, reflection_id, user_id, confidence_score, submitted_at)
      VALUES
        (_new_submission_id, _new_reflection_id, _s.user_id, 5, _s.submitted_at)
      ON CONFLICT (reflection_id, user_id) DO NOTHING;

      SELECT id INTO _new_submission_id FROM public.reflection_submissions
      WHERE reflection_id = _new_reflection_id AND user_id = _s.user_id;

      INSERT INTO public.reflection_answers
        (submission_id, question_id, answer_text)
      VALUES (_new_submission_id, _new_question_id, _s.reflection_text)
      ON CONFLICT (submission_id, question_id) DO NOTHING;
    END LOOP;
  END LOOP;
END;
$$;

-- Reflections now live in programme_reflections (above) — hide the old
-- assignment_type='reflection' rows rather than deleting them (quizzes still
-- use the assignments table, so it isn't dropped).
UPDATE public.assignments SET is_visible = false WHERE assignment_type = 'reflection';

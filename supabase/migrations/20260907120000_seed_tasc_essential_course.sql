-- Seed data for "TASC - Essential Course": a 4-week Erickson Solution-Focused
-- Coaching programme, plus full session/feedback test data for
-- trang.tt@hsp.consulting. Content-only — does not create users.
--
-- MERGE-AWARE: this project already had a "TASC - Essential Course"
-- programme with placeholder/test content (created 2026-09-03) and real
-- active enrollments before this migration was written. Every container
-- row (programme, cohort, training weeks, quizzes, reflections, triad
-- rounds) is resolved by its natural key at runtime — reusing the existing
-- id and overwriting placeholder text with real content if a row already
-- exists, creating a fresh row only if it doesn't. Leaf/child content
-- (daily prompts, quiz questions, reflection questions) is deleted and
-- reinserted per parent so no placeholder rows linger alongside the real
-- ones. Idempotent: safe to re-run.

DO $tasc_seed$
DECLARE
  v_programme_id UUID;
  v_cohort_id UUID;
  v_week1_id UUID;
  v_week2_id UUID;
  v_week3_id UUID;
  v_week4_id UUID;
  v_quiz1_id UUID;
  v_quiz2_id UUID;
  v_quiz3_id UUID;
  v_quiz4_id UUID;
  v_reflection1_id UUID;
  v_reflection2_id UUID;
  v_round1_id UUID;
  v_round2_id UUID;
  v_trang_id UUID;
  v_coach1_id UUID;
  v_coach2_id UUID;
  v_peer1_id UUID;
  v_peer2_id UUID;
  v_enrollment_id UUID;
BEGIN
  -- 1. Programme (resolve by name; update in place if it already exists)
  INSERT INTO public.programmes (id, name, description, duration_months, color, is_active, coachee_session_limit, coach_session_limit, peer_session_limit, peer_given_limit, mentoring_received_limit)
  VALUES (
    gen_random_uuid(), 'TASC - Essential Course',
    'A 4-week intensive foundation in Solution-Focused Coaching based on the Erickson methodology. Participants learn the coaching mindset, powerful questioning techniques, the SHIFT model, and how to build sustainable client outcomes. Designed for aspiring coaches and leaders who want ICF-aligned coaching skills.',
    1, '#2c8fa8', true, 4, 4, 2, 2, 2
  )
  ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description, duration_months = EXCLUDED.duration_months, color = EXCLUDED.color,
    is_active = EXCLUDED.is_active, coachee_session_limit = EXCLUDED.coachee_session_limit,
    coach_session_limit = EXCLUDED.coach_session_limit, peer_session_limit = EXCLUDED.peer_session_limit,
    peer_given_limit = EXCLUDED.peer_given_limit, mentoring_received_limit = EXCLUDED.mentoring_received_limit
  RETURNING id INTO v_programme_id;

  -- 2. Programme modules
  INSERT INTO public.programme_modules (programme_id, module, enabled, config)
  VALUES (v_programme_id, 'coaching', true, '{"give":false,"receive":true,"give_limit":null,"receive_limit":4,"session_length_minutes":60}'::jsonb)
  ON CONFLICT (programme_id, module) DO UPDATE SET enabled = true, config = EXCLUDED.config;
  INSERT INTO public.programme_modules (programme_id, module, enabled, config)
  VALUES (v_programme_id, 'peer_coaching', true, '{"monthly_limit":2}'::jsonb)
  ON CONFLICT (programme_id, module) DO UPDATE SET enabled = true, config = EXCLUDED.config;
  INSERT INTO public.programme_modules (programme_id, module, enabled, config)
  VALUES (v_programme_id, 'mentoring', true, '{"give":true,"receive":true,"receive_limit":2,"give_limit":4}'::jsonb)
  ON CONFLICT (programme_id, module) DO UPDATE SET enabled = true, config = EXCLUDED.config;
  INSERT INTO public.programme_modules (programme_id, module, enabled, config)
  VALUES (v_programme_id, 'triads', true, '{}'::jsonb)
  ON CONFLICT (programme_id, module) DO UPDATE SET enabled = true, config = EXCLUDED.config;
  INSERT INTO public.programme_modules (programme_id, module, enabled, config)
  VALUES (v_programme_id, 'training', true, '{}'::jsonb)
  ON CONFLICT (programme_id, module) DO UPDATE SET enabled = true, config = EXCLUDED.config;
  INSERT INTO public.programme_modules (programme_id, module, enabled, config)
  VALUES (v_programme_id, 'quiz', true, '{}'::jsonb)
  ON CONFLICT (programme_id, module) DO UPDATE SET enabled = true, config = EXCLUDED.config;
  INSERT INTO public.programme_modules (programme_id, module, enabled, config)
  VALUES (v_programme_id, 'assessment', true, '{}'::jsonb)
  ON CONFLICT (programme_id, module) DO UPDATE SET enabled = true, config = EXCLUDED.config;
  INSERT INTO public.programme_modules (programme_id, module, enabled, config)
  VALUES (v_programme_id, 'daily_prompt', true, '{}'::jsonb)
  ON CONFLICT (programme_id, module) DO UPDATE SET enabled = true, config = EXCLUDED.config;

  -- 3. Cohort (resolve by name within this programme)
  SELECT id INTO v_cohort_id FROM public.cohorts WHERE programme_id = v_programme_id AND name = 'TASC Essential — Cohort 1 (Sep 2026)' LIMIT 1;
  IF v_cohort_id IS NULL THEN
    INSERT INTO public.cohorts (id, name, programme_id, description, start_date, end_date, color)
    VALUES ('a0000000-0000-0000-0000-000000000002', 'TASC Essential — Cohort 1 (Sep 2026)', v_programme_id, 'First pilot cohort for the TASC Essential Course. 12 participants from banking and finance sector.', '2026-09-08'::date, '2026-10-06'::date, '#2c8fa8')
    RETURNING id INTO v_cohort_id;
  ELSE
    UPDATE public.cohorts SET description = 'First pilot cohort for the TASC Essential Course. 12 participants from banking and finance sector.', start_date = '2026-09-08'::date, end_date = '2026-10-06'::date, color = '#2c8fa8' WHERE id = v_cohort_id;
  END IF;

  -- ---- Week 1: The Coaching Mindset ----
  INSERT INTO public.training_weeks (
    id, programme_id, week_number, sort_order, title, title_vi, subtitle, subtitle_vi,
    is_visible, skill_card_visible, unlock_date, video_url,
    pdf_storage_path, pdf_storage_path_vi, skill_card_html, skill_card_html_vi
  ) VALUES (
    'b0000000-0000-0000-0000-000000000001', v_programme_id, 1, 1,
    'The Coaching Mindset', 'Tư duy Coaching', 'Foundations of Solution-Focused Coaching & the Erickson Approach', 'Nền tảng Coaching tập trung giải pháp & Phương pháp Erickson',
    true, true, '2026-09-08'::date, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'tasc-essential/week-1-coaching-mindset-en.pdf', 'tasc-essential/week-1-coaching-mindset-vi.pdf', '<div class="skill-card"><h2>The Coaching Mindset</h2><p>Coaching is a partnership, not instruction. In the Erickson approach, we believe that every person is naturally creative, resourceful, and whole. The coach''s role is to hold space for insight — not to diagnose, advise, or fix.</p><h3>Key Principles This Week</h3><ul><li><strong>Solution-focused vs. problem-focused</strong>: Instead of "What''s wrong?", ask "What do you want instead?"</li><li><strong>The person is not the problem</strong>: Separate identity from behaviour. Always assume positive intent.</li><li><strong>Future orientation</strong>: Energy follows attention. We coach toward what the client wants to create, not what they want to escape.</li><li><strong>Responsibility sits with the client</strong>: The coach does not own the client''s outcomes — the client does.</li></ul><h3>Erickson''s 5 Principles</h3><ol><li>People are OK as they are</li><li>People already have all the resources they need</li><li>People always make the best choice available to them</li><li>Every behaviour has a positive intention</li><li>Change is inevitable</li></ol><h3>Reflection Prompt</h3><p>Think of a recent conversation where you gave advice instead of asking questions. What might have happened if you had stayed curious instead?</p></div>', '<div class="skill-card"><h2>Tư duy Coaching</h2><p>Coaching là một mối quan hệ đối tác, không phải hướng dẫn. Trong phương pháp Erickson, chúng tôi tin rằng mỗi người đều sáng tạo, có đầy đủ nguồn lực và toàn vẹn. Vai trò của coach là giữ không gian cho sự khai sáng — không phải chẩn đoán, tư vấn hay sửa chữa.</p><h3>Nguyên tắc chính tuần này</h3><ul><li><strong>Tập trung giải pháp thay vì tập trung vấn đề</strong>: Thay vì "Có gì sai?", hãy hỏi "Bạn muốn điều gì thay thế?"</li><li><strong>Con người không phải là vấn đề</strong>: Tách biệt bản sắc khỏi hành vi. Luôn giả định ý định tích cực.</li><li><strong>Hướng về tương lai</strong>: Năng lượng đi theo sự chú ý. Chúng ta coach hướng đến những gì khách hàng muốn tạo ra.</li><li><strong>Trách nhiệm thuộc về khách hàng</strong>: Coach không sở hữu kết quả của khách hàng — khách hàng mới là người sở hữu.</li></ul><h3>5 Nguyên tắc Erickson</h3><ol><li>Mọi người đều ổn như họ đang là</li><li>Mọi người đã có đủ nguồn lực cần thiết</li><li>Mọi người luôn đưa ra lựa chọn tốt nhất có thể</li><li>Mọi hành vi đều có ý định tích cực</li><li>Thay đổi là điều tất yếu</li></ol><h3>Câu hỏi phản tư</h3><p>Hãy nghĩ về một cuộc trò chuyện gần đây mà bạn đã đưa ra lời khuyên thay vì đặt câu hỏi. Điều gì có thể xảy ra nếu bạn giữ được sự tò mò?</p></div>'
  )
  ON CONFLICT (programme_id, week_number) DO UPDATE SET
    sort_order = EXCLUDED.sort_order, title = EXCLUDED.title, title_vi = EXCLUDED.title_vi,
    subtitle = EXCLUDED.subtitle, subtitle_vi = EXCLUDED.subtitle_vi, is_visible = EXCLUDED.is_visible,
    skill_card_visible = EXCLUDED.skill_card_visible, unlock_date = EXCLUDED.unlock_date, video_url = EXCLUDED.video_url,
    pdf_storage_path = EXCLUDED.pdf_storage_path, pdf_storage_path_vi = EXCLUDED.pdf_storage_path_vi,
    skill_card_html = EXCLUDED.skill_card_html, skill_card_html_vi = EXCLUDED.skill_card_html_vi
  RETURNING id INTO v_week1_id;

  -- Replace any existing daily prompts for this week with the real ones
  DELETE FROM public.daily_prompts WHERE training_week_id = v_week1_id;
  INSERT INTO public.daily_prompts (id, training_week_id, day_offset, sort_order, is_visible, prompt_text, prompt_text_vi)
  VALUES ('c1000000-0000-0000-0000-000000000011', v_week1_id, 1, 1, true, 'Think of a conversation you had today. At what point did you shift from listening to advising? What would have happened if you had asked one more question instead?', 'Hãy nghĩ về một cuộc trò chuyện bạn đã có hôm nay. Tại thời điểm nào bạn chuyển từ lắng nghe sang đưa lời khuyên? Điều gì sẽ xảy ra nếu bạn đặt thêm một câu hỏi thay vì vậy?');
  INSERT INTO public.daily_prompts (id, training_week_id, day_offset, sort_order, is_visible, prompt_text, prompt_text_vi)
  VALUES ('c1000000-0000-0000-0000-000000000012', v_week1_id, 2, 2, true, 'Which of Erickson''s 5 principles feels most natural to you? Which one challenges you the most? Why?', 'Nguyên tắc nào trong 5 nguyên tắc Erickson cảm thấy tự nhiên nhất với bạn? Nguyên tắc nào thách thức bạn nhất? Tại sao?');
  INSERT INTO public.daily_prompts (id, training_week_id, day_offset, sort_order, is_visible, prompt_text, prompt_text_vi)
  VALUES ('c1000000-0000-0000-0000-000000000013', v_week1_id, 3, 3, true, 'Observe someone you admire in a meeting today. How do they create space for others to think? What specific behaviour do they use?', 'Quan sát một người bạn ngưỡng mộ trong cuộc họp hôm nay. Họ tạo không gian để người khác suy nghĩ như thế nào? Hành vi cụ thể nào họ sử dụng?');
  INSERT INTO public.daily_prompts (id, training_week_id, day_offset, sort_order, is_visible, prompt_text, prompt_text_vi)
  VALUES ('c1000000-0000-0000-0000-000000000014', v_week1_id, 4, 4, true, 'Notice one moment today where you assumed you knew what someone needed before they told you. What was the assumption? Was it accurate?', 'Nhận ra một khoảnh khắc hôm nay khi bạn giả định mình biết người khác cần gì trước khi họ nói. Giả định đó là gì? Nó có chính xác không?');
  INSERT INTO public.daily_prompts (id, training_week_id, day_offset, sort_order, is_visible, prompt_text, prompt_text_vi)
  VALUES ('c1000000-0000-0000-0000-000000000015', v_week1_id, 5, 5, true, 'If you could only ask questions (no statements, no advice) for one full hour tomorrow, what would be the hardest part? What might you discover?', 'Nếu bạn chỉ có thể đặt câu hỏi (không phát biểu, không lời khuyên) trong một giờ đầy đủ ngày mai, phần khó nhất sẽ là gì? Bạn có thể khám phá được gì?');

  -- Quiz for week 1: resolve the existing quiz-type assignment for this week, if any
  SELECT id INTO v_quiz1_id FROM public.assignments WHERE training_week_id = v_week1_id AND assignment_type = 'quiz' LIMIT 1;
  IF v_quiz1_id IS NULL THEN
    INSERT INTO public.assignments (id, training_week_id, assignment_type, title, title_vi, instructions, instructions_vi, is_visible, sort_order)
    VALUES ('c2000000-0000-0000-0000-000000000001', v_week1_id, 'quiz', 'Coaching Mindset Foundations', 'Nền tảng Tư duy Coaching', 'Test your understanding of the coaching mindset and Erickson''s foundational principles. You can take this quiz once.', 'Kiểm tra hiểu biết của bạn về tư duy coaching và các nguyên tắc nền tảng của Erickson. Bạn có thể làm bài kiểm tra này một lần.', true, 1)
    RETURNING id INTO v_quiz1_id;
  ELSE
    UPDATE public.assignments SET title = 'Coaching Mindset Foundations', title_vi = 'Nền tảng Tư duy Coaching', instructions = 'Test your understanding of the coaching mindset and Erickson''s foundational principles. You can take this quiz once.', instructions_vi = 'Kiểm tra hiểu biết của bạn về tư duy coaching và các nguyên tắc nền tảng của Erickson. Bạn có thể làm bài kiểm tra này một lần.', is_visible = true, sort_order = 1 WHERE id = v_quiz1_id;
  END IF;
  DELETE FROM public.quiz_questions WHERE assignment_id = v_quiz1_id;
  INSERT INTO public.quiz_questions (id, assignment_id, question_text, question_text_vi, options, explanation, explanation_vi, sort_order)
  VALUES ('c3100000-0000-0000-0000-000000000001', v_quiz1_id, 'According to Erickson''s principles, when a client makes a choice the coach disagrees with, the coach should:', 'Theo nguyên tắc Erickson, khi khách hàng đưa ra lựa chọn mà coach không đồng ý, coach nên:', '[{"id":"a","text":"Explain why the choice might not work","text_vi":"Giải thích tại sao lựa chọn đó có thể không hiệu quả","is_correct":false},{"id":"b","text":"Trust that the client is making the best choice available to them","text_vi":"Tin rằng khách hàng đang đưa ra lựa chọn tốt nhất có thể","is_correct":true},{"id":"c","text":"Offer a better alternative","text_vi":"Đề xuất một lựa chọn tốt hơn","is_correct":false},{"id":"d","text":"Remain silent and move on","text_vi":"Giữ im lặng và bỏ qua","is_correct":false}]'::jsonb, 'Erickson''s third principle states that people always make the best choice available to them. The coach''s role is to trust this while helping expand the range of choices available.', 'Nguyên tắc thứ ba của Erickson nói rằng mọi người luôn đưa ra lựa chọn tốt nhất có thể. Vai trò của coach là tin tưởng điều này trong khi giúp mở rộng phạm vi lựa chọn.', 1);
  INSERT INTO public.quiz_questions (id, assignment_id, question_text, question_text_vi, options, explanation, explanation_vi, sort_order)
  VALUES ('c3100000-0000-0000-0000-000000000002', v_quiz1_id, 'What is the fundamental difference between solution-focused and problem-focused coaching?', 'Sự khác biệt cơ bản giữa coaching tập trung giải pháp và coaching tập trung vấn đề là gì?', '[{"id":"a","text":"Solution-focused coaching ignores problems entirely","text_vi":"Coaching tập trung giải pháp bỏ qua hoàn toàn các vấn đề","is_correct":false},{"id":"b","text":"Problem-focused coaching is more thorough","text_vi":"Coaching tập trung vấn đề kỹ lưỡng hơn","is_correct":false},{"id":"c","text":"Solution-focused coaching directs energy toward what the client wants to create, not what they want to escape","text_vi":"Coaching tập trung giải pháp hướng năng lượng đến điều khách hàng muốn tạo ra, không phải điều họ muốn thoát khỏi","is_correct":true},{"id":"d","text":"There is no practical difference — both arrive at the same result","text_vi":"Không có sự khác biệt thực tế — cả hai đều đi đến cùng kết quả","is_correct":false}]'::jsonb, 'Solution-focused coaching is fundamentally about future orientation. Energy follows attention — by focusing on the desired state rather than analyzing the problem, clients generate more motivation and creative options.', 'Coaching tập trung giải pháp cơ bản là về hướng đến tương lai. Năng lượng đi theo sự chú ý — bằng cách tập trung vào trạng thái mong muốn thay vì phân tích vấn đề, khách hàng tạo ra nhiều động lực và lựa chọn sáng tạo hơn.', 2);
  INSERT INTO public.quiz_questions (id, assignment_id, question_text, question_text_vi, options, explanation, explanation_vi, sort_order)
  VALUES ('c3100000-0000-0000-0000-000000000003', v_quiz1_id, 'In the coaching relationship, who owns the client''s outcomes?', 'Trong mối quan hệ coaching, ai sở hữu kết quả của khách hàng?', '[{"id":"a","text":"The coach, because they guide the process","text_vi":"Coach, vì họ hướng dẫn quá trình","is_correct":false},{"id":"b","text":"The client","text_vi":"Khách hàng","is_correct":true},{"id":"c","text":"Both equally","text_vi":"Cả hai như nhau","is_correct":false},{"id":"d","text":"The organization sponsoring the coaching","text_vi":"Tổ chức tài trợ coaching","is_correct":false}]'::jsonb, 'A foundational principle: responsibility sits with the client. The coach holds the process, the client holds the outcomes. This prevents dependency and builds the client''s own resourcefulness.', 'Nguyên tắc nền tảng: trách nhiệm thuộc về khách hàng. Coach giữ quy trình, khách hàng giữ kết quả. Điều này ngăn ngừa sự phụ thuộc và xây dựng nguồn lực riêng của khách hàng.', 3);
  INSERT INTO public.quiz_questions (id, assignment_id, question_text, question_text_vi, options, explanation, explanation_vi, sort_order)
  VALUES ('c3100000-0000-0000-0000-000000000004', v_quiz1_id, 'Which of the following best describes the Erickson coaching approach?', 'Điều nào sau đây mô tả tốt nhất phương pháp coaching Erickson?', '[{"id":"a","text":"A diagnostic framework where the coach identifies what is wrong and prescribes a solution","text_vi":"Một khung chẩn đoán nơi coach xác định điều gì sai và kê đơn giải pháp","is_correct":false},{"id":"b","text":"A partnership where the coach holds space for insight, believing the client is creative, resourceful, and whole","text_vi":"Một mối quan hệ đối tác nơi coach giữ không gian cho sự khai sáng, tin rằng khách hàng sáng tạo, có nguồn lực và toàn vẹn","is_correct":true},{"id":"c","text":"A mentoring relationship where the more experienced person teaches the less experienced person","text_vi":"Một mối quan hệ mentoring nơi người có kinh nghiệm hơn dạy người ít kinh nghiệm hơn","is_correct":false},{"id":"d","text":"A therapeutic process focused on healing past wounds","text_vi":"Một quá trình trị liệu tập trung chữa lành vết thương quá khứ","is_correct":false}]'::jsonb, 'Coaching is distinct from advising, mentoring, and therapy. The Erickson model is built on the belief that clients are not broken — they are whole, creative, and resourceful. The coach''s job is to facilitate their own discovery.', 'Coaching khác biệt với tư vấn, mentoring và trị liệu. Mô hình Erickson được xây dựng trên niềm tin rằng khách hàng không bị hỏng — họ toàn vẹn, sáng tạo và có nguồn lực. Công việc của coach là hỗ trợ sự khám phá của chính họ.', 4);

  -- ---- Week 2: The Art of Powerful Questions ----
  INSERT INTO public.training_weeks (
    id, programme_id, week_number, sort_order, title, title_vi, subtitle, subtitle_vi,
    is_visible, skill_card_visible, unlock_date, video_url,
    pdf_storage_path, pdf_storage_path_vi, skill_card_html, skill_card_html_vi
  ) VALUES (
    'b0000000-0000-0000-0000-000000000002', v_programme_id, 2, 2,
    'The Art of Powerful Questions', 'Nghệ thuật Đặt câu hỏi Mạnh mẽ', 'Open questions, levels of listening, and creating awareness', 'Câu hỏi mở, các cấp độ lắng nghe, và tạo nhận thức',
    true, true, '2026-09-15'::date, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'tasc-essential/week-2-powerful-questions-en.pdf', 'tasc-essential/week-2-powerful-questions-vi.pdf', '<div class="skill-card"><h2>The Art of Powerful Questions</h2><p>A powerful question does three things: it shifts perspective, it generates energy, and it moves the client forward. In Erickson coaching, questions are the primary tool — not interpretation, not reframing, not advice.</p><h3>Three Levels of Listening</h3><ul><li><strong>Level 1 — Internal Listening</strong>: You hear the words but process them through your own filters. "That reminds me of when I…"</li><li><strong>Level 2 — Focused Listening</strong>: Full attention on the speaker. You notice tone, pace, energy shifts, and what is NOT said.</li><li><strong>Level 3 — Global Listening</strong>: You sense the whole environment — the emotion in the room, the unspoken dynamics, the energy between people.</li></ul><h3>Anatomy of a Powerful Question</h3><ul><li>Open-ended (starts with What, How, When — rarely Why)</li><li>Short (under 10 words is ideal)</li><li>Forward-looking ("What would success look like?")</li><li>Assumption-free (doesn''t embed the coach''s hypothesis)</li><li>Generates silence (the client needs to think, not just react)</li></ul><h3>Questions to Avoid</h3><ul><li>"Don''t you think you should…?" (leading)</li><li>"Why did you do that?" (judgmental)</li><li>"Have you tried X?" (advice in disguise)</li></ul><h3>Practice This Week</h3><p>In your next three conversations, replace every piece of advice with a genuine question. Notice what happens.</p></div>', '<div class="skill-card"><h2>Nghệ thuật Đặt câu hỏi Mạnh mẽ</h2><p>Một câu hỏi mạnh mẽ làm được ba điều: thay đổi góc nhìn, tạo năng lượng, và đưa khách hàng tiến về phía trước. Trong coaching Erickson, câu hỏi là công cụ chính — không phải diễn giải, không phải tái cấu trúc, không phải lời khuyên.</p><h3>Ba Cấp độ Lắng nghe</h3><ul><li><strong>Cấp độ 1 — Lắng nghe Nội tại</strong>: Bạn nghe từ ngữ nhưng xử lý qua bộ lọc của riêng mình. "Điều đó nhắc tôi nhớ đến khi tôi…"</li><li><strong>Cấp độ 2 — Lắng nghe Tập trung</strong>: Toàn bộ sự chú ý vào người nói. Bạn nhận ra giọng điệu, nhịp độ, sự thay đổi năng lượng, và những gì KHÔNG được nói.</li><li><strong>Cấp độ 3 — Lắng nghe Toàn cầu</strong>: Bạn cảm nhận toàn bộ môi trường — cảm xúc trong phòng, động lực ngầm, năng lượng giữa mọi người.</li></ul><h3>Giải phẫu Câu hỏi Mạnh mẽ</h3><ul><li>Mở (bắt đầu bằng Gì, Như thế nào, Khi nào — hiếm khi Tại sao)</li><li>Ngắn gọn (dưới 10 từ là lý tưởng)</li><li>Hướng về tương lai ("Thành công sẽ trông như thế nào?")</li><li>Không giả định (không chứa giả thuyết của coach)</li><li>Tạo sự im lặng (khách hàng cần suy nghĩ, không chỉ phản ứng)</li></ul><h3>Thực hành Tuần này</h3><p>Trong ba cuộc trò chuyện tiếp theo, hãy thay mỗi lời khuyên bằng một câu hỏi thực sự. Quan sát điều gì xảy ra.</p></div>'
  )
  ON CONFLICT (programme_id, week_number) DO UPDATE SET
    sort_order = EXCLUDED.sort_order, title = EXCLUDED.title, title_vi = EXCLUDED.title_vi,
    subtitle = EXCLUDED.subtitle, subtitle_vi = EXCLUDED.subtitle_vi, is_visible = EXCLUDED.is_visible,
    skill_card_visible = EXCLUDED.skill_card_visible, unlock_date = EXCLUDED.unlock_date, video_url = EXCLUDED.video_url,
    pdf_storage_path = EXCLUDED.pdf_storage_path, pdf_storage_path_vi = EXCLUDED.pdf_storage_path_vi,
    skill_card_html = EXCLUDED.skill_card_html, skill_card_html_vi = EXCLUDED.skill_card_html_vi
  RETURNING id INTO v_week2_id;

  -- Replace any existing daily prompts for this week with the real ones
  DELETE FROM public.daily_prompts WHERE training_week_id = v_week2_id;
  INSERT INTO public.daily_prompts (id, training_week_id, day_offset, sort_order, is_visible, prompt_text, prompt_text_vi)
  VALUES ('c1000000-0000-0000-0000-000000000021', v_week2_id, 1, 1, true, 'What question did someone ask you recently that made you stop and think? What made it powerful?', 'Câu hỏi nào ai đó đã hỏi bạn gần đây khiến bạn dừng lại và suy nghĩ? Điều gì làm nó mạnh mẽ?');
  INSERT INTO public.daily_prompts (id, training_week_id, day_offset, sort_order, is_visible, prompt_text, prompt_text_vi)
  VALUES ('c1000000-0000-0000-0000-000000000022', v_week2_id, 2, 2, true, 'Practice Level 2 listening in your next conversation. Afterward, write down what you noticed beyond the words — tone, pace, energy, pauses.', 'Thực hành Lắng nghe Cấp độ 2 trong cuộc trò chuyện tiếp theo. Sau đó, viết ra những gì bạn nhận thấy ngoài lời nói — giọng điệu, nhịp độ, năng lượng, khoảng dừng.');
  INSERT INTO public.daily_prompts (id, training_week_id, day_offset, sort_order, is_visible, prompt_text, prompt_text_vi)
  VALUES ('c1000000-0000-0000-0000-000000000023', v_week2_id, 3, 3, true, 'Write down three open-ended questions you could ask a colleague who is stuck on a problem — without embedding any advice in the question.', 'Viết ra ba câu hỏi mở bạn có thể hỏi một đồng nghiệp đang bế tắc với một vấn đề — mà không nhúng bất kỳ lời khuyên nào trong câu hỏi.');
  INSERT INTO public.daily_prompts (id, training_week_id, day_offset, sort_order, is_visible, prompt_text, prompt_text_vi)
  VALUES ('c1000000-0000-0000-0000-000000000024', v_week2_id, 4, 4, true, 'When someone shared a problem with you today, what was your first internal reaction — to solve, to empathize, or to ask? What does that tell you about your default mode?', 'Khi ai đó chia sẻ vấn đề với bạn hôm nay, phản ứng nội tại đầu tiên của bạn là gì — giải quyết, đồng cảm, hay hỏi? Điều đó nói gì về chế độ mặc định của bạn?');
  INSERT INTO public.daily_prompts (id, training_week_id, day_offset, sort_order, is_visible, prompt_text, prompt_text_vi)
  VALUES ('c1000000-0000-0000-0000-000000000025', v_week2_id, 5, 5, true, 'Reflect on your listening this week. On a scale of 1-10, how often did you truly listen at Level 2 or above? What got in the way?', 'Phản tư về việc lắng nghe của bạn tuần này. Trên thang 1-10, bạn thực sự lắng nghe ở Cấp độ 2 trở lên bao nhiêu lần? Điều gì đã cản trở?');

  -- Quiz for week 2: resolve the existing quiz-type assignment for this week, if any
  SELECT id INTO v_quiz2_id FROM public.assignments WHERE training_week_id = v_week2_id AND assignment_type = 'quiz' LIMIT 1;
  IF v_quiz2_id IS NULL THEN
    INSERT INTO public.assignments (id, training_week_id, assignment_type, title, title_vi, instructions, instructions_vi, is_visible, sort_order)
    VALUES ('c2000000-0000-0000-0000-000000000002', v_week2_id, 'quiz', 'Powerful Questions & Active Listening', 'Câu hỏi Mạnh mẽ & Lắng nghe Chủ động', 'Test your understanding of open questioning and the three levels of listening. You can take this quiz once.', 'Kiểm tra hiểu biết của bạn về đặt câu hỏi mở và ba cấp độ lắng nghe. Bạn có thể làm bài kiểm tra này một lần.', true, 1)
    RETURNING id INTO v_quiz2_id;
  ELSE
    UPDATE public.assignments SET title = 'Powerful Questions & Active Listening', title_vi = 'Câu hỏi Mạnh mẽ & Lắng nghe Chủ động', instructions = 'Test your understanding of open questioning and the three levels of listening. You can take this quiz once.', instructions_vi = 'Kiểm tra hiểu biết của bạn về đặt câu hỏi mở và ba cấp độ lắng nghe. Bạn có thể làm bài kiểm tra này một lần.', is_visible = true, sort_order = 1 WHERE id = v_quiz2_id;
  END IF;
  DELETE FROM public.quiz_questions WHERE assignment_id = v_quiz2_id;
  INSERT INTO public.quiz_questions (id, assignment_id, question_text, question_text_vi, options, explanation, explanation_vi, sort_order)
  VALUES ('c3200000-0000-0000-0000-000000000001', v_quiz2_id, 'Which of the following is a genuinely open, non-leading coaching question?', 'Câu hỏi nào sau đây là một câu hỏi coaching thực sự mở, không dẫn dắt?', '[{"id":"a","text":"Don''t you think you should talk to your manager about this?","text_vi":"Bạn không nghĩ là nên nói chuyện với quản lý của mình về việc này sao?","is_correct":false},{"id":"b","text":"What would it look like to resolve this in a way that works for everyone?","text_vi":"Việc giải quyết vấn đề này theo cách phù hợp với mọi người sẽ trông như thế nào?","is_correct":true},{"id":"c","text":"Have you tried just being more direct with your team?","text_vi":"Bạn đã thử trực tiếp hơn với nhóm của mình chưa?","is_correct":false},{"id":"d","text":"Isn''t it obvious that the deadline is the real issue here?","text_vi":"Chẳng phải rõ ràng là thời hạn mới là vấn đề thực sự ở đây sao?","is_correct":false}]'::jsonb, 'A genuinely open question carries no embedded suggestion or judgment. Options a, c, and d are all advice or opinion disguised as a question — a true open question invites the client to generate their own answer.', 'Một câu hỏi thực sự mở không chứa gợi ý hay phán xét ngầm. Các phương án a, c và d đều là lời khuyên hoặc ý kiến được ngụy trang thành câu hỏi — một câu hỏi mở thực sự mời khách hàng tự tạo ra câu trả lời của riêng họ.', 1);
  INSERT INTO public.quiz_questions (id, assignment_id, question_text, question_text_vi, options, explanation, explanation_vi, sort_order)
  VALUES ('c3200000-0000-0000-0000-000000000002', v_quiz2_id, 'A coach practicing Level 2 (Focused) Listening is primarily paying attention to:', 'Một coach thực hành Lắng nghe Cấp độ 2 (Tập trung) chủ yếu chú ý đến điều gì?', '[{"id":"a","text":"How the client''s story relates to the coach''s own past experiences","text_vi":"Câu chuyện của khách hàng liên quan như thế nào đến kinh nghiệm quá khứ của chính coach","is_correct":false},{"id":"b","text":"What the coach should say next","text_vi":"Điều coach nên nói tiếp theo là gì","is_correct":false},{"id":"c","text":"The client fully — their words, tone, pace, energy shifts, and what is left unsaid","text_vi":"Toàn bộ khách hàng — lời nói, giọng điệu, nhịp độ, sự thay đổi năng lượng và những gì chưa được nói ra","is_correct":true},{"id":"d","text":"Whether the session is on schedule","text_vi":"Session có đang đúng tiến độ hay không","is_correct":false}]'::jsonb, 'Level 2 listening moves attention entirely off the coach''s own internal chatter (Level 1) and fully onto the client — verbal and non-verbal cues alike.', 'Lắng nghe Cấp độ 2 chuyển toàn bộ sự chú ý ra khỏi tiếng ồn nội tại của coach (Cấp độ 1) và hoàn toàn hướng về khách hàng — cả tín hiệu lời nói lẫn phi ngôn ngữ.', 2);
  INSERT INTO public.quiz_questions (id, assignment_id, question_text, question_text_vi, options, explanation, explanation_vi, sort_order)
  VALUES ('c3200000-0000-0000-0000-000000000003', v_quiz2_id, 'Why are "Why?" questions generally avoided in coaching conversations?', 'Tại sao câu hỏi "Tại sao?" thường được tránh trong các cuộc đối thoại coaching?', '[{"id":"a","text":"They are grammatically incorrect in most languages","text_vi":"Chúng sai ngữ pháp trong hầu hết các ngôn ngữ","is_correct":false},{"id":"b","text":"They tend to trigger justification or defensiveness rather than open exploration","text_vi":"Chúng có xu hướng kích hoạt sự biện minh hoặc phòng thủ thay vì khám phá cởi mở","is_correct":true},{"id":"c","text":"They are too long for clients to understand","text_vi":"Chúng quá dài để khách hàng hiểu","is_correct":false},{"id":"d","text":"ICF certification rules prohibit their use entirely","text_vi":"Quy tắc chứng nhận ICF cấm hoàn toàn việc sử dụng chúng","is_correct":false}]'::jsonb, '"Why" questions often put people on the back foot, prompting them to justify past decisions rather than explore forward. "What" and "How" questions tend to open up thinking instead.', 'Câu hỏi "Tại sao" thường khiến mọi người rơi vào thế phòng thủ, thúc đẩy họ biện minh cho quyết định trong quá khứ thay vì khám phá về phía trước. Câu hỏi "Cái gì" và "Như thế nào" có xu hướng mở ra tư duy thay vào đó.', 3);
  INSERT INTO public.quiz_questions (id, assignment_id, question_text, question_text_vi, options, explanation, explanation_vi, sort_order)
  VALUES ('c3200000-0000-0000-0000-000000000004', v_quiz2_id, 'Which characteristic is NOT typical of a powerful coaching question?', 'Đặc điểm nào KHÔNG phải là đặc trưng của một câu hỏi coaching mạnh mẽ?', '[{"id":"a","text":"It is short and simple","text_vi":"Nó ngắn gọn và đơn giản","is_correct":false},{"id":"b","text":"It generates a pause or silence before the client answers","text_vi":"Nó tạo ra một khoảng dừng hoặc im lặng trước khi khách hàng trả lời","is_correct":false},{"id":"c","text":"It contains the coach''s own hypothesis about what the client should do","text_vi":"Nó chứa giả thuyết của chính coach về điều khách hàng nên làm","is_correct":true},{"id":"d","text":"It is forward-looking rather than focused on justifying the past","text_vi":"Nó hướng về phía trước thay vì tập trung vào việc biện minh cho quá khứ","is_correct":false}]'::jsonb, 'A powerful question is assumption-free — it does not smuggle in the coach''s own opinion. The moment a question contains the coach''s hypothesis, it stops being a coaching question and becomes disguised advice.', 'Một câu hỏi mạnh mẽ không chứa giả định — nó không lén đưa ý kiến riêng của coach vào. Ngay khi một câu hỏi chứa giả thuyết của coach, nó không còn là câu hỏi coaching nữa mà trở thành lời khuyên được ngụy trang.', 4);

  -- ---- Week 3: The SHIFT Model in Practice ----
  INSERT INTO public.training_weeks (
    id, programme_id, week_number, sort_order, title, title_vi, subtitle, subtitle_vi,
    is_visible, skill_card_visible, unlock_date, video_url,
    pdf_storage_path, pdf_storage_path_vi, skill_card_html, skill_card_html_vi
  ) VALUES (
    'b0000000-0000-0000-0000-000000000003', v_programme_id, 3, 3,
    'The SHIFT Model in Practice', 'Mô hình SHIFT trong Thực hành', 'Structuring a complete coaching conversation using Erickson''s SHIFT framework', 'Cấu trúc một cuộc đối thoại coaching hoàn chỉnh sử dụng khung SHIFT của Erickson',
    true, true, '2026-09-22'::date, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'tasc-essential/week-3-shift-model-en.pdf', 'tasc-essential/week-3-shift-model-vi.pdf', '<div class="skill-card"><h2>The SHIFT Model</h2><p>SHIFT is Erickson Coaching International''s signature coaching conversation framework. It provides a complete structure for a coaching session — from contracting to commitment — while staying flexible enough to follow the client''s energy.</p><h3>The Five Stages</h3><ol><li><strong>S — Set the Foundation</strong>: Establish rapport, clarify the coaching agreement for this session. "What would make this session valuable for you today?"</li><li><strong>H — Hear the Current Situation</strong>: Explore what is happening now — facts, feelings, and the gap between current reality and the desired state.</li><li><strong>I — Identify the Desired Outcome</strong>: Help the client articulate a clear, compelling vision of what they want. Make it sensory-rich: "What will you see, hear, and feel when this is working?"</li><li><strong>F — Find Resources and Options</strong>: Expand the client''s awareness of what they already have (strengths, past successes, relationships) and brainstorm new possibilities.</li><li><strong>T — Take Action</strong>: Narrow to a specific, time-bound commitment. "What is one thing you will do before our next session?"</li></ol><h3>Common Pitfalls</h3><ul><li>Jumping to "T" (action) before the client has fully explored "I" (desired outcome)</li><li>Spending too long in "H" (current situation) — this can become venting without direction</li><li>Skipping "S" (set the foundation) — without a clear contract, the session drifts</li></ul><h3>Practice This Week</h3><p>Record a 20-minute practice coaching session with a peer. Afterward, map each part of the conversation to S-H-I-F-T. Where did you spend the most time? Where did you skip?</p></div>', '<div class="skill-card"><h2>Mô hình SHIFT</h2><p>SHIFT là khung đối thoại coaching đặc trưng của Erickson Coaching International. Nó cung cấp cấu trúc hoàn chỉnh cho một session coaching — từ thiết lập hợp đồng đến cam kết — trong khi đủ linh hoạt để theo năng lượng của khách hàng.</p><h3>Năm Giai đoạn</h3><ol><li><strong>S — Thiết lập Nền tảng</strong>: Xây dựng mối quan hệ, làm rõ thỏa thuận coaching cho session này. "Điều gì sẽ làm cho session hôm nay có giá trị với bạn?"</li><li><strong>H — Lắng nghe Tình huống Hiện tại</strong>: Khám phá điều gì đang diễn ra — sự kiện, cảm xúc, và khoảng cách giữa thực tại và trạng thái mong muốn.</li><li><strong>I — Xác định Kết quả Mong muốn</strong>: Giúp khách hàng diễn đạt tầm nhìn rõ ràng, hấp dẫn về điều họ muốn. Làm cho nó giàu cảm giác: "Bạn sẽ thấy, nghe và cảm nhận gì khi điều này hoạt động?"</li><li><strong>F — Tìm Nguồn lực và Lựa chọn</strong>: Mở rộng nhận thức của khách hàng về những gì họ đã có (thế mạnh, thành công quá khứ, các mối quan hệ) và sáng tạo những khả năng mới.</li><li><strong>T — Hành động</strong>: Thu hẹp thành cam kết cụ thể, có thời hạn. "Một điều bạn sẽ làm trước session tiếp theo là gì?"</li></ol><h3>Những Sai lầm Thường gặp</h3><ul><li>Nhảy sang "T" (hành động) trước khi khách hàng khám phá hết "I" (kết quả mong muốn)</li><li>Dành quá nhiều thời gian ở "H" (tình huống hiện tại) — có thể trở thành than phiền không định hướng</li><li>Bỏ qua "S" (thiết lập nền tảng) — không có hợp đồng rõ ràng, session sẽ trôi dạt</li></ul><h3>Thực hành Tuần này</h3><p>Ghi lại một session coaching thực hành 20 phút với đồng nghiệp. Sau đó, ánh xạ từng phần của cuộc trò chuyện vào S-H-I-F-T. Bạn dành nhiều thời gian nhất ở đâu? Bạn đã bỏ qua chỗ nào?</p></div>'
  )
  ON CONFLICT (programme_id, week_number) DO UPDATE SET
    sort_order = EXCLUDED.sort_order, title = EXCLUDED.title, title_vi = EXCLUDED.title_vi,
    subtitle = EXCLUDED.subtitle, subtitle_vi = EXCLUDED.subtitle_vi, is_visible = EXCLUDED.is_visible,
    skill_card_visible = EXCLUDED.skill_card_visible, unlock_date = EXCLUDED.unlock_date, video_url = EXCLUDED.video_url,
    pdf_storage_path = EXCLUDED.pdf_storage_path, pdf_storage_path_vi = EXCLUDED.pdf_storage_path_vi,
    skill_card_html = EXCLUDED.skill_card_html, skill_card_html_vi = EXCLUDED.skill_card_html_vi
  RETURNING id INTO v_week3_id;

  -- Replace any existing daily prompts for this week with the real ones
  DELETE FROM public.daily_prompts WHERE training_week_id = v_week3_id;
  INSERT INTO public.daily_prompts (id, training_week_id, day_offset, sort_order, is_visible, prompt_text, prompt_text_vi)
  VALUES ('c1000000-0000-0000-0000-000000000031', v_week3_id, 1, 1, true, 'In your next conversation, consciously try to identify which SHIFT stage the other person seems to be in. Are they exploring their situation (H), or ready for action (T)?', 'Trong cuộc trò chuyện tiếp theo, hãy có ý thức xác định giai đoạn SHIFT nào mà người kia dường như đang ở. Họ đang khám phá tình huống (H), hay sẵn sàng hành động (T)?');
  INSERT INTO public.daily_prompts (id, training_week_id, day_offset, sort_order, is_visible, prompt_text, prompt_text_vi)
  VALUES ('c1000000-0000-0000-0000-000000000032', v_week3_id, 2, 2, true, 'Think about a goal you are working on right now. Describe it in sensory terms: what will you see, hear, and feel when you achieve it? (This is the "I" in SHIFT.)', 'Hãy nghĩ về một mục tiêu bạn đang thực hiện. Mô tả nó bằng các thuật ngữ giác quan: bạn sẽ thấy, nghe, và cảm nhận gì khi đạt được nó? (Đây là "I" trong SHIFT.)');
  INSERT INTO public.daily_prompts (id, training_week_id, day_offset, sort_order, is_visible, prompt_text, prompt_text_vi)
  VALUES ('c1000000-0000-0000-0000-000000000033', v_week3_id, 3, 3, true, 'After a practice coaching conversation today, write down: which stage of SHIFT did I skip or rush through? What question could I have asked to stay in that stage longer?', 'Sau cuộc đối thoại coaching thực hành hôm nay, viết ra: giai đoạn nào của SHIFT tôi đã bỏ qua hoặc vội vàng? Câu hỏi nào tôi có thể đã đặt để ở lại giai đoạn đó lâu hơn?');
  INSERT INTO public.daily_prompts (id, training_week_id, day_offset, sort_order, is_visible, prompt_text, prompt_text_vi)
  VALUES ('c1000000-0000-0000-0000-000000000034', v_week3_id, 4, 4, true, 'The "F" stage is about finding resources the client already has. What is a strength you have that you tend to forget about when you face challenges?', 'Giai đoạn "F" là về tìm kiếm nguồn lực mà khách hàng đã có. Thế mạnh nào của bạn mà bạn thường quên đi khi đối mặt với thách thức?');
  INSERT INTO public.daily_prompts (id, training_week_id, day_offset, sort_order, is_visible, prompt_text, prompt_text_vi)
  VALUES ('c1000000-0000-0000-0000-000000000035', v_week3_id, 5, 5, true, 'On a scale of 1-10, how comfortable are you with silence in a coaching conversation? What would help you become more comfortable?', 'Trên thang 1-10, bạn thoải mái đến mức nào với sự im lặng trong cuộc đối thoại coaching? Điều gì sẽ giúp bạn thoải mái hơn?');

  -- Quiz for week 3: resolve the existing quiz-type assignment for this week, if any
  SELECT id INTO v_quiz3_id FROM public.assignments WHERE training_week_id = v_week3_id AND assignment_type = 'quiz' LIMIT 1;
  IF v_quiz3_id IS NULL THEN
    INSERT INTO public.assignments (id, training_week_id, assignment_type, title, title_vi, instructions, instructions_vi, is_visible, sort_order)
    VALUES ('c2000000-0000-0000-0000-000000000003', v_week3_id, 'quiz', 'The SHIFT Model', 'Mô hình SHIFT', 'Test your understanding of the five SHIFT stages. You can take this quiz once.', 'Kiểm tra hiểu biết của bạn về năm giai đoạn SHIFT. Bạn có thể làm bài kiểm tra này một lần.', true, 1)
    RETURNING id INTO v_quiz3_id;
  ELSE
    UPDATE public.assignments SET title = 'The SHIFT Model', title_vi = 'Mô hình SHIFT', instructions = 'Test your understanding of the five SHIFT stages. You can take this quiz once.', instructions_vi = 'Kiểm tra hiểu biết của bạn về năm giai đoạn SHIFT. Bạn có thể làm bài kiểm tra này một lần.', is_visible = true, sort_order = 1 WHERE id = v_quiz3_id;
  END IF;
  DELETE FROM public.quiz_questions WHERE assignment_id = v_quiz3_id;
  INSERT INTO public.quiz_questions (id, assignment_id, question_text, question_text_vi, options, explanation, explanation_vi, sort_order)
  VALUES ('c3300000-0000-0000-0000-000000000001', v_quiz3_id, 'What is the main purpose of the "S — Set the Foundation" stage of SHIFT?', 'Mục đích chính của giai đoạn "S — Thiết lập Nền tảng" trong SHIFT là gì?', '[{"id":"a","text":"To immediately identify the client''s action steps","text_vi":"Xác định ngay các bước hành động của khách hàng","is_correct":false},{"id":"b","text":"To build rapport and clarify what would make this specific session valuable","text_vi":"Xây dựng mối quan hệ và làm rõ điều gì sẽ làm cho session cụ thể này có giá trị","is_correct":true},{"id":"c","text":"To review the client''s progress since the last session in detail","text_vi":"Xem xét chi tiết tiến độ của khách hàng kể từ session trước","is_correct":false},{"id":"d","text":"To explain the SHIFT model to the client","text_vi":"Giải thích mô hình SHIFT cho khách hàng","is_correct":false}]'::jsonb, 'S establishes the working agreement for this specific session — rapport plus a clear contract on what "valuable" looks like today, before any content is explored.', 'S thiết lập thỏa thuận làm việc cho session cụ thể này — mối quan hệ cộng với hợp đồng rõ ràng về việc "có giá trị" trông như thế nào hôm nay, trước khi khám phá bất kỳ nội dung nào.', 1);
  INSERT INTO public.quiz_questions (id, assignment_id, question_text, question_text_vi, options, explanation, explanation_vi, sort_order)
  VALUES ('c3300000-0000-0000-0000-000000000002', v_quiz3_id, 'What is the most common mistake coaches make when applying the SHIFT model?', 'Sai lầm phổ biến nhất mà coach mắc phải khi áp dụng mô hình SHIFT là gì?', '[{"id":"a","text":"Spending too much time in \"S\" (Set the Foundation)","text_vi":"Dành quá nhiều thời gian ở \"S\" (Thiết lập Nền tảng)","is_correct":false},{"id":"b","text":"Jumping to \"T\" (Take Action) before the client has fully explored \"I\" (Identify the Desired Outcome)","text_vi":"Nhảy sang \"T\" (Hành động) trước khi khách hàng khám phá đầy đủ \"I\" (Xác định Kết quả Mong muốn)","is_correct":true},{"id":"c","text":"Using too many open questions","text_vi":"Sử dụng quá nhiều câu hỏi mở","is_correct":false},{"id":"d","text":"Ending the session exactly on time","text_vi":"Kết thúc session đúng giờ","is_correct":false}]'::jsonb, 'Coaches under time pressure often rush toward a concrete action step before the client has a compelling, sensory-rich picture of what they actually want, which weakens motivation and follow-through.', 'Coach dưới áp lực thời gian thường vội vàng hướng đến một bước hành động cụ thể trước khi khách hàng có một hình ảnh hấp dẫn, giàu cảm giác về điều họ thực sự muốn, điều này làm suy yếu động lực và việc thực hiện.', 2);
  INSERT INTO public.quiz_questions (id, assignment_id, question_text, question_text_vi, options, explanation, explanation_vi, sort_order)
  VALUES ('c3300000-0000-0000-0000-000000000003', v_quiz3_id, 'What does it mean to make a desired outcome "sensory-rich" during the "I" stage?', 'Việc làm cho kết quả mong muốn "giàu cảm giác" trong giai đoạn "I" có nghĩa là gì?', '[{"id":"a","text":"Describing the outcome only in terms of numbers and deadlines","text_vi":"Chỉ mô tả kết quả bằng con số và thời hạn","is_correct":false},{"id":"b","text":"Asking the client what they will see, hear, and feel when the outcome is achieved","text_vi":"Hỏi khách hàng họ sẽ thấy, nghe và cảm nhận gì khi đạt được kết quả","is_correct":true},{"id":"c","text":"Focusing on the physical location where the goal will be achieved","text_vi":"Tập trung vào địa điểm vật lý nơi mục tiêu sẽ đạt được","is_correct":false},{"id":"d","text":"Listing every possible obstacle in vivid detail","text_vi":"Liệt kê mọi trở ngại có thể xảy ra một cách chi tiết sống động","is_correct":false}]'::jsonb, 'Sensory-rich language engages the client''s imagination across sight, sound, and feeling, making the desired outcome vivid and motivating rather than abstract.', 'Ngôn ngữ giàu cảm giác thu hút trí tưởng tượng của khách hàng qua thị giác, thính giác và cảm xúc, làm cho kết quả mong muốn trở nên sống động và tạo động lực thay vì trừu tượng.', 3);
  INSERT INTO public.quiz_questions (id, assignment_id, question_text, question_text_vi, options, explanation, explanation_vi, sort_order)
  VALUES ('c3300000-0000-0000-0000-000000000004', v_quiz3_id, 'What is the purpose of the "F — Find Resources and Options" stage?', 'Mục đích của giai đoạn "F — Tìm Nguồn lực và Lựa chọn" là gì?', '[{"id":"a","text":"To tell the client which resources they should use","text_vi":"Cho khách hàng biết họ nên sử dụng nguồn lực nào","is_correct":false},{"id":"b","text":"To expand the client''s awareness of strengths and past successes they already have, and to brainstorm new possibilities","text_vi":"Mở rộng nhận thức của khách hàng về những thế mạnh và thành công quá khứ họ đã có, và sáng tạo những khả năng mới","is_correct":true},{"id":"c","text":"To move directly to scheduling the next session","text_vi":"Chuyển thẳng sang việc lên lịch session tiếp theo","is_correct":false},{"id":"d","text":"To evaluate whether the client is capable of achieving the goal","text_vi":"Đánh giá xem khách hàng có khả năng đạt được mục tiêu hay không","is_correct":false}]'::jsonb, 'F surfaces resources the client already has — strengths, relationships, past wins — rather than the coach supplying solutions, and opens space for new options the client had not yet considered.', 'F làm nổi bật những nguồn lực khách hàng đã có — thế mạnh, các mối quan hệ, chiến thắng trong quá khứ — thay vì coach cung cấp giải pháp, và mở ra không gian cho những lựa chọn mới mà khách hàng chưa từng nghĩ đến.', 4);

  -- ---- Week 4: Integration & Sustainable Change ----
  INSERT INTO public.training_weeks (
    id, programme_id, week_number, sort_order, title, title_vi, subtitle, subtitle_vi,
    is_visible, skill_card_visible, unlock_date, video_url,
    pdf_storage_path, pdf_storage_path_vi, skill_card_html, skill_card_html_vi
  ) VALUES (
    'b0000000-0000-0000-0000-000000000004', v_programme_id, 4, 4,
    'Integration & Sustainable Change', 'Tích hợp & Thay đổi Bền vững', 'Accountability, ICF ethics, and building your coaching practice', 'Trách nhiệm giải trình, đạo đức ICF, và xây dựng thực hành coaching',
    true, true, '2026-09-29'::date, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'tasc-essential/week-4-integration-en.pdf', 'tasc-essential/week-4-integration-vi.pdf', '<div class="skill-card"><h2>Integration & Sustainable Change</h2><p>The final week brings everything together: mindset, questioning, the SHIFT structure, and now — how to make coaching stick. A great session means nothing if the client walks away and nothing changes.</p><h3>The Accountability Partnership</h3><ul><li><strong>Commitment, not compliance</strong>: The client chooses their action, not the coach.</li><li><strong>Follow-up is not follow-through</strong>: Ask "What happened with X?" at the start of the next session — always.</li><li><strong>Celebrate progress, not perfection</strong>: Even partial action is evidence of movement.</li></ul><h3>ICF Core Competencies Covered</h3><ol><li>Demonstrates Ethical Practice</li><li>Embodies a Coaching Mindset</li><li>Establishes and Maintains Agreements</li><li>Cultivates Trust and Safety</li><li>Maintains Presence</li><li>Listens Actively</li><li>Evokes Awareness</li><li>Facilitates Client Growth</li></ol><h3>Building Your Practice</h3><ul><li>Log every practice session — hours count toward ICF credentialing</li><li>Find a mentor coach (this platform supports it — check the Mentoring tab)</li><li>Join or form a triad group for peer observation and feedback</li><li>Re-rate your own coaching confidence at the end of this programme</li></ul><h3>Final Reflection</h3><p>What is one thing you believed about coaching before this programme that you now see differently? Write it down. That shift IS the learning.</p></div>', '<div class="skill-card"><h2>Tích hợp & Thay đổi Bền vững</h2><p>Tuần cuối cùng kết nối tất cả: tư duy, đặt câu hỏi, cấu trúc SHIFT, và bây giờ — làm thế nào để coaching có hiệu quả lâu dài. Một session tuyệt vời không có ý nghĩa gì nếu khách hàng rời đi và không có gì thay đổi.</p><h3>Quan hệ Đối tác Trách nhiệm</h3><ul><li><strong>Cam kết, không phải tuân thủ</strong>: Khách hàng chọn hành động, không phải coach.</li><li><strong>Theo dõi không phải thực hiện thay</strong>: Hỏi "Chuyện gì đã xảy ra với X?" ở đầu session tiếp theo — luôn luôn.</li><li><strong>Ăn mừng tiến bộ, không phải sự hoàn hảo</strong>: Ngay cả hành động một phần cũng là bằng chứng của sự chuyển động.</li></ul><h3>Năng lực Cốt lõi ICF được Đề cập</h3><ol><li>Thể hiện Thực hành Đạo đức</li><li>Thể hiện Tư duy Coaching</li><li>Thiết lập và Duy trì Thỏa thuận</li><li>Nuôi dưỡng Niềm tin và Sự An toàn</li><li>Duy trì Sự Hiện diện</li><li>Lắng nghe Chủ động</li><li>Khơi gợi Nhận thức</li><li>Hỗ trợ Sự Phát triển của Khách hàng</li></ol><h3>Xây dựng Thực hành</h3><ul><li>Ghi nhật ký mỗi session thực hành — số giờ tính vào chứng nhận ICF</li><li>Tìm một mentor coach (nền tảng này hỗ trợ — kiểm tra tab Mentoring)</li><li>Tham gia hoặc thành lập nhóm triad để quan sát và phản hồi</li><li>Đánh giá lại sự tự tin coaching của bạn vào cuối chương trình</li></ul><h3>Phản tư Cuối cùng</h3><p>Một điều bạn đã tin về coaching trước chương trình này mà bây giờ bạn nhìn khác là gì? Viết nó ra. Sự thay đổi đó CHÍNH LÀ bài học.</p></div>'
  )
  ON CONFLICT (programme_id, week_number) DO UPDATE SET
    sort_order = EXCLUDED.sort_order, title = EXCLUDED.title, title_vi = EXCLUDED.title_vi,
    subtitle = EXCLUDED.subtitle, subtitle_vi = EXCLUDED.subtitle_vi, is_visible = EXCLUDED.is_visible,
    skill_card_visible = EXCLUDED.skill_card_visible, unlock_date = EXCLUDED.unlock_date, video_url = EXCLUDED.video_url,
    pdf_storage_path = EXCLUDED.pdf_storage_path, pdf_storage_path_vi = EXCLUDED.pdf_storage_path_vi,
    skill_card_html = EXCLUDED.skill_card_html, skill_card_html_vi = EXCLUDED.skill_card_html_vi
  RETURNING id INTO v_week4_id;

  -- Replace any existing daily prompts for this week with the real ones
  DELETE FROM public.daily_prompts WHERE training_week_id = v_week4_id;
  INSERT INTO public.daily_prompts (id, training_week_id, day_offset, sort_order, is_visible, prompt_text, prompt_text_vi)
  VALUES ('c1000000-0000-0000-0000-000000000041', v_week4_id, 1, 1, true, 'Think about a time someone held you accountable in a way that felt supportive, not controlling. What did they do differently from people who felt controlling?', 'Nghĩ về một lần ai đó giữ trách nhiệm cho bạn theo cách cảm thấy hỗ trợ, không kiểm soát. Họ đã làm gì khác so với những người khiến bạn cảm thấy bị kiểm soát?');
  INSERT INTO public.daily_prompts (id, training_week_id, day_offset, sort_order, is_visible, prompt_text, prompt_text_vi)
  VALUES ('c1000000-0000-0000-0000-000000000042', v_week4_id, 2, 2, true, 'Which of the 8 ICF Core Competencies feels strongest in your practice right now? Which one needs the most development? Be specific about why.', 'Năng lực cốt lõi ICF nào cảm thấy mạnh nhất trong thực hành coaching của bạn hiện tại? Năng lực nào cần phát triển nhất? Hãy cụ thể về lý do.');
  INSERT INTO public.daily_prompts (id, training_week_id, day_offset, sort_order, is_visible, prompt_text, prompt_text_vi)
  VALUES ('c1000000-0000-0000-0000-000000000043', v_week4_id, 3, 3, true, 'If you were to describe your emerging coaching style in three words, what would they be? How does this style serve your clients?', 'Nếu bạn mô tả phong cách coaching đang hình thành của mình bằng ba từ, đó sẽ là gì? Phong cách này phục vụ khách hàng như thế nào?');
  INSERT INTO public.daily_prompts (id, training_week_id, day_offset, sort_order, is_visible, prompt_text, prompt_text_vi)
  VALUES ('c1000000-0000-0000-0000-000000000044', v_week4_id, 4, 4, true, 'Write a commitment to yourself: "By the end of next month, I will have completed ___ practice coaching sessions." Make it specific and realistic.', 'Viết một cam kết với chính mình: "Đến cuối tháng tới, tôi sẽ hoàn thành ___ session coaching thực hành." Hãy cụ thể và thực tế.');
  INSERT INTO public.daily_prompts (id, training_week_id, day_offset, sort_order, is_visible, prompt_text, prompt_text_vi)
  VALUES ('c1000000-0000-0000-0000-000000000045', v_week4_id, 5, 5, true, 'Looking back at Day 1 of this programme: what is one belief about coaching that has shifted for you? What caused that shift?', 'Nhìn lại Ngày 1 của chương trình: một niềm tin nào về coaching đã thay đổi ở bạn? Điều gì đã gây ra sự thay đổi đó?');

  -- Quiz for week 4: resolve the existing quiz-type assignment for this week, if any
  SELECT id INTO v_quiz4_id FROM public.assignments WHERE training_week_id = v_week4_id AND assignment_type = 'quiz' LIMIT 1;
  IF v_quiz4_id IS NULL THEN
    INSERT INTO public.assignments (id, training_week_id, assignment_type, title, title_vi, instructions, instructions_vi, is_visible, sort_order)
    VALUES ('c2000000-0000-0000-0000-000000000004', v_week4_id, 'quiz', 'Integration & Ethics', 'Tích hợp & Đạo đức', 'Test your understanding of accountability, ICF competencies, and building a sustainable coaching practice. You can take this quiz once.', 'Kiểm tra hiểu biết của bạn về trách nhiệm giải trình, năng lực ICF, và xây dựng thực hành coaching bền vững. Bạn có thể làm bài kiểm tra này một lần.', true, 1)
    RETURNING id INTO v_quiz4_id;
  ELSE
    UPDATE public.assignments SET title = 'Integration & Ethics', title_vi = 'Tích hợp & Đạo đức', instructions = 'Test your understanding of accountability, ICF competencies, and building a sustainable coaching practice. You can take this quiz once.', instructions_vi = 'Kiểm tra hiểu biết của bạn về trách nhiệm giải trình, năng lực ICF, và xây dựng thực hành coaching bền vững. Bạn có thể làm bài kiểm tra này một lần.', is_visible = true, sort_order = 1 WHERE id = v_quiz4_id;
  END IF;
  DELETE FROM public.quiz_questions WHERE assignment_id = v_quiz4_id;
  INSERT INTO public.quiz_questions (id, assignment_id, question_text, question_text_vi, options, explanation, explanation_vi, sort_order)
  VALUES ('c3400000-0000-0000-0000-000000000001', v_quiz4_id, 'What is the key difference between accountability and control in a coaching relationship?', 'Sự khác biệt chính giữa trách nhiệm giải trình và kiểm soát trong mối quan hệ coaching là gì?', '[{"id":"a","text":"Accountability means the coach checks the client''s work; control means the client checks their own work","text_vi":"Trách nhiệm giải trình nghĩa là coach kiểm tra công việc của khách hàng; kiểm soát nghĩa là khách hàng tự kiểm tra công việc của mình","is_correct":false},{"id":"b","text":"The client chooses and owns their own commitment under accountability; under control, the coach dictates the action and enforces compliance","text_vi":"Dưới trách nhiệm giải trình, khách hàng chọn và sở hữu cam kết của chính họ; dưới kiểm soát, coach áp đặt hành động và ép buộc tuân thủ","is_correct":true},{"id":"c","text":"There is no meaningful difference — both terms describe the same coaching behaviour","text_vi":"Không có sự khác biệt đáng kể — cả hai thuật ngữ mô tả cùng một hành vi coaching","is_correct":false},{"id":"d","text":"Accountability only applies to group coaching, control only applies to 1:1 coaching","text_vi":"Trách nhiệm giải trình chỉ áp dụng cho coaching nhóm, kiểm soát chỉ áp dụng cho coaching 1:1","is_correct":false}]'::jsonb, 'Accountability is client-owned: the client sets and follows through on their own commitment, with the coach checking in supportively. Control shifts ownership to the coach, which undermines client resourcefulness.', 'Trách nhiệm giải trình thuộc sở hữu của khách hàng: khách hàng đặt ra và thực hiện cam kết của chính họ, với coach theo dõi một cách hỗ trợ. Kiểm soát chuyển quyền sở hữu sang coach, điều này làm suy yếu nguồn lực của khách hàng.', 1);
  INSERT INTO public.quiz_questions (id, assignment_id, question_text, question_text_vi, options, explanation, explanation_vi, sort_order)
  VALUES ('c3400000-0000-0000-0000-000000000002', v_quiz4_id, 'Which ICF Core Competency most directly relates to a coach staying flexible, observant, and attuned moment-to-moment during a session?', 'Năng lực Cốt lõi ICF nào liên quan trực tiếp nhất đến việc coach giữ sự linh hoạt, quan sát, và đồng điệu theo từng khoảnh khắc trong session?', '[{"id":"a","text":"Demonstrates Ethical Practice","text_vi":"Thể hiện Thực hành Đạo đức","is_correct":false},{"id":"b","text":"Establishes and Maintains Agreements","text_vi":"Thiết lập và Duy trì Thỏa thuận","is_correct":false},{"id":"c","text":"Maintains Presence","text_vi":"Duy trì Sự Hiện diện","is_correct":true},{"id":"d","text":"Facilitates Client Growth","text_vi":"Hỗ trợ Sự Phát triển của Khách hàng","is_correct":false}]'::jsonb, 'Maintains Presence is being fully conscious and flexible during the session, staying attuned to the client moment-to-moment rather than following a fixed script.', 'Duy trì Sự Hiện diện là hoàn toàn ý thức và linh hoạt trong session, đồng điệu với khách hàng theo từng khoảnh khắc thay vì theo một kịch bản cố định.', 2);
  INSERT INTO public.quiz_questions (id, assignment_id, question_text, question_text_vi, options, explanation, explanation_vi, sort_order)
  VALUES ('c3400000-0000-0000-0000-000000000003', v_quiz4_id, 'In a company-sponsored coaching programme, how should a coach handle confidentiality?', 'Trong một chương trình coaching được công ty tài trợ, coach nên xử lý bảo mật như thế nào?', '[{"id":"a","text":"Share session content freely with the sponsor since they are paying for the programme","text_vi":"Chia sẻ nội dung session tự do với nhà tài trợ vì họ đang trả tiền cho chương trình","is_correct":false},{"id":"b","text":"Keep session content confidential, sharing only what the client explicitly agrees to (e.g. aggregated progress or goals marked shared)","text_vi":"Giữ bí mật nội dung session, chỉ chia sẻ những gì khách hàng đồng ý rõ ràng (ví dụ: tiến độ tổng hợp hoặc mục tiêu được đánh dấu chia sẻ)","is_correct":true},{"id":"c","text":"Only keep confidentiality if the client specifically requests it in writing","text_vi":"Chỉ giữ bí mật nếu khách hàng yêu cầu cụ thể bằng văn bản","is_correct":false},{"id":"d","text":"Confidentiality does not apply in sponsored programmes","text_vi":"Bảo mật không áp dụng trong các chương trình được tài trợ","is_correct":false}]'::jsonb, 'ICF ethics require the coach to maintain strict confidentiality with client information, disclosing only what the client has explicitly agreed to share — even when a third party is sponsoring the engagement.', 'Đạo đức ICF yêu cầu coach duy trì bảo mật nghiêm ngặt với thông tin khách hàng, chỉ tiết lộ những gì khách hàng đã đồng ý rõ ràng để chia sẻ — ngay cả khi một bên thứ ba đang tài trợ cho chương trình.', 3);
  INSERT INTO public.quiz_questions (id, assignment_id, question_text, question_text_vi, options, explanation, explanation_vi, sort_order)
  VALUES ('c3400000-0000-0000-0000-000000000004', v_quiz4_id, 'What most contributes to coaching being "sustainable" after a formal programme ends?', 'Điều gì góp phần nhiều nhất để coaching trở nên "bền vững" sau khi một chương trình chính thức kết thúc?', '[{"id":"a","text":"The client memorising the coach''s advice","text_vi":"Khách hàng ghi nhớ lời khuyên của coach","is_correct":false},{"id":"b","text":"The client internalising the coaching mindset and questioning habits so they can continue applying them independently","text_vi":"Khách hàng nội tâm hóa tư duy coaching và thói quen đặt câu hỏi để họ có thể tiếp tục áp dụng một cách độc lập","is_correct":true},{"id":"c","text":"Scheduling as many sessions as possible before the programme ends","text_vi":"Lên lịch càng nhiều session càng tốt trước khi chương trình kết thúc","is_correct":false},{"id":"d","text":"Ensuring the coach remains available indefinitely after the programme","text_vi":"Đảm bảo coach luôn sẵn sàng vô thời hạn sau chương trình","is_correct":false}]'::jsonb, 'Sustainable change happens when the client has internalised the mindset and skills (self-questioning, resourcefulness, accountability) rather than depending on the coach''s continued presence.', 'Thay đổi bền vững xảy ra khi khách hàng đã nội tâm hóa tư duy và kỹ năng (tự đặt câu hỏi, nguồn lực, trách nhiệm giải trình) thay vì phụ thuộc vào sự hiện diện liên tục của coach.', 4);

  -- Reflection 1: Mid-Programme Reflection: Your Coaching Journey So Far
  INSERT INTO public.programme_reflections (id, programme_id, reflection_number, title, title_vi, instructions, instructions_vi, appears_at_week, is_visible)
  VALUES ('c4000000-0000-0000-0000-000000000001', v_programme_id, 1, 'Mid-Programme Reflection: Your Coaching Journey So Far', 'Phản tư Giữa chương trình: Hành trình Coaching của Bạn', 'Take 10 minutes to reflect on your first two weeks. There are no right answers — this is about noticing your own growth and identifying what needs attention.', 'Dành 10 phút để phản tư về hai tuần đầu tiên. Không có câu trả lời đúng — đây là về việc nhận ra sự phát triển của bạn và xác định điều gì cần chú ý.', 2, true)
  ON CONFLICT (programme_id, reflection_number) DO UPDATE SET
    title = EXCLUDED.title, title_vi = EXCLUDED.title_vi, instructions = EXCLUDED.instructions, instructions_vi = EXCLUDED.instructions_vi,
    appears_at_week = EXCLUDED.appears_at_week, is_visible = EXCLUDED.is_visible
  RETURNING id INTO v_reflection1_id;
  DELETE FROM public.reflection_questions WHERE reflection_id = v_reflection1_id;
  INSERT INTO public.reflection_questions (id, reflection_id, question_text, question_text_vi, question_type, is_required, sort_order)
  VALUES ('c5100000-0000-0000-0000-000000000001', v_reflection1_id, 'What has been your biggest insight about coaching so far?', 'Cái nhìn sâu sắc lớn nhất của bạn về coaching cho đến nay là gì?', 'open_text', true, 1);
  INSERT INTO public.reflection_questions (id, reflection_id, question_text, question_text_vi, question_type, is_required, sort_order)
  VALUES ('c5100000-0000-0000-0000-000000000002', v_reflection1_id, 'How confident do you feel asking open-ended questions instead of giving advice?', 'Bạn tự tin đến mức nào khi đặt câu hỏi mở thay vì đưa ra lời khuyên?', 'scale_1_10', true, 2);
  INSERT INTO public.reflection_questions (id, reflection_id, question_text, question_text_vi, question_type, is_required, sort_order)
  VALUES ('c5100000-0000-0000-0000-000000000003', v_reflection1_id, 'Describe a moment this week where you successfully held back from advising and asked a question instead. What happened?', 'Mô tả một khoảnh khắc tuần này khi bạn thành công trong việc kiềm chế lời khuyên và đặt câu hỏi thay vào đó. Điều gì đã xảy ra?', 'open_text', false, 3);
  INSERT INTO public.reflection_questions (id, reflection_id, question_text, question_text_vi, question_type, is_required, sort_order)
  VALUES ('c5100000-0000-0000-0000-000000000004', v_reflection1_id, 'How would you rate your active listening skills right now?', 'Bạn đánh giá kỹ năng lắng nghe chủ động của mình hiện tại như thế nào?', 'scale_1_10', true, 4);
  INSERT INTO public.reflection_questions (id, reflection_id, question_text, question_text_vi, question_type, is_required, sort_order)
  VALUES ('c5100000-0000-0000-0000-000000000005', v_reflection1_id, 'What is one specific area you want to focus on improving in weeks 3 and 4?', 'Một lĩnh vực cụ thể bạn muốn tập trung cải thiện trong tuần 3 và 4 là gì?', 'open_text', true, 5);

  -- Reflection 2: Final Reflection: Measuring Your Growth
  INSERT INTO public.programme_reflections (id, programme_id, reflection_number, title, title_vi, instructions, instructions_vi, appears_at_week, is_visible)
  VALUES ('c4000000-0000-0000-0000-000000000002', v_programme_id, 2, 'Final Reflection: Measuring Your Growth', 'Phản tư Cuối cùng: Đo lường Sự Phát triển', 'This is your final programme reflection. Be honest with yourself — the value of this exercise is in noticing what has genuinely shifted, not in performing progress.', 'Đây là phản tư cuối cùng của chương trình. Hãy thành thật với chính mình — giá trị của bài tập này nằm ở việc nhận ra điều gì đã thực sự thay đổi, không phải ở việc thể hiện sự tiến bộ.', 4, true)
  ON CONFLICT (programme_id, reflection_number) DO UPDATE SET
    title = EXCLUDED.title, title_vi = EXCLUDED.title_vi, instructions = EXCLUDED.instructions, instructions_vi = EXCLUDED.instructions_vi,
    appears_at_week = EXCLUDED.appears_at_week, is_visible = EXCLUDED.is_visible
  RETURNING id INTO v_reflection2_id;
  DELETE FROM public.reflection_questions WHERE reflection_id = v_reflection2_id;
  INSERT INTO public.reflection_questions (id, reflection_id, question_text, question_text_vi, question_type, is_required, sort_order)
  VALUES ('c5200000-0000-0000-0000-000000000001', v_reflection2_id, 'How confident do you feel conducting a full coaching session using the SHIFT model?', 'Bạn tự tin đến mức nào khi thực hiện một session coaching đầy đủ sử dụng mô hình SHIFT?', 'scale_1_10', true, 1);
  INSERT INTO public.reflection_questions (id, reflection_id, question_text, question_text_vi, question_type, is_required, sort_order)
  VALUES ('c5200000-0000-0000-0000-000000000002', v_reflection2_id, 'What is the single most important thing you have learned in this programme?', 'Điều quan trọng nhất bạn đã học được trong chương trình này là gì?', 'open_text', true, 2);
  INSERT INTO public.reflection_questions (id, reflection_id, question_text, question_text_vi, question_type, is_required, sort_order)
  VALUES ('c5200000-0000-0000-0000-000000000003', v_reflection2_id, 'How has your understanding of the coach''s role changed since week 1?', 'Hiểu biết của bạn về vai trò của coach đã thay đổi như thế nào kể từ tuần 1?', 'open_text', true, 3);
  INSERT INTO public.reflection_questions (id, reflection_id, question_text, question_text_vi, question_type, is_required, sort_order)
  VALUES ('c5200000-0000-0000-0000-000000000004', v_reflection2_id, 'Rate your overall readiness to coach a real client:', 'Đánh giá mức độ sẵn sàng tổng thể của bạn để coach một khách hàng thực:', 'scale_1_10', true, 4);
  INSERT INTO public.reflection_questions (id, reflection_id, question_text, question_text_vi, question_type, is_required, sort_order)
  VALUES ('c5200000-0000-0000-0000-000000000005', v_reflection2_id, 'What will you do in the next 30 days to continue developing your coaching skills? Be specific.', 'Bạn sẽ làm gì trong 30 ngày tới để tiếp tục phát triển kỹ năng coaching? Hãy cụ thể.', 'open_text', true, 5);
  INSERT INTO public.reflection_questions (id, reflection_id, question_text, question_text_vi, question_type, is_required, sort_order)
  VALUES ('c5200000-0000-0000-0000-000000000006', v_reflection2_id, 'How effectively did the triad practice sessions support your learning?', 'Các session thực hành triad hỗ trợ việc học tập của bạn hiệu quả đến mức nào?', 'scale_1_10', false, 6);

  -- Triad round 1: Triad Practice Round 1: Basic Coaching Conversation
  INSERT INTO public.triad_rounds (id, programme_id, round_number, title, title_vi, training_week_id, completion_deadline, auto_assign_date, auto_assign_status, is_visible)
  VALUES ('c6000000-0000-0000-0000-000000000001', v_programme_id, 1, 'Triad Practice Round 1: Basic Coaching Conversation', 'Vòng Thực hành Triad 1: Cuộc đối thoại Coaching Cơ bản', v_week2_id, '2026-09-21'::date, '2026-09-15'::date, 'pending', true)
  ON CONFLICT (programme_id, round_number) DO UPDATE SET
    title = EXCLUDED.title, title_vi = EXCLUDED.title_vi, training_week_id = EXCLUDED.training_week_id,
    completion_deadline = EXCLUDED.completion_deadline, auto_assign_date = EXCLUDED.auto_assign_date,
    auto_assign_status = EXCLUDED.auto_assign_status, is_visible = EXCLUDED.is_visible
  RETURNING id INTO v_round1_id;
  -- Triad round 2: Triad Practice Round 2: Full SHIFT Session
  INSERT INTO public.triad_rounds (id, programme_id, round_number, title, title_vi, training_week_id, completion_deadline, auto_assign_date, auto_assign_status, is_visible)
  VALUES ('c6000000-0000-0000-0000-000000000002', v_programme_id, 2, 'Triad Practice Round 2: Full SHIFT Session', 'Vòng Thực hành Triad 2: Session SHIFT Đầy đủ', v_week4_id, '2026-10-05'::date, '2026-09-29'::date, 'pending', true)
  ON CONFLICT (programme_id, round_number) DO UPDATE SET
    title = EXCLUDED.title, title_vi = EXCLUDED.title_vi, training_week_id = EXCLUDED.training_week_id,
    completion_deadline = EXCLUDED.completion_deadline, auto_assign_date = EXCLUDED.auto_assign_date,
    auto_assign_status = EXCLUDED.auto_assign_status, is_visible = EXCLUDED.is_visible
  RETURNING id INTO v_round2_id;

  -- ============================================================
  -- Session / feedback test data for trang.tt@hsp.consulting.
  -- ============================================================
  SELECT id INTO v_trang_id FROM public.profiles WHERE email = 'trang.tt@hsp.consulting';
  IF v_trang_id IS NULL THEN
    RAISE NOTICE 'User % not found — skipping TASC session seed for this user', 'trang.tt@hsp.consulting';
    RETURN;
  END IF;

  -- Excludes Trang herself: she carries a 'coach' role on this project
  -- (used for coaching/testing), so without this exclusion she could be
  -- picked as her own coach below.
  SELECT p.id INTO v_coach1_id FROM public.profiles p
    JOIN public.user_roles r ON r.user_id = p.id
    WHERE r.role = 'coach'::app_role AND p.id <> v_trang_id ORDER BY p.id LIMIT 1;
  SELECT p.id INTO v_coach2_id FROM public.profiles p
    JOIN public.user_roles r ON r.user_id = p.id
    WHERE r.role = 'coach'::app_role AND p.id <> v_trang_id AND p.id <> v_coach1_id ORDER BY p.id LIMIT 1;
  v_coach2_id := COALESCE(v_coach2_id, v_coach1_id);

  IF v_coach1_id IS NULL THEN
    RAISE NOTICE 'No coach found (other than Trang herself) — skipping TASC session seed for %', 'trang.tt@hsp.consulting';
    RETURN;
  END IF;

  SELECT p.id INTO v_peer1_id FROM public.profiles p
    JOIN public.user_roles r ON r.user_id = p.id
    WHERE r.role = 'coachee'::app_role AND p.id <> v_trang_id ORDER BY p.id LIMIT 1;
  SELECT p.id INTO v_peer2_id FROM public.profiles p
    JOIN public.user_roles r ON r.user_id = p.id
    WHERE r.role = 'coachee'::app_role AND p.id <> v_trang_id AND p.id <> v_peer1_id ORDER BY p.id LIMIT 1;
  v_peer2_id := COALESCE(v_peer2_id, v_peer1_id);

  -- 9. Programme enrollment (update in place if she's already enrolled)
  SELECT id INTO v_enrollment_id FROM public.programme_enrollments WHERE user_id = v_trang_id AND programme_id = v_programme_id LIMIT 1;
  IF v_enrollment_id IS NULL THEN
    INSERT INTO public.programme_enrollments (id, user_id, coachee_id, programme_id, cohort_id, status, start_date, end_date, progress_pct, notes)
    VALUES ('ca8c53c0-424e-4cfb-9e48-908bc995f21d', v_trang_id, v_trang_id, v_programme_id, v_cohort_id, 'active', '2026-09-08'::date, '2026-10-06'::date, 55, 'Pilot participant — joined from day 1')
    RETURNING id INTO v_enrollment_id;
  ELSE
    UPDATE public.programme_enrollments SET cohort_id = v_cohort_id, status = 'active', start_date = '2026-09-08'::date, end_date = '2026-10-06'::date, progress_pct = 55, notes = 'Pilot participant — joined from day 1' WHERE id = v_enrollment_id;
  END IF;

  -- 10. Coachee goals, ratings, milestones (added alongside any pre-existing goals)
  INSERT INTO public.coachee_goals (id, coachee_id, title, description, status, sort_order, shared_with_sponsor, target_date)
  VALUES ('d0000000-0000-0000-0000-000000000001', v_trang_id, 'Ask powerful questions instead of giving advice', 'Break the habit of jumping to solutions in conversations. Practice open-ended questions that help others find their own answers.', 'active', 1, true, '2026-10-06'::date)
  ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, status = EXCLUDED.status, sort_order = EXCLUDED.sort_order, shared_with_sponsor = EXCLUDED.shared_with_sponsor, target_date = EXCLUDED.target_date;
  INSERT INTO public.coachee_goal_ratings (goal_id, coachee_id, start_rating, current_rating, target_rating)
  VALUES ('d0000000-0000-0000-0000-000000000001', v_trang_id, 3, 6, 8)
  ON CONFLICT (goal_id) DO UPDATE SET start_rating = EXCLUDED.start_rating, current_rating = EXCLUDED.current_rating, target_rating = EXCLUDED.target_rating;
  INSERT INTO public.coachee_milestones (id, goal_id, coachee_id, title, sort_order, is_done, done_at)
  VALUES ('c0f4e166-8583-40ef-92dd-a532b356eaf1', 'd0000000-0000-0000-0000-000000000001', v_trang_id, 'Complete one full conversation using only questions', 1, true, '2026-09-12T10:00:00Z'::timestamptz)
  ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, sort_order = EXCLUDED.sort_order, is_done = EXCLUDED.is_done, done_at = EXCLUDED.done_at;
  INSERT INTO public.coachee_milestones (id, goal_id, coachee_id, title, sort_order, is_done, done_at)
  VALUES ('138703eb-7920-4215-aa37-61b9a80ee673', 'd0000000-0000-0000-0000-000000000001', v_trang_id, 'Get feedback from peer on questioning quality', 2, true, '2026-09-19T14:00:00Z'::timestamptz)
  ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, sort_order = EXCLUDED.sort_order, is_done = EXCLUDED.is_done, done_at = EXCLUDED.done_at;
  INSERT INTO public.coachee_milestones (id, goal_id, coachee_id, title, sort_order, is_done, done_at)
  VALUES ('733d58ce-0c64-4a65-bf81-55dd658de3a0', 'd0000000-0000-0000-0000-000000000001', v_trang_id, 'Apply powerful questions in a real work meeting', 3, false, NULL)
  ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, sort_order = EXCLUDED.sort_order, is_done = EXCLUDED.is_done, done_at = EXCLUDED.done_at;
  INSERT INTO public.coachee_goals (id, coachee_id, title, description, status, sort_order, shared_with_sponsor, target_date)
  VALUES ('d0000000-0000-0000-0000-000000000002', v_trang_id, 'Structure conversations using the SHIFT model', 'Be able to guide a complete 30-minute coaching conversation through all five SHIFT stages without losing the client or rushing to action.', 'active', 2, true, '2026-10-06'::date)
  ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, status = EXCLUDED.status, sort_order = EXCLUDED.sort_order, shared_with_sponsor = EXCLUDED.shared_with_sponsor, target_date = EXCLUDED.target_date;
  INSERT INTO public.coachee_goal_ratings (goal_id, coachee_id, start_rating, current_rating, target_rating)
  VALUES ('d0000000-0000-0000-0000-000000000002', v_trang_id, 2, 5, 8)
  ON CONFLICT (goal_id) DO UPDATE SET start_rating = EXCLUDED.start_rating, current_rating = EXCLUDED.current_rating, target_rating = EXCLUDED.target_rating;
  INSERT INTO public.coachee_goals (id, coachee_id, title, description, status, sort_order, shared_with_sponsor, target_date)
  VALUES ('d0000000-0000-0000-0000-000000000003', v_trang_id, 'Hold silence without filling it', 'Develop comfort with 5-10 seconds of silence after asking a question, giving the client space to think deeply.', 'active', 3, false, '2026-10-06'::date)
  ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, status = EXCLUDED.status, sort_order = EXCLUDED.sort_order, shared_with_sponsor = EXCLUDED.shared_with_sponsor, target_date = EXCLUDED.target_date;
  INSERT INTO public.coachee_goal_ratings (goal_id, coachee_id, start_rating, current_rating, target_rating)
  VALUES ('d0000000-0000-0000-0000-000000000003', v_trang_id, 2, 4, 7)
  ON CONFLICT (goal_id) DO UPDATE SET start_rating = EXCLUDED.start_rating, current_rating = EXCLUDED.current_rating, target_rating = EXCLUDED.target_rating;

  -- 11. Coaching sessions with coach1
  INSERT INTO public.sessions (id, coach_id, coachee_id, topic, start_time, duration_minutes, status, confirmed_at, meeting_url, coach_notes, coachee_notes, action_items, coachee_rating, coachee_rated_at, coachee_rating_comment)
  VALUES ('e0000000-0000-0000-0000-000000000001', v_coach1_id, v_trang_id, 'Understanding my coaching mindset — where I default to advice-giving', '2026-09-10T09:00:00+07:00'::timestamptz, 60, 'completed', '2026-09-09T10:00:00Z'::timestamptz, 'https://zoom.us/j/1234567890', 'Trang showed strong self-awareness about her advice-giving tendency. We explored the gap between knowing she should ask questions and actually doing it under pressure. She identified that her trigger is when someone looks stressed — she instinctively wants to "fix" the situation. We agreed she would practice noticing the trigger without acting on it for one week. Good energy, very coachable.', 'I realised that my urge to give advice comes from wanting to help quickly, but it actually takes away the other person''s chance to find their own solution. The question "What would you do if you trusted yourself to figure this out?" really landed for me. I want to use it more.', '[{"text":"Notice the advice-giving trigger 3 times this week without acting on it","done":true},{"text":"Write down one powerful question after each team meeting","done":true},{"text":"Re-read Erickson Principle 2: People already have all the resources they need","done":false}]'::jsonb, 5, '2026-09-10T10:30:00Z'::timestamptz, 'Very helpful first session. My coach helped me see a pattern I was blind to. Looking forward to the next one.')
  ON CONFLICT (id) DO UPDATE SET topic = EXCLUDED.topic, start_time = EXCLUDED.start_time, status = EXCLUDED.status, coach_notes = EXCLUDED.coach_notes, coachee_notes = EXCLUDED.coachee_notes, action_items = EXCLUDED.action_items, coachee_rating = EXCLUDED.coachee_rating, coachee_rating_comment = EXCLUDED.coachee_rating_comment;
  INSERT INTO public.session_goal_ratings (session_id, goal_id, coachee_id, rating, note)
  VALUES ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', v_trang_id, 4, 'Starting to notice the pattern, not yet changing it')
  ON CONFLICT (session_id, goal_id) DO UPDATE SET rating = EXCLUDED.rating, note = EXCLUDED.note;
  INSERT INTO public.session_goal_ratings (session_id, goal_id, coachee_id, rating, note)
  VALUES ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', v_trang_id, 3, 'Just introduced to SHIFT, haven''t practiced yet')
  ON CONFLICT (session_id, goal_id) DO UPDATE SET rating = EXCLUDED.rating, note = EXCLUDED.note;
  INSERT INTO public.session_goal_ratings (session_id, goal_id, coachee_id, rating, note)
  VALUES ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003', v_trang_id, 2, 'Silence still feels very uncomfortable')
  ON CONFLICT (session_id, goal_id) DO UPDATE SET rating = EXCLUDED.rating, note = EXCLUDED.note;
  INSERT INTO public.coach_session_private_notes (session_id, coach_id, body)
  VALUES ('e0000000-0000-0000-0000-000000000001', v_coach1_id, 'Strong participant. Emotional intelligence is high — she just needs permission to slow down. Watch for perfectionism as a blocker later in the programme. Consider introducing the "scaling question" technique next session.')
  ON CONFLICT (session_id) DO UPDATE SET body = EXCLUDED.body;
  INSERT INTO public.session_messages (id, session_id, sender_id, body, created_at, read_at)
  VALUES ('0e332e82-9499-4ef1-9d29-786ff1103d21', 'e0000000-0000-0000-0000-000000000001', v_trang_id, 'Hi! Looking forward to our first session. I''ve been reading the Week 1 skill card and Erickson''s 5 principles really resonated with me, especially "People already have all the resources they need." I''d like to explore why I still default to giving advice even when I believe this.', '2026-09-09T14:00:00Z'::timestamptz, NULL)
  ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, read_at = EXCLUDED.read_at;
  INSERT INTO public.session_messages (id, session_id, sender_id, body, created_at, read_at)
  VALUES ('0073b379-d1a9-4968-a1d7-c9e8a0e1f95e', 'e0000000-0000-0000-0000-000000000001', v_coach1_id, 'Great topic to start with, Trang. That gap between belief and behaviour is exactly the space coaching works in. Come ready to think about a specific recent example where you noticed yourself advising instead of asking. See you tomorrow!', '2026-09-09T15:30:00Z'::timestamptz, '2026-09-09T16:00:00Z'::timestamptz)
  ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, read_at = EXCLUDED.read_at;
  INSERT INTO public.sessions (id, coach_id, coachee_id, topic, start_time, duration_minutes, status, confirmed_at, meeting_url, coach_notes, coachee_notes, action_items, coachee_rating, coachee_rated_at, coachee_rating_comment)
  VALUES ('e0000000-0000-0000-0000-000000000002', v_coach1_id, v_trang_id, 'Practicing the SHIFT model — where I get stuck between H and I', '2026-09-24T09:00:00+07:00'::timestamptz, 60, 'completed', '2026-09-23T08:00:00Z'::timestamptz, 'https://zoom.us/j/1234567891', 'Clear progress since session 1. Trang''s awareness of the advice trigger has improved noticeably — she caught herself twice during our conversation and self-corrected. Main challenge today: she can hold the "H" (hear current situation) stage well, but jumps to "T" (take action) without fully exploring "I" (desired outcome). We did a live practice where I coached her through a real scenario and she mapped it to SHIFT afterward. She saw the gap clearly. Homework: practice "I" stage with her triad group.', 'I can see that I skip over asking people what they actually want and go straight to "so what will you do about it?" My coach showed me how spending more time on the vision (I stage) actually makes the action step clearer and more motivating. The question "What will be different when this is working?" is now my favourite tool.', '[{"text":"In triad practice this week, specifically focus on spending 10 minutes in the I stage","done":false},{"text":"Ask three colleagues: What does success look like for you on this project?","done":true},{"text":"Journal: What am I noticing about my own growth as a coach?","done":false}]'::jsonb, 5, '2026-09-24T10:15:00Z'::timestamptz, 'I can feel my coaching improving. The SHIFT model practice was exactly what I needed. My coach is patient and precise.')
  ON CONFLICT (id) DO UPDATE SET topic = EXCLUDED.topic, start_time = EXCLUDED.start_time, status = EXCLUDED.status, coach_notes = EXCLUDED.coach_notes, coachee_notes = EXCLUDED.coachee_notes, action_items = EXCLUDED.action_items, coachee_rating = EXCLUDED.coachee_rating, coachee_rating_comment = EXCLUDED.coachee_rating_comment;
  INSERT INTO public.session_goal_ratings (session_id, goal_id, coachee_id, rating, note)
  VALUES ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', v_trang_id, 6, 'Caught myself twice and chose to ask a question instead')
  ON CONFLICT (session_id, goal_id) DO UPDATE SET rating = EXCLUDED.rating, note = EXCLUDED.note;
  INSERT INTO public.session_goal_ratings (session_id, goal_id, coachee_id, rating, note)
  VALUES ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', v_trang_id, 5, 'Can do S-H-I but still rushing to T')
  ON CONFLICT (session_id, goal_id) DO UPDATE SET rating = EXCLUDED.rating, note = EXCLUDED.note;
  INSERT INTO public.session_goal_ratings (session_id, goal_id, coachee_id, rating, note)
  VALUES ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000003', v_trang_id, 4, 'Managed 5 seconds of silence in practice — it felt like a minute')
  ON CONFLICT (session_id, goal_id) DO UPDATE SET rating = EXCLUDED.rating, note = EXCLUDED.note;
  INSERT INTO public.coach_session_private_notes (session_id, coach_id, body)
  VALUES ('e0000000-0000-0000-0000-000000000002', v_coach1_id, 'She is ready for a real coaching practicum now. Her self-correction speed has improved dramatically. Consider suggesting she volunteer to coach first in the triad session — she will learn more from doing than watching at this stage.')
  ON CONFLICT (session_id) DO UPDATE SET body = EXCLUDED.body;

  -- Coach client notes
  INSERT INTO public.coach_client_notes (id, coach_id, coachee_id, body)
  VALUES ('ecb84e7e-98ae-4022-ad85-649c027f70b5', v_coach1_id, v_trang_id, 'Trang is highly motivated and self-aware. Main development edges: (1) trusting silence, (2) staying in the "I" stage of SHIFT longer before jumping to action. She responds very well to experiential learning — practice > theory for her. Trigger pattern: advice-giving activates when she sees someone in distress. Possible root: strong caretaker identity. Not therapeutic territory — keep coaching-focused on the behaviour, not the identity.')
  ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body;

  -- 12. Peer coaching session (Trang as peer-coachee)
  INSERT INTO public.peer_sessions (id, peer_coach_id, peer_coachee_id, topic, start_time, duration_minutes, status, confirmed_at, meeting_url, coach_notes, coachee_notes, action_items, coachee_rating, coachee_rated_at, coachee_rating_comment)
  VALUES ('e0000000-0000-0000-0000-000000000010', v_coach2_id, v_trang_id, 'Peer practice: Coaching Trang through a real workplace challenge using open questions only', '2026-09-17T14:00:00+07:00'::timestamptz, 45, 'completed', '2026-09-16T10:00:00Z'::timestamptz, 'https://zoom.us/j/9876543210', 'Practiced staying in Level 2 listening throughout. I noticed that when Trang talked about her team lead frustration, I almost gave advice three times but caught myself. The question "What would your ideal outcome look like?" opened up the conversation significantly. Need to work on my pacing — I asked follow-up questions too quickly without giving space.', 'My peer coach asked really good open questions. The one that unlocked things for me was "If you could redesign this relationship from scratch, what would it look like?" I hadn''t thought about it that way before. Feedback: sometimes the questions came very quickly one after another — a bit more silence would have helped me think.', '[{"text":"Try the redesign question with my own team member","done":true},{"text":"Give peer coach written feedback on their questioning technique","done":true}]'::jsonb, 4, '2026-09-17T15:00:00Z'::timestamptz, 'Good session — I felt genuinely heard. Would benefit from more pauses between questions.')
  ON CONFLICT (id) DO UPDATE SET topic = EXCLUDED.topic, coach_notes = EXCLUDED.coach_notes, coachee_notes = EXCLUDED.coachee_notes, action_items = EXCLUDED.action_items, coachee_rating = EXCLUDED.coachee_rating, coachee_rating_comment = EXCLUDED.coachee_rating_comment;
  INSERT INTO public.peer_session_competency_feedback (id, peer_session_id, peer_coach_id, peer_coachee_id, ethical_practice, coaching_mindset, maintains_agreements, trust_safety, maintains_presence, listens_actively, evokes_awareness, facilitates_growth, feedback_note)
  VALUES ('b2eaccd3-ab53-4ca6-a409-a4b6805519b3', 'e0000000-0000-0000-0000-000000000010', v_coach2_id, v_trang_id, 8, 7, 8, 9, 6, 7, 8, 7, 'Strong on creating trust and safety — I felt comfortable sharing real challenges. The area for growth is maintaining presence: sometimes the next question came before I finished processing the last one. Overall, a very supportive and growth-oriented session.')
  ON CONFLICT (peer_session_id) DO UPDATE SET ethical_practice = EXCLUDED.ethical_practice, coaching_mindset = EXCLUDED.coaching_mindset, maintains_agreements = EXCLUDED.maintains_agreements, trust_safety = EXCLUDED.trust_safety, maintains_presence = EXCLUDED.maintains_presence, listens_actively = EXCLUDED.listens_actively, evokes_awareness = EXCLUDED.evokes_awareness, facilitates_growth = EXCLUDED.facilitates_growth, feedback_note = EXCLUDED.feedback_note;
  INSERT INTO public.peer_coach_session_private_notes (peer_session_id, peer_coach_id, body)
  VALUES ('e0000000-0000-0000-0000-000000000010', v_coach2_id, 'Trang is an excellent practice partner — brings real topics. My main learning: I need to count to 5 after asking a question before speaking again. She gave me feedback about pacing which matches what my mentor told me last week. Pattern confirmed — this is my #1 development area.')
  ON CONFLICT (peer_session_id) DO UPDATE SET body = EXCLUDED.body;

  -- 13. Mentoring session + feedback
  INSERT INTO public.mentoring_sessions (id, mentor_id, mentee_id, topic, start_time, duration_minutes, status, confirmed_at, meeting_url, mentor_notes, mentee_notes, action_items, prep_file_path, prep_file_notes, prep_file_submitted_at, feedback_submitted_at)
  VALUES ('e0000000-0000-0000-0000-000000000020', v_coach1_id, v_trang_id, 'Mentoring: Developing my coaching presence and working with silence', '2026-09-19T10:00:00+07:00'::timestamptz, 60, 'completed', '2026-09-18T09:00:00Z'::timestamptz, 'https://zoom.us/j/5555555555', 'Trang is progressing well. Today we focused specifically on her discomfort with silence. I demonstrated a coaching conversation where I deliberately used 8-10 second pauses. She observed that the client (me role-playing) actually produced deeper insights after the longer pauses. She then practiced: her first pause was 3 seconds, her last was 7 seconds. Significant growth in one session. Recommended: practice the "pregnant pause" technique in her triad group.', 'My mentor showed me that silence is not awkward — it is generous. When they paused for almost 10 seconds after my answer, I found myself going deeper without being prompted. I want to master this. The key insight: silence is a coaching tool, not a gap to fill.', '[{"text":"Practice 7-second pauses in triad session this week","done":false},{"text":"Record a practice session and count my average pause length","done":false},{"text":"Read the ICF competency on Maintains Presence","done":true}]'::jsonb, 'mentoring-prep/trang-session-1-prep.pdf', 'I want to focus on: (1) why silence feels uncomfortable for me, (2) how to use silence as a tool not just endure it, (3) how my mentor handles silence in their own coaching practice.', '2026-09-18T14:00:00Z'::timestamptz, '2026-09-19T11:30:00Z'::timestamptz)
  ON CONFLICT (id) DO UPDATE SET topic = EXCLUDED.topic, mentor_notes = EXCLUDED.mentor_notes, mentee_notes = EXCLUDED.mentee_notes, action_items = EXCLUDED.action_items, prep_file_path = EXCLUDED.prep_file_path, prep_file_notes = EXCLUDED.prep_file_notes;
  INSERT INTO public.mentoring_feedback (id, mentoring_session_id, mentor_id, mentee_id, ethical_practice, coaching_mindset, maintains_agreements, trust_safety, maintains_presence, listens_actively, evokes_awareness, facilitates_growth, overall_notes, submitted_by, submitted_at)
  VALUES ('5324c8ef-e2f8-4fe5-b089-377fe1fbdf48', 'e0000000-0000-0000-0000-000000000020', v_coach1_id, v_trang_id, 'Strong — Trang is clear about boundaries between coaching, advising, and therapy. No concerns.', 'Excellent progress. She genuinely believes in client resourcefulness and is actively working to let go of the "fixer" identity. This is her biggest growth edge and she is leaning into it.', 'Good — she sets clear session topics. Area to develop: explicitly re-contracting mid-session when the topic shifts, rather than just following the energy.', 'Natural strength. Clients and peers report feeling very safe with her. Warm, non-judgmental presence.', 'This is where the main work is. She is aware of her discomfort with silence and actively working on it. Progress: from 2-3 second pauses to 5-7 seconds in today''s session. Recommend continued deliberate practice.', 'Good Level 2 listening. Starting to pick up on what is NOT said, which is Level 3 territory. Encourage her to trust these intuitions and name them: "I notice you didn''t mention X — is that significant?"', 'Strong questioning instincts. Her questions are becoming shorter and more powerful. Favourite today: "What would you do if you already knew the answer?" Beautiful.', 'Trang consistently moves sessions toward action. Her growth area is spending more time in the visioning/desired-outcome space before jumping to commitment. This maps directly to the SHIFT model I-to-T transition she is working on in her coaching sessions.', 'Trang is one of the strongest participants in this cohort. Her self-awareness and willingness to be uncomfortable are exceptional. If she continues at this pace, she will be ready for ACC-level practice within 3 months. Recommend: (1) increase practice hours, (2) seek more diverse practice clients, (3) consider applying for ICF ACC credential by Q1 2027.', v_coach1_id, '2026-09-19T11:30:00Z'::timestamptz)
  ON CONFLICT (mentoring_session_id) DO UPDATE SET ethical_practice = EXCLUDED.ethical_practice, coaching_mindset = EXCLUDED.coaching_mindset, maintains_agreements = EXCLUDED.maintains_agreements, trust_safety = EXCLUDED.trust_safety, maintains_presence = EXCLUDED.maintains_presence, listens_actively = EXCLUDED.listens_actively, evokes_awareness = EXCLUDED.evokes_awareness, facilitates_growth = EXCLUDED.facilitates_growth, overall_notes = EXCLUDED.overall_notes;

  -- 14. Triad group, session, reflections (requires 2 other coachees)
  IF v_peer1_id IS NOT NULL AND v_peer2_id IS NOT NULL AND v_peer1_id <> v_peer2_id THEN
    INSERT INTO public.triad_groups (id, programme_id, triad_round_id, member_1_id, member_2_id, member_3_id, name, is_active, assigned_by, group_language)
    VALUES ('f0000000-0000-0000-0000-000000000001', v_programme_id, v_round1_id, v_trang_id, v_peer1_id, v_peer2_id, 'Triad Alpha', true, 'admin', 'vi')
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_active = EXCLUDED.is_active;
    INSERT INTO public.triad_sessions (id, triad_group_id, proposed_start_time, proposed_end_time, proposed_by, status, meeting_url, notes, member_1_response, member_2_response, member_3_response)
    VALUES ('e0000000-0000-0000-0000-000000000030', 'f0000000-0000-0000-0000-000000000001', '2026-09-20T15:00:00+07:00'::timestamptz, '2026-09-20T16:30:00+07:00'::timestamptz, v_trang_id::text, 'completed', 'https://zoom.us/j/7777777777', 'Round 1 practice session. Trang coached, Peer1 was coachee, Peer2 observed. Topic: Peer1''s challenge with delegating to a new team member. 25-minute coaching conversation followed by 15 minutes of observer feedback and group debrief.', 'accepted', 'accepted', 'accepted')
    ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, notes = EXCLUDED.notes;
    INSERT INTO public.triad_reflections (id, triad_session_id, participant_id, learned_as_coach, will_use_as_coach, learned_as_coachee, will_use_as_coachee, learned_as_observer, will_use_as_observer, satisfaction_rating, submitted_at)
    VALUES ('a7528819-bb95-4b29-a011-76c2cfa7c637', 'e0000000-0000-0000-0000-000000000030', v_trang_id, 'I learned that I can actually hold a 25-minute coaching conversation using SHIFT without running out of things to ask. My biggest learning: when I trusted the silence after asking "What does successful delegation look like for you?", my coachee gave a much deeper answer than I expected. I also noticed I skipped the S stage — next time I need to explicitly contract the session at the start.', 'I will explicitly set the foundation (S stage) by asking "What would make this conversation valuable for you?" at the very start of every practice session from now on. I will also aim for at least 5-second pauses after every question.', NULL, NULL, NULL, NULL, 5, '2026-09-20T17:00:00Z'::timestamptz)
    ON CONFLICT (triad_session_id, participant_id) DO UPDATE SET learned_as_coach = EXCLUDED.learned_as_coach, will_use_as_coach = EXCLUDED.will_use_as_coach, learned_as_coachee = EXCLUDED.learned_as_coachee, will_use_as_coachee = EXCLUDED.will_use_as_coachee, learned_as_observer = EXCLUDED.learned_as_observer, will_use_as_observer = EXCLUDED.will_use_as_observer, satisfaction_rating = EXCLUDED.satisfaction_rating;
    INSERT INTO public.triad_reflections (id, triad_session_id, participant_id, learned_as_coach, will_use_as_coach, learned_as_coachee, will_use_as_coachee, learned_as_observer, will_use_as_observer, satisfaction_rating, submitted_at)
    VALUES ('157da989-e0e7-4a40-9695-a482bbc44fa5', 'e0000000-0000-0000-0000-000000000030', v_peer1_id, NULL, NULL, 'Being coached by a peer feels different from being coached by our professional coach — in a good way. Trang asked me "If you trusted this person to figure it out, what would you do differently?" and I realised I was micromanaging because I didn''t trust my new team member yet. That was a breakthrough. The silence after some questions felt long but productive.', 'I am going to have an honest conversation with my new team member about what "good enough" looks like for their first deliverables, instead of reviewing every detail.', NULL, NULL, 5, '2026-09-20T17:15:00Z'::timestamptz)
    ON CONFLICT (triad_session_id, participant_id) DO UPDATE SET learned_as_coach = EXCLUDED.learned_as_coach, will_use_as_coach = EXCLUDED.will_use_as_coach, learned_as_coachee = EXCLUDED.learned_as_coachee, will_use_as_coachee = EXCLUDED.will_use_as_coachee, learned_as_observer = EXCLUDED.learned_as_observer, will_use_as_observer = EXCLUDED.will_use_as_observer, satisfaction_rating = EXCLUDED.satisfaction_rating;
    INSERT INTO public.triad_reflections (id, triad_session_id, participant_id, learned_as_coach, will_use_as_coach, learned_as_coachee, will_use_as_coachee, learned_as_observer, will_use_as_observer, satisfaction_rating, submitted_at)
    VALUES ('80375f58-7a46-4ef9-bbea-9f0781e82a7a', 'e0000000-0000-0000-0000-000000000030', v_peer2_id, NULL, NULL, NULL, NULL, 'Watching from the outside, I could clearly see the SHIFT stages unfolding. Trang spent about 5 minutes in H (hearing the situation), then moved to I (identifying desired outcome) with the question about what delegation success looks like. I noticed she jumped over F (finding resources) and went straight to T (action). When I pointed this out in the debrief, she agreed and said she would work on that. As observer, I also noticed that the moments of silence produced the richest client responses — something I want to remember for my own coaching practice.', 'In my next observation, I want to explicitly track time spent in each SHIFT stage and share that data with the coach as quantitative feedback.', 4, '2026-09-20T17:30:00Z'::timestamptz)
    ON CONFLICT (triad_session_id, participant_id) DO UPDATE SET learned_as_coach = EXCLUDED.learned_as_coach, will_use_as_coach = EXCLUDED.will_use_as_coach, learned_as_coachee = EXCLUDED.learned_as_coachee, will_use_as_coachee = EXCLUDED.will_use_as_coachee, learned_as_observer = EXCLUDED.learned_as_observer, will_use_as_observer = EXCLUDED.will_use_as_observer, satisfaction_rating = EXCLUDED.satisfaction_rating;
  ELSE
    RAISE NOTICE 'Fewer than 2 other coachees found — skipping triad group/session/reflections seed';
  END IF;

  -- 15. Coachee journal reflections
  INSERT INTO public.coachee_reflections (id, coachee_id, body, mood, created_at)
  VALUES ('67cf35e3-3025-4fac-b59e-5020d2d32e07', v_trang_id, 'Week 1 reflection: I came into this programme thinking coaching was about asking better questions. Now I realise it starts before the questions — with believing that the person in front of me already has what they need. That shift in belief changes everything about how I show up in conversations. I noticed today that when I stopped trying to "help" my colleague and just asked what she wanted to happen, she came up with a solution I would never have thought of. Erickson was right: people are creative, resourceful, and whole.', 'energized', '2026-09-12T20:00:00Z'::timestamptz)
  ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, mood = EXCLUDED.mood;
  INSERT INTO public.coachee_reflections (id, coachee_id, body, mood, created_at)
  VALUES ('afdae448-bf10-4188-9ba0-6ee9950b2e69', v_trang_id, 'Week 3 reflection: The SHIFT model is becoming more intuitive but I still rush through it. Today in practice I spent 15 of my 25 minutes in the H stage (hearing the situation) and only 3 minutes in I (desired outcome). My observer pointed out that I was "swimming in the problem" instead of pivoting to what the client wanted. This is my next edge. The good news: my silence is improving. I held a 7-second pause today and my practice client said she appreciated the thinking space. Small wins.', 'reflective', '2026-09-25T21:00:00Z'::timestamptz)
  ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, mood = EXCLUDED.mood;

  -- 16. Training progress
  INSERT INTO public.training_progress (id, user_id, training_week_id, viewed_at, completed_at, pdf_downloaded_at)
  VALUES ('de78c2af-aca9-4104-892a-5324b133521a', v_trang_id, v_week1_id, '2026-09-08T08:00:00Z'::timestamptz, '2026-09-12T18:00:00Z'::timestamptz, '2026-09-08T08:15:00Z'::timestamptz)
  ON CONFLICT (user_id, training_week_id) DO UPDATE SET viewed_at = EXCLUDED.viewed_at, completed_at = EXCLUDED.completed_at, pdf_downloaded_at = EXCLUDED.pdf_downloaded_at;
  INSERT INTO public.training_progress (id, user_id, training_week_id, viewed_at, completed_at, pdf_downloaded_at)
  VALUES ('e5279b00-bd6f-4a59-be22-c4bfb653d47b', v_trang_id, v_week2_id, '2026-09-15T08:00:00Z'::timestamptz, '2026-09-19T17:00:00Z'::timestamptz, '2026-09-15T09:00:00Z'::timestamptz)
  ON CONFLICT (user_id, training_week_id) DO UPDATE SET viewed_at = EXCLUDED.viewed_at, completed_at = EXCLUDED.completed_at, pdf_downloaded_at = EXCLUDED.pdf_downloaded_at;
  INSERT INTO public.training_progress (id, user_id, training_week_id, viewed_at, completed_at, pdf_downloaded_at)
  VALUES ('011461bb-52d3-44fd-9648-6c02e5553a12', v_trang_id, v_week3_id, '2026-09-22T08:00:00Z'::timestamptz, '2026-09-26T16:00:00Z'::timestamptz, '2026-09-22T08:30:00Z'::timestamptz)
  ON CONFLICT (user_id, training_week_id) DO UPDATE SET viewed_at = EXCLUDED.viewed_at, completed_at = EXCLUDED.completed_at, pdf_downloaded_at = EXCLUDED.pdf_downloaded_at;
  INSERT INTO public.training_progress (id, user_id, training_week_id, viewed_at, completed_at, pdf_downloaded_at)
  VALUES ('b7b206f9-8b6a-410a-a767-531df7d8bb3e', v_trang_id, v_week4_id, '2026-09-29T08:00:00Z'::timestamptz, NULL, NULL)
  ON CONFLICT (user_id, training_week_id) DO UPDATE SET viewed_at = EXCLUDED.viewed_at, completed_at = EXCLUDED.completed_at, pdf_downloaded_at = EXCLUDED.pdf_downloaded_at;

  -- 17. Daily prompt responses (all 20 prompts across 4 weeks)
  INSERT INTO public.daily_prompt_responses (id, daily_prompt_id, user_id, opened_at, response_text, responded_at)
  VALUES ('70090cae-a21b-4b6e-9ba6-f41208703e7d', 'c1000000-0000-0000-0000-000000000011', v_trang_id, '2026-09-08T08:30:00Z'::timestamptz, 'I had a conversation with my team lead about a project delay. I shifted from listening to advising almost immediately — within 30 seconds. I suggested she restructure the timeline before she even finished explaining the problem. If I had asked "What do you think would help?" she might have come up with something better. Lesson: my instinct to advise is fast and automatic.', '2026-09-08T12:00:00Z'::timestamptz)
  ON CONFLICT (daily_prompt_id, user_id) DO UPDATE SET opened_at = EXCLUDED.opened_at, response_text = EXCLUDED.response_text, responded_at = EXCLUDED.responded_at;
  INSERT INTO public.daily_prompt_responses (id, daily_prompt_id, user_id, opened_at, response_text, responded_at)
  VALUES ('fa1e49f1-43e7-4361-b901-359b0d863383', 'c1000000-0000-0000-0000-000000000012', v_trang_id, '2026-09-09T08:15:00Z'::timestamptz, 'Principle 2 — "People already have all the resources they need" — feels most natural to me intellectually, but the hardest to live. I believe it in theory, but in practice I still jump in to help. Principle 5 — "Change is inevitable" — is the one I find most comforting. It reminds me that even when progress feels slow, the fact that I am in this programme means something is already shifting.', '2026-09-09T13:00:00Z'::timestamptz)
  ON CONFLICT (daily_prompt_id, user_id) DO UPDATE SET opened_at = EXCLUDED.opened_at, response_text = EXCLUDED.response_text, responded_at = EXCLUDED.responded_at;
  INSERT INTO public.daily_prompt_responses (id, daily_prompt_id, user_id, opened_at, response_text, responded_at)
  VALUES ('038f6b31-690d-447a-936b-662ec0bcb783', 'c1000000-0000-0000-0000-000000000013', v_trang_id, '2026-09-10T08:20:00Z'::timestamptz, 'I watched my director in a strategy meeting. She asked "What are we not seeing?" and then waited. She literally leaned back in her chair and waited for someone to speak. It took about 8 seconds. Then three people jumped in with ideas that were much more creative than the original direction. She creates space by physically slowing down and staying quiet.', '2026-09-10T18:00:00Z'::timestamptz)
  ON CONFLICT (daily_prompt_id, user_id) DO UPDATE SET opened_at = EXCLUDED.opened_at, response_text = EXCLUDED.response_text, responded_at = EXCLUDED.responded_at;
  INSERT INTO public.daily_prompt_responses (id, daily_prompt_id, user_id, opened_at, response_text, responded_at)
  VALUES ('5f11bc91-e157-45db-b0ef-c08708150fef', 'c1000000-0000-0000-0000-000000000014', v_trang_id, '2026-09-11T08:10:00Z'::timestamptz, 'In a 1:1 with a junior colleague, I assumed she was struggling with the analytics tool because she seemed frustrated. I started explaining the shortcut keys. But she was actually frustrated about something completely different — a miscommunication with another department. My assumption was wrong, and my "help" was irrelevant. Lesson: ask before assuming.', '2026-09-11T19:30:00Z'::timestamptz)
  ON CONFLICT (daily_prompt_id, user_id) DO UPDATE SET opened_at = EXCLUDED.opened_at, response_text = EXCLUDED.response_text, responded_at = EXCLUDED.responded_at;
  INSERT INTO public.daily_prompt_responses (id, daily_prompt_id, user_id, opened_at, response_text, responded_at)
  VALUES ('17a126cf-d983-4d1d-80de-b19f7e19e707', 'c1000000-0000-0000-0000-000000000015', v_trang_id, '2026-09-12T08:05:00Z'::timestamptz, 'The hardest part of only asking questions for an hour would be resisting the urge to share my own experience. When someone tells me about a challenge, my brain immediately generates "I had the same thing happen, and here is what I did…" Cutting that off would feel unnatural but might let the other person go deeper. I would probably discover that people can solve most of their own problems when given space.', '2026-09-12T17:45:00Z'::timestamptz)
  ON CONFLICT (daily_prompt_id, user_id) DO UPDATE SET opened_at = EXCLUDED.opened_at, response_text = EXCLUDED.response_text, responded_at = EXCLUDED.responded_at;
  INSERT INTO public.daily_prompt_responses (id, daily_prompt_id, user_id, opened_at, response_text, responded_at)
  VALUES ('7ab16e81-598b-4675-9c76-e376dd495644', 'c1000000-0000-0000-0000-000000000021', v_trang_id, '2026-09-15T08:10:00Z'::timestamptz, 'A colleague asked me "What would you do if this project belonged entirely to you?" It made me stop because I realised I had been treating it as someone else''s decision to make, even though I was the one responsible. What made it powerful was that it exposed an assumption I didn''t know I was carrying.', '2026-09-15T12:30:00Z'::timestamptz)
  ON CONFLICT (daily_prompt_id, user_id) DO UPDATE SET opened_at = EXCLUDED.opened_at, response_text = EXCLUDED.response_text, responded_at = EXCLUDED.responded_at;
  INSERT INTO public.daily_prompt_responses (id, daily_prompt_id, user_id, opened_at, response_text, responded_at)
  VALUES ('5e36de25-9333-476b-9eb0-86a9c34bb02a', 'c1000000-0000-0000-0000-000000000022', v_trang_id, '2026-09-16T08:05:00Z'::timestamptz, 'I practiced Level 2 listening with my husband over dinner. I noticed his pace slowed down when he talked about work stress, and there was a pause before he mentioned his manager''s name — I think that pause meant something. I usually would have missed both of those signals because I am normally halfway to a response while he is still talking.', '2026-09-16T20:00:00Z'::timestamptz)
  ON CONFLICT (daily_prompt_id, user_id) DO UPDATE SET opened_at = EXCLUDED.opened_at, response_text = EXCLUDED.response_text, responded_at = EXCLUDED.responded_at;
  INSERT INTO public.daily_prompt_responses (id, daily_prompt_id, user_id, opened_at, response_text, responded_at)
  VALUES ('efcbef56-f803-4f44-85d4-31e047af87d1', 'c1000000-0000-0000-0000-000000000023', v_trang_id, '2026-09-17T08:00:00Z'::timestamptz, '1) What would it look like if this already felt manageable? 2) What have you already tried that gave you even a small result? 3) What do you actually want to happen here? I had to rewrite the third one twice — my first draft was "Have you thought about talking to your manager?", which is advice, not a question.', '2026-09-17T21:00:00Z'::timestamptz)
  ON CONFLICT (daily_prompt_id, user_id) DO UPDATE SET opened_at = EXCLUDED.opened_at, response_text = EXCLUDED.response_text, responded_at = EXCLUDED.responded_at;
  INSERT INTO public.daily_prompt_responses (id, daily_prompt_id, user_id, opened_at, response_text, responded_at)
  VALUES ('e0580d04-ef63-45f7-a812-c3013769ac04', 'c1000000-0000-0000-0000-000000000024', v_trang_id, '2026-09-18T08:00:00Z'::timestamptz, 'My first instinct was to solve — I immediately started thinking of three possible fixes before my colleague had finished her sentence. That tells me my default mode is still "fixer," not "asker." I caught it this time and asked a question instead, but it took real effort. This is clearly the pattern I need to keep working on.', '2026-09-18T14:00:00Z'::timestamptz)
  ON CONFLICT (daily_prompt_id, user_id) DO UPDATE SET opened_at = EXCLUDED.opened_at, response_text = EXCLUDED.response_text, responded_at = EXCLUDED.responded_at;
  INSERT INTO public.daily_prompt_responses (id, daily_prompt_id, user_id, opened_at, response_text, responded_at)
  VALUES ('3e781ac7-4241-4a7a-aeb3-8efe276d519d', 'c1000000-0000-0000-0000-000000000025', v_trang_id, '2026-09-19T08:00:00Z'::timestamptz, 'I would rate myself about a 6 out of 10 this week. I truly listened at Level 2 in maybe half of my conversations. What got in the way was being rushed — when I am checking the clock, I default back to Level 1 and start planning my response too early. Slowing my own pace seems to be the real lever, not just "trying harder" to listen.', '2026-09-19T19:00:00Z'::timestamptz)
  ON CONFLICT (daily_prompt_id, user_id) DO UPDATE SET opened_at = EXCLUDED.opened_at, response_text = EXCLUDED.response_text, responded_at = EXCLUDED.responded_at;
  INSERT INTO public.daily_prompt_responses (id, daily_prompt_id, user_id, opened_at, response_text, responded_at)
  VALUES ('d37e925a-c5ca-41e7-8ec7-41ca03d56cab', 'c1000000-0000-0000-0000-000000000031', v_trang_id, '2026-09-22T08:00:00Z'::timestamptz, 'In a 1:1 with my team member, I noticed she was still deep in "H" — describing everything that was going wrong with the client relationship — for almost the whole conversation. I resisted jumping to solutions and instead asked "What would a good outcome look like from here?" which finally moved her toward "I". Naming the stage in my head helped me stay patient.', '2026-09-22T13:00:00Z'::timestamptz)
  ON CONFLICT (daily_prompt_id, user_id) DO UPDATE SET opened_at = EXCLUDED.opened_at, response_text = EXCLUDED.response_text, responded_at = EXCLUDED.responded_at;
  INSERT INTO public.daily_prompt_responses (id, daily_prompt_id, user_id, opened_at, response_text, responded_at)
  VALUES ('d1ddb1bf-ba89-4f52-8094-5ac026a3a629', 'c1000000-0000-0000-0000-000000000032', v_trang_id, '2026-09-23T08:00:00Z'::timestamptz, 'My goal is to run a full coaching conversation confidently using SHIFT. When I achieve it, I will see myself staying calm and unhurried even during silence, I will hear the client thinking out loud instead of me filling gaps, and I will feel a steady groundedness instead of the urge to "perform." That picture makes the goal feel much more real than just "get better at coaching."', '2026-09-23T18:00:00Z'::timestamptz)
  ON CONFLICT (daily_prompt_id, user_id) DO UPDATE SET opened_at = EXCLUDED.opened_at, response_text = EXCLUDED.response_text, responded_at = EXCLUDED.responded_at;
  INSERT INTO public.daily_prompt_responses (id, daily_prompt_id, user_id, opened_at, response_text, responded_at)
  VALUES ('60b8b344-b471-4540-b956-d4bbc08c1d32', 'c1000000-0000-0000-0000-000000000033', v_trang_id, '2026-09-24T08:00:00Z'::timestamptz, 'I skipped "F" entirely today — I moved straight from the client''s desired outcome to "so what will you do?" without ever asking what resources or past successes she could draw on. Next time I could ask "What has helped you handle something like this before?" before moving to action. Noticing this in the moment is still hard, but I caught it afterward, which is progress.', '2026-09-24T19:30:00Z'::timestamptz)
  ON CONFLICT (daily_prompt_id, user_id) DO UPDATE SET opened_at = EXCLUDED.opened_at, response_text = EXCLUDED.response_text, responded_at = EXCLUDED.responded_at;
  INSERT INTO public.daily_prompt_responses (id, daily_prompt_id, user_id, opened_at, response_text, responded_at)
  VALUES ('a519a37f-ff3b-4ebc-a9e1-678cc2d69722', 'c1000000-0000-0000-0000-000000000034', v_trang_id, '2026-09-25T08:00:00Z'::timestamptz, 'A strength I have that I forget under pressure is that I am genuinely good at building trust quickly — people open up to me fast. When I am stressed I discount this and think I need to "prove" my coaching skill through clever questions, when actually my presence alone is already doing a lot of the work.', '2026-09-25T15:00:00Z'::timestamptz)
  ON CONFLICT (daily_prompt_id, user_id) DO UPDATE SET opened_at = EXCLUDED.opened_at, response_text = EXCLUDED.response_text, responded_at = EXCLUDED.responded_at;
  INSERT INTO public.daily_prompt_responses (id, daily_prompt_id, user_id, opened_at, response_text, responded_at)
  VALUES ('7647ebe2-fcc5-4235-88a2-41a4f5d4f217', 'c1000000-0000-0000-0000-000000000035', v_trang_id, '2026-09-26T08:00:00Z'::timestamptz, 'I would say a 6 out of 10 now, up from a 2 in week 1. What would help me go further is deliberately counting to five in my head after I ask a question, instead of trusting myself to "just know" when to stay quiet. Structure seems to help me more than willpower alone.', '2026-09-26T16:30:00Z'::timestamptz)
  ON CONFLICT (daily_prompt_id, user_id) DO UPDATE SET opened_at = EXCLUDED.opened_at, response_text = EXCLUDED.response_text, responded_at = EXCLUDED.responded_at;
  INSERT INTO public.daily_prompt_responses (id, daily_prompt_id, user_id, opened_at, response_text, responded_at)
  VALUES ('4182b290-5ed3-4702-92a9-7549aa14d9ab', 'c1000000-0000-0000-0000-000000000041', v_trang_id, '2026-09-29T08:00:00Z'::timestamptz, 'My manager once held me accountable by asking "What did you decide, and how did it go?" instead of "Did you do what I told you?" It felt supportive because the choice was still mine — she was curious about my decision, not checking whether I obeyed her instruction. That distinction is exactly what I want to bring into my own coaching practice.', '2026-09-29T13:00:00Z'::timestamptz)
  ON CONFLICT (daily_prompt_id, user_id) DO UPDATE SET opened_at = EXCLUDED.opened_at, response_text = EXCLUDED.response_text, responded_at = EXCLUDED.responded_at;
  INSERT INTO public.daily_prompt_responses (id, daily_prompt_id, user_id, opened_at, response_text, responded_at)
  VALUES ('862b3182-96e0-440b-9b7c-5966c20b2d31', 'c1000000-0000-0000-0000-000000000042', v_trang_id, '2026-09-30T08:00:00Z'::timestamptz, 'Trust and Safety feels strongest for me right now — people consistently tell me they feel comfortable being honest with me. Maintains Presence needs the most development; I still sometimes plan my next question while the other person is still talking, which pulls me out of full presence. I want to practice staying with "nothing to say yet" instead of rushing to fill it.', '2026-09-30T17:00:00Z'::timestamptz)
  ON CONFLICT (daily_prompt_id, user_id) DO UPDATE SET opened_at = EXCLUDED.opened_at, response_text = EXCLUDED.response_text, responded_at = EXCLUDED.responded_at;
  INSERT INTO public.daily_prompt_responses (id, daily_prompt_id, user_id, opened_at, response_text, responded_at)
  VALUES ('9faa0074-4830-4bec-abcd-73e967da0bc8', 'c1000000-0000-0000-0000-000000000043', v_trang_id, '2026-10-01T08:00:00Z'::timestamptz, 'Warm, patient, and curious. This style serves my clients because it gives them permission to think slowly instead of performing a quick answer for my benefit. People seem to relax noticeably once they realise I am not going to rush them or judge whatever they say.', '2026-10-01T20:00:00Z'::timestamptz)
  ON CONFLICT (daily_prompt_id, user_id) DO UPDATE SET opened_at = EXCLUDED.opened_at, response_text = EXCLUDED.response_text, responded_at = EXCLUDED.responded_at;
  INSERT INTO public.daily_prompt_responses (id, daily_prompt_id, user_id, opened_at, response_text, responded_at)
  VALUES ('80b2b387-3852-42eb-bc36-9cd03b7d260d', 'c1000000-0000-0000-0000-000000000044', v_trang_id, '2026-10-02T08:00:00Z'::timestamptz, NULL, NULL)
  ON CONFLICT (daily_prompt_id, user_id) DO UPDATE SET opened_at = EXCLUDED.opened_at, response_text = EXCLUDED.response_text, responded_at = EXCLUDED.responded_at;
  INSERT INTO public.daily_prompt_responses (id, daily_prompt_id, user_id, opened_at, response_text, responded_at)
  VALUES ('03361501-bac0-4aa6-a7dc-e2f1b5c3526f', 'c1000000-0000-0000-0000-000000000045', v_trang_id, '2026-10-03T08:00:00Z'::timestamptz, NULL, NULL)
  ON CONFLICT (daily_prompt_id, user_id) DO UPDATE SET opened_at = EXCLUDED.opened_at, response_text = EXCLUDED.response_text, responded_at = EXCLUDED.responded_at;

  -- 18. Quiz submissions (weeks 1-3; week 4 not yet taken). If Trang
  -- already has a submission for a given quiz (quiz submissions can't be
  -- changed once made), this leaves her existing one in place.
  INSERT INTO public.assignment_submissions (id, assignment_id, user_id, answers, reflection_text, submitted_at)
  VALUES ('f431f0e8-1179-4723-b9c3-1368821cc6c6', v_quiz1_id, v_trang_id, '{"c3100000-0000-0000-0000-000000000001":"a","c3100000-0000-0000-0000-000000000002":"c","c3100000-0000-0000-0000-000000000003":"b","c3100000-0000-0000-0000-000000000004":"b"}'::jsonb, 'I got question 1 wrong — I said the coach should explain why the choice might not work. Now I understand that the coach should trust the client''s choice and help expand options instead.', '2026-09-12T15:00:00Z'::timestamptz)
  ON CONFLICT (assignment_id, user_id) DO NOTHING;
  INSERT INTO public.assignment_submissions (id, assignment_id, user_id, answers, reflection_text, submitted_at)
  VALUES ('3d720152-f061-489f-ac37-a60b035a0716', v_quiz2_id, v_trang_id, '{"c3200000-0000-0000-0000-000000000001":"b","c3200000-0000-0000-0000-000000000002":"c","c3200000-0000-0000-0000-000000000003":"b","c3200000-0000-0000-0000-000000000004":"c"}'::jsonb, 'I feel much more confident about the questioning framework now. The distinction between a leading question and an open question is clear to me.', '2026-09-19T14:00:00Z'::timestamptz)
  ON CONFLICT (assignment_id, user_id) DO NOTHING;
  INSERT INTO public.assignment_submissions (id, assignment_id, user_id, answers, reflection_text, submitted_at)
  VALUES ('23a0bcdb-ee53-4a0f-9a85-7726709787b9', v_quiz3_id, v_trang_id, '{"c3300000-0000-0000-0000-000000000001":"b","c3300000-0000-0000-0000-000000000002":"b","c3300000-0000-0000-0000-000000000003":"b","c3300000-0000-0000-0000-000000000004":"a"}'::jsonb, 'I got the question about the F stage wrong. I thought it was about finding NEW resources, but it is actually about surfacing resources the client ALREADY has. That is a crucial distinction.', '2026-09-26T13:00:00Z'::timestamptz)
  ON CONFLICT (assignment_id, user_id) DO NOTHING;

  -- 19. Reflection submission (mid-programme reflection)
  INSERT INTO public.reflection_submissions (id, reflection_id, user_id, confidence_score, submitted_at)
  VALUES ('22b5ccac-f714-4ab4-9b63-7128e52f7f54', v_reflection1_id, v_trang_id, 6, '2026-09-19T18:00:00Z'::timestamptz)
  ON CONFLICT (reflection_id, user_id) DO UPDATE SET confidence_score = EXCLUDED.confidence_score;
  INSERT INTO public.reflection_answers (id, submission_id, question_id, answer_text, answer_value)
  VALUES ('cb8b0d7e-32b6-46c0-b197-49d758df2d29', '22b5ccac-f714-4ab4-9b63-7128e52f7f54', 'c5100000-0000-0000-0000-000000000001', 'My biggest insight is that coaching is not about having the right answer — it is about asking the right question and then getting out of the way. This sounds simple but it goes against everything I have been trained to do as a manager.', NULL)
  ON CONFLICT (submission_id, question_id) DO UPDATE SET answer_text = EXCLUDED.answer_text, answer_value = EXCLUDED.answer_value;
  INSERT INTO public.reflection_answers (id, submission_id, question_id, answer_text, answer_value)
  VALUES ('d5a6edbd-f607-4153-a887-a6448a3f9a4e', '22b5ccac-f714-4ab4-9b63-7128e52f7f54', 'c5100000-0000-0000-0000-000000000002', NULL, 6)
  ON CONFLICT (submission_id, question_id) DO UPDATE SET answer_text = EXCLUDED.answer_text, answer_value = EXCLUDED.answer_value;
  INSERT INTO public.reflection_answers (id, submission_id, question_id, answer_text, answer_value)
  VALUES ('70ec6faa-812d-4533-ab86-96049ca13a01', '22b5ccac-f714-4ab4-9b63-7128e52f7f54', 'c5100000-0000-0000-0000-000000000003', 'On Wednesday, a team member came to me with a budget problem. Instead of suggesting she cut the training line item (my first instinct), I asked: What would you do if you had full authority to solve this? She paused, then laid out a plan that was better than anything I would have suggested. I felt proud of both of us.', NULL)
  ON CONFLICT (submission_id, question_id) DO UPDATE SET answer_text = EXCLUDED.answer_text, answer_value = EXCLUDED.answer_value;
  INSERT INTO public.reflection_answers (id, submission_id, question_id, answer_text, answer_value)
  VALUES ('74aca173-e805-4592-a89e-c02a084fb327', '22b5ccac-f714-4ab4-9b63-7128e52f7f54', 'c5100000-0000-0000-0000-000000000004', NULL, 5)
  ON CONFLICT (submission_id, question_id) DO UPDATE SET answer_text = EXCLUDED.answer_text, answer_value = EXCLUDED.answer_value;
  INSERT INTO public.reflection_answers (id, submission_id, question_id, answer_text, answer_value)
  VALUES ('cd1d8922-d92f-49b7-b34f-c8dbeea2d037', '22b5ccac-f714-4ab4-9b63-7128e52f7f54', 'c5100000-0000-0000-0000-000000000005', 'I want to focus on the SHIFT model — specifically staying in the I (desired outcome) stage longer instead of rushing to action. I also want to get more comfortable with silence.', NULL)
  ON CONFLICT (submission_id, question_id) DO UPDATE SET answer_text = EXCLUDED.answer_text, answer_value = EXCLUDED.answer_value;

  -- 20. Notifications
  INSERT INTO public.notifications (id, user_id, notification_type, title, title_vi, body, body_vi, link, is_read, read_at, created_at)
  VALUES ('207ba6ad-a6dc-41b3-b608-6e171e743f51', v_trang_id, 'session_confirmed', 'Session confirmed', 'Session đã xác nhận', 'Your coaching session on Sep 10 at 9:00 AM has been confirmed.', 'Session coaching ngày 10/9 lúc 9:00 sáng đã được xác nhận.', '/sessions/e0000000-0000-0000-0000-000000000001', true, '2026-09-09T10:05:00Z'::timestamptz, '2026-09-09T10:00:00Z'::timestamptz)
  ON CONFLICT (id) DO UPDATE SET is_read = EXCLUDED.is_read, read_at = EXCLUDED.read_at;
  INSERT INTO public.notifications (id, user_id, notification_type, title, title_vi, body, body_vi, link, is_read, read_at, created_at)
  VALUES ('8a79dc99-dcc1-4f97-abff-e476bdcc4846', v_trang_id, 'new_training_week', 'Week 3 is now available', 'Tuần 3 đã mở', 'The SHIFT Model in Practice — your new training content is ready.', 'Mô hình SHIFT trong Thực hành — nội dung đào tạo mới đã sẵn sàng.', '/training', true, '2026-09-22T08:02:00Z'::timestamptz, '2026-09-22T08:00:00Z'::timestamptz)
  ON CONFLICT (id) DO UPDATE SET is_read = EXCLUDED.is_read, read_at = EXCLUDED.read_at;
  INSERT INTO public.notifications (id, user_id, notification_type, title, title_vi, body, body_vi, link, is_read, read_at, created_at)
  VALUES ('cf892da3-5d00-436b-ae7b-f018706c8d7b', v_trang_id, 'triad_session_booked', 'Triad session scheduled', 'Session triad đã được lên lịch', 'Triad Alpha practice session on Sep 20 at 3:00 PM.', 'Session thực hành Triad Alpha ngày 20/9 lúc 3:00 chiều.', '/triads', true, '2026-09-19T08:00:00Z'::timestamptz, '2026-09-19T07:00:00Z'::timestamptz)
  ON CONFLICT (id) DO UPDATE SET is_read = EXCLUDED.is_read, read_at = EXCLUDED.read_at;
  INSERT INTO public.notifications (id, user_id, notification_type, title, title_vi, body, body_vi, link, is_read, read_at, created_at)
  VALUES ('9b6664f8-8350-4ea0-bd6c-6bdbfd4dcb31', v_trang_id, 'daily_prompt', 'Your daily coaching prompt', 'Câu hỏi coaching hàng ngày', 'A new reflection prompt is waiting for you.', 'Một câu hỏi phản tư mới đang chờ bạn.', '/dashboard', false, NULL, '2026-09-29T07:00:00Z'::timestamptz)
  ON CONFLICT (id) DO UPDATE SET is_read = EXCLUDED.is_read, read_at = EXCLUDED.read_at;

  RAISE NOTICE 'TASC Essential Course seed complete. programme_id=%, trang_id=%', v_programme_id, v_trang_id;
END;
$tasc_seed$;
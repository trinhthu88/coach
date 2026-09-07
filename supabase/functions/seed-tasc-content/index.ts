import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCorsHeaders } from "../_shared/cors.ts";

// Seeds the "TASC - Essential Course" programme content plus a full set of
// session/feedback test data for trang.tt@hsp.consulting. Content-only —
// does not create users.
//
// MERGE-AWARE: the target project may already have a "TASC - Essential
// Course" programme (with placeholder content and real enrollments) from
// before this function existed. Every container row (programme, cohort,
// training weeks, quizzes, reflections, triad rounds) is resolved by its
// natural key at runtime — reusing the existing id and overwriting
// placeholder text with real content if a row already exists, creating a
// fresh row only if it doesn't. Leaf/child content (daily prompts, quiz
// questions, reflection questions) is deleted and reinserted per parent so
// no placeholder rows linger alongside the real ones.

const TRANG_EMAIL = "trang.tt@hsp.consulting";

const PROGRAMME = {
  "id": "a0000000-0000-0000-0000-000000000001",
  "name": "TASC - Essential Course",
  "description": "A 4-week intensive foundation in Solution-Focused Coaching based on the Erickson methodology. Participants learn the coaching mindset, powerful questioning techniques, the SHIFT model, and how to build sustainable client outcomes. Designed for aspiring coaches and leaders who want ICF-aligned coaching skills.",
  "duration_months": 1,
  "color": "#2c8fa8",
  "is_active": true,
  "coachee_session_limit": 4,
  "coach_session_limit": 4,
  "peer_session_limit": 2,
  "peer_given_limit": 2,
  "mentoring_received_limit": 2
};

const MODULES = [
  {
    "module": "coaching",
    "enabled": true,
    "config": {
      "receive_limit": 4,
      "session_length_minutes": 60
    }
  },
  {
    "module": "peer_coaching",
    "enabled": true,
    "config": {
      "monthly_limit": 2
    }
  },
  {
    "module": "mentoring",
    "enabled": true,
    "config": {
      "receive_limit": 2,
      "give_limit": 4
    }
  },
  {
    "module": "triads",
    "enabled": true,
    "config": {}
  },
  {
    "module": "training",
    "enabled": true,
    "config": {}
  },
  {
    "module": "quiz",
    "enabled": true,
    "config": {}
  },
  {
    "module": "assessment",
    "enabled": true,
    "config": {}
  },
  {
    "module": "daily_prompt",
    "enabled": true,
    "config": {}
  }
];

const COHORT = {
  "id": "a0000000-0000-0000-0000-000000000002",
  "name": "TASC Essential — Cohort 1 (Sep 2026)",
  "programme_id": "a0000000-0000-0000-0000-000000000001",
  "description": "First pilot cohort for the TASC Essential Course. 12 participants from banking and finance sector.",
  "start_date": "2026-09-08",
  "end_date": "2026-10-06",
  "color": "#2c8fa8"
};

const WEEKS = [
  {
    "id": "b0000000-0000-0000-0000-000000000001",
    "week_number": 1,
    "sort_order": 1,
    "title": "The Coaching Mindset",
    "title_vi": "Tư duy Coaching",
    "subtitle": "Foundations of Solution-Focused Coaching & the Erickson Approach",
    "subtitle_vi": "Nền tảng Coaching tập trung giải pháp & Phương pháp Erickson",
    "is_visible": true,
    "skill_card_visible": true,
    "unlock_date": "2026-09-08",
    "video_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "pdf_storage_path": "tasc-essential/week-1-coaching-mindset-en.pdf",
    "pdf_storage_path_vi": "tasc-essential/week-1-coaching-mindset-vi.pdf",
    "skill_card_html": "<div class=\"skill-card\"><h2>The Coaching Mindset</h2><p>Coaching is a partnership, not instruction. In the Erickson approach, we believe that every person is naturally creative, resourceful, and whole. The coach's role is to hold space for insight — not to diagnose, advise, or fix.</p><h3>Key Principles This Week</h3><ul><li><strong>Solution-focused vs. problem-focused</strong>: Instead of \"What's wrong?\", ask \"What do you want instead?\"</li><li><strong>The person is not the problem</strong>: Separate identity from behaviour. Always assume positive intent.</li><li><strong>Future orientation</strong>: Energy follows attention. We coach toward what the client wants to create, not what they want to escape.</li><li><strong>Responsibility sits with the client</strong>: The coach does not own the client's outcomes — the client does.</li></ul><h3>Erickson's 5 Principles</h3><ol><li>People are OK as they are</li><li>People already have all the resources they need</li><li>People always make the best choice available to them</li><li>Every behaviour has a positive intention</li><li>Change is inevitable</li></ol><h3>Reflection Prompt</h3><p>Think of a recent conversation where you gave advice instead of asking questions. What might have happened if you had stayed curious instead?</p></div>",
    "skill_card_html_vi": "<div class=\"skill-card\"><h2>Tư duy Coaching</h2><p>Coaching là một mối quan hệ đối tác, không phải hướng dẫn. Trong phương pháp Erickson, chúng tôi tin rằng mỗi người đều sáng tạo, có đầy đủ nguồn lực và toàn vẹn. Vai trò của coach là giữ không gian cho sự khai sáng — không phải chẩn đoán, tư vấn hay sửa chữa.</p><h3>Nguyên tắc chính tuần này</h3><ul><li><strong>Tập trung giải pháp thay vì tập trung vấn đề</strong>: Thay vì \"Có gì sai?\", hãy hỏi \"Bạn muốn điều gì thay thế?\"</li><li><strong>Con người không phải là vấn đề</strong>: Tách biệt bản sắc khỏi hành vi. Luôn giả định ý định tích cực.</li><li><strong>Hướng về tương lai</strong>: Năng lượng đi theo sự chú ý. Chúng ta coach hướng đến những gì khách hàng muốn tạo ra.</li><li><strong>Trách nhiệm thuộc về khách hàng</strong>: Coach không sở hữu kết quả của khách hàng — khách hàng mới là người sở hữu.</li></ul><h3>5 Nguyên tắc Erickson</h3><ol><li>Mọi người đều ổn như họ đang là</li><li>Mọi người đã có đủ nguồn lực cần thiết</li><li>Mọi người luôn đưa ra lựa chọn tốt nhất có thể</li><li>Mọi hành vi đều có ý định tích cực</li><li>Thay đổi là điều tất yếu</li></ol><h3>Câu hỏi phản tư</h3><p>Hãy nghĩ về một cuộc trò chuyện gần đây mà bạn đã đưa ra lời khuyên thay vì đặt câu hỏi. Điều gì có thể xảy ra nếu bạn giữ được sự tò mò?</p></div>",
    "dailyPrompts": [
      {
        "day_offset": 1,
        "sort_order": 1,
        "is_visible": true,
        "prompt_text": "Think of a conversation you had today. At what point did you shift from listening to advising? What would have happened if you had asked one more question instead?",
        "prompt_text_vi": "Hãy nghĩ về một cuộc trò chuyện bạn đã có hôm nay. Tại thời điểm nào bạn chuyển từ lắng nghe sang đưa lời khuyên? Điều gì sẽ xảy ra nếu bạn đặt thêm một câu hỏi thay vì vậy?"
      },
      {
        "day_offset": 2,
        "sort_order": 2,
        "is_visible": true,
        "prompt_text": "Which of Erickson's 5 principles feels most natural to you? Which one challenges you the most? Why?",
        "prompt_text_vi": "Nguyên tắc nào trong 5 nguyên tắc Erickson cảm thấy tự nhiên nhất với bạn? Nguyên tắc nào thách thức bạn nhất? Tại sao?"
      },
      {
        "day_offset": 3,
        "sort_order": 3,
        "is_visible": true,
        "prompt_text": "Observe someone you admire in a meeting today. How do they create space for others to think? What specific behaviour do they use?",
        "prompt_text_vi": "Quan sát một người bạn ngưỡng mộ trong cuộc họp hôm nay. Họ tạo không gian để người khác suy nghĩ như thế nào? Hành vi cụ thể nào họ sử dụng?"
      },
      {
        "day_offset": 4,
        "sort_order": 4,
        "is_visible": true,
        "prompt_text": "Notice one moment today where you assumed you knew what someone needed before they told you. What was the assumption? Was it accurate?",
        "prompt_text_vi": "Nhận ra một khoảnh khắc hôm nay khi bạn giả định mình biết người khác cần gì trước khi họ nói. Giả định đó là gì? Nó có chính xác không?"
      },
      {
        "day_offset": 5,
        "sort_order": 5,
        "is_visible": true,
        "prompt_text": "If you could only ask questions (no statements, no advice) for one full hour tomorrow, what would be the hardest part? What might you discover?",
        "prompt_text_vi": "Nếu bạn chỉ có thể đặt câu hỏi (không phát biểu, không lời khuyên) trong một giờ đầy đủ ngày mai, phần khó nhất sẽ là gì? Bạn có thể khám phá được gì?"
      }
    ],
    "quiz": {
      "id": "c2000000-0000-0000-0000-000000000001",
      "title": "Coaching Mindset Foundations",
      "title_vi": "Nền tảng Tư duy Coaching",
      "instructions": "Test your understanding of the coaching mindset and Erickson's foundational principles. You can take this quiz once.",
      "instructions_vi": "Kiểm tra hiểu biết của bạn về tư duy coaching và các nguyên tắc nền tảng của Erickson. Bạn có thể làm bài kiểm tra này một lần.",
      "sort_order": 1,
      "is_visible": true,
      "questions": [
        {
          "id": "c3100000-0000-0000-0000-000000000001",
          "sort_order": 1,
          "question_text": "According to Erickson's principles, when a client makes a choice the coach disagrees with, the coach should:",
          "question_text_vi": "Theo nguyên tắc Erickson, khi khách hàng đưa ra lựa chọn mà coach không đồng ý, coach nên:",
          "options": [
            {
              "id": "a",
              "text": "Explain why the choice might not work",
              "text_vi": "Giải thích tại sao lựa chọn đó có thể không hiệu quả",
              "is_correct": false
            },
            {
              "id": "b",
              "text": "Trust that the client is making the best choice available to them",
              "text_vi": "Tin rằng khách hàng đang đưa ra lựa chọn tốt nhất có thể",
              "is_correct": true
            },
            {
              "id": "c",
              "text": "Offer a better alternative",
              "text_vi": "Đề xuất một lựa chọn tốt hơn",
              "is_correct": false
            },
            {
              "id": "d",
              "text": "Remain silent and move on",
              "text_vi": "Giữ im lặng và bỏ qua",
              "is_correct": false
            }
          ],
          "explanation": "Erickson's third principle states that people always make the best choice available to them. The coach's role is to trust this while helping expand the range of choices available.",
          "explanation_vi": "Nguyên tắc thứ ba của Erickson nói rằng mọi người luôn đưa ra lựa chọn tốt nhất có thể. Vai trò của coach là tin tưởng điều này trong khi giúp mở rộng phạm vi lựa chọn."
        },
        {
          "id": "c3100000-0000-0000-0000-000000000002",
          "sort_order": 2,
          "question_text": "What is the fundamental difference between solution-focused and problem-focused coaching?",
          "question_text_vi": "Sự khác biệt cơ bản giữa coaching tập trung giải pháp và coaching tập trung vấn đề là gì?",
          "options": [
            {
              "id": "a",
              "text": "Solution-focused coaching ignores problems entirely",
              "text_vi": "Coaching tập trung giải pháp bỏ qua hoàn toàn các vấn đề",
              "is_correct": false
            },
            {
              "id": "b",
              "text": "Problem-focused coaching is more thorough",
              "text_vi": "Coaching tập trung vấn đề kỹ lưỡng hơn",
              "is_correct": false
            },
            {
              "id": "c",
              "text": "Solution-focused coaching directs energy toward what the client wants to create, not what they want to escape",
              "text_vi": "Coaching tập trung giải pháp hướng năng lượng đến điều khách hàng muốn tạo ra, không phải điều họ muốn thoát khỏi",
              "is_correct": true
            },
            {
              "id": "d",
              "text": "There is no practical difference — both arrive at the same result",
              "text_vi": "Không có sự khác biệt thực tế — cả hai đều đi đến cùng kết quả",
              "is_correct": false
            }
          ],
          "explanation": "Solution-focused coaching is fundamentally about future orientation. Energy follows attention — by focusing on the desired state rather than analyzing the problem, clients generate more motivation and creative options.",
          "explanation_vi": "Coaching tập trung giải pháp cơ bản là về hướng đến tương lai. Năng lượng đi theo sự chú ý — bằng cách tập trung vào trạng thái mong muốn thay vì phân tích vấn đề, khách hàng tạo ra nhiều động lực và lựa chọn sáng tạo hơn."
        },
        {
          "id": "c3100000-0000-0000-0000-000000000003",
          "sort_order": 3,
          "question_text": "In the coaching relationship, who owns the client's outcomes?",
          "question_text_vi": "Trong mối quan hệ coaching, ai sở hữu kết quả của khách hàng?",
          "options": [
            {
              "id": "a",
              "text": "The coach, because they guide the process",
              "text_vi": "Coach, vì họ hướng dẫn quá trình",
              "is_correct": false
            },
            {
              "id": "b",
              "text": "The client",
              "text_vi": "Khách hàng",
              "is_correct": true
            },
            {
              "id": "c",
              "text": "Both equally",
              "text_vi": "Cả hai như nhau",
              "is_correct": false
            },
            {
              "id": "d",
              "text": "The organization sponsoring the coaching",
              "text_vi": "Tổ chức tài trợ coaching",
              "is_correct": false
            }
          ],
          "explanation": "A foundational principle: responsibility sits with the client. The coach holds the process, the client holds the outcomes. This prevents dependency and builds the client's own resourcefulness.",
          "explanation_vi": "Nguyên tắc nền tảng: trách nhiệm thuộc về khách hàng. Coach giữ quy trình, khách hàng giữ kết quả. Điều này ngăn ngừa sự phụ thuộc và xây dựng nguồn lực riêng của khách hàng."
        },
        {
          "id": "c3100000-0000-0000-0000-000000000004",
          "sort_order": 4,
          "question_text": "Which of the following best describes the Erickson coaching approach?",
          "question_text_vi": "Điều nào sau đây mô tả tốt nhất phương pháp coaching Erickson?",
          "options": [
            {
              "id": "a",
              "text": "A diagnostic framework where the coach identifies what is wrong and prescribes a solution",
              "text_vi": "Một khung chẩn đoán nơi coach xác định điều gì sai và kê đơn giải pháp",
              "is_correct": false
            },
            {
              "id": "b",
              "text": "A partnership where the coach holds space for insight, believing the client is creative, resourceful, and whole",
              "text_vi": "Một mối quan hệ đối tác nơi coach giữ không gian cho sự khai sáng, tin rằng khách hàng sáng tạo, có nguồn lực và toàn vẹn",
              "is_correct": true
            },
            {
              "id": "c",
              "text": "A mentoring relationship where the more experienced person teaches the less experienced person",
              "text_vi": "Một mối quan hệ mentoring nơi người có kinh nghiệm hơn dạy người ít kinh nghiệm hơn",
              "is_correct": false
            },
            {
              "id": "d",
              "text": "A therapeutic process focused on healing past wounds",
              "text_vi": "Một quá trình trị liệu tập trung chữa lành vết thương quá khứ",
              "is_correct": false
            }
          ],
          "explanation": "Coaching is distinct from advising, mentoring, and therapy. The Erickson model is built on the belief that clients are not broken — they are whole, creative, and resourceful. The coach's job is to facilitate their own discovery.",
          "explanation_vi": "Coaching khác biệt với tư vấn, mentoring và trị liệu. Mô hình Erickson được xây dựng trên niềm tin rằng khách hàng không bị hỏng — họ toàn vẹn, sáng tạo và có nguồn lực. Công việc của coach là hỗ trợ sự khám phá của chính họ."
        }
      ]
    }
  },
  {
    "id": "b0000000-0000-0000-0000-000000000002",
    "week_number": 2,
    "sort_order": 2,
    "title": "The Art of Powerful Questions",
    "title_vi": "Nghệ thuật Đặt câu hỏi Mạnh mẽ",
    "subtitle": "Open questions, levels of listening, and creating awareness",
    "subtitle_vi": "Câu hỏi mở, các cấp độ lắng nghe, và tạo nhận thức",
    "is_visible": true,
    "skill_card_visible": true,
    "unlock_date": "2026-09-15",
    "video_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "pdf_storage_path": "tasc-essential/week-2-powerful-questions-en.pdf",
    "pdf_storage_path_vi": "tasc-essential/week-2-powerful-questions-vi.pdf",
    "skill_card_html": "<div class=\"skill-card\"><h2>The Art of Powerful Questions</h2><p>A powerful question does three things: it shifts perspective, it generates energy, and it moves the client forward. In Erickson coaching, questions are the primary tool — not interpretation, not reframing, not advice.</p><h3>Three Levels of Listening</h3><ul><li><strong>Level 1 — Internal Listening</strong>: You hear the words but process them through your own filters. \"That reminds me of when I…\"</li><li><strong>Level 2 — Focused Listening</strong>: Full attention on the speaker. You notice tone, pace, energy shifts, and what is NOT said.</li><li><strong>Level 3 — Global Listening</strong>: You sense the whole environment — the emotion in the room, the unspoken dynamics, the energy between people.</li></ul><h3>Anatomy of a Powerful Question</h3><ul><li>Open-ended (starts with What, How, When — rarely Why)</li><li>Short (under 10 words is ideal)</li><li>Forward-looking (\"What would success look like?\")</li><li>Assumption-free (doesn't embed the coach's hypothesis)</li><li>Generates silence (the client needs to think, not just react)</li></ul><h3>Questions to Avoid</h3><ul><li>\"Don't you think you should…?\" (leading)</li><li>\"Why did you do that?\" (judgmental)</li><li>\"Have you tried X?\" (advice in disguise)</li></ul><h3>Practice This Week</h3><p>In your next three conversations, replace every piece of advice with a genuine question. Notice what happens.</p></div>",
    "skill_card_html_vi": "<div class=\"skill-card\"><h2>Nghệ thuật Đặt câu hỏi Mạnh mẽ</h2><p>Một câu hỏi mạnh mẽ làm được ba điều: thay đổi góc nhìn, tạo năng lượng, và đưa khách hàng tiến về phía trước. Trong coaching Erickson, câu hỏi là công cụ chính — không phải diễn giải, không phải tái cấu trúc, không phải lời khuyên.</p><h3>Ba Cấp độ Lắng nghe</h3><ul><li><strong>Cấp độ 1 — Lắng nghe Nội tại</strong>: Bạn nghe từ ngữ nhưng xử lý qua bộ lọc của riêng mình. \"Điều đó nhắc tôi nhớ đến khi tôi…\"</li><li><strong>Cấp độ 2 — Lắng nghe Tập trung</strong>: Toàn bộ sự chú ý vào người nói. Bạn nhận ra giọng điệu, nhịp độ, sự thay đổi năng lượng, và những gì KHÔNG được nói.</li><li><strong>Cấp độ 3 — Lắng nghe Toàn cầu</strong>: Bạn cảm nhận toàn bộ môi trường — cảm xúc trong phòng, động lực ngầm, năng lượng giữa mọi người.</li></ul><h3>Giải phẫu Câu hỏi Mạnh mẽ</h3><ul><li>Mở (bắt đầu bằng Gì, Như thế nào, Khi nào — hiếm khi Tại sao)</li><li>Ngắn gọn (dưới 10 từ là lý tưởng)</li><li>Hướng về tương lai (\"Thành công sẽ trông như thế nào?\")</li><li>Không giả định (không chứa giả thuyết của coach)</li><li>Tạo sự im lặng (khách hàng cần suy nghĩ, không chỉ phản ứng)</li></ul><h3>Thực hành Tuần này</h3><p>Trong ba cuộc trò chuyện tiếp theo, hãy thay mỗi lời khuyên bằng một câu hỏi thực sự. Quan sát điều gì xảy ra.</p></div>",
    "dailyPrompts": [
      {
        "day_offset": 1,
        "sort_order": 1,
        "is_visible": true,
        "prompt_text": "What question did someone ask you recently that made you stop and think? What made it powerful?",
        "prompt_text_vi": "Câu hỏi nào ai đó đã hỏi bạn gần đây khiến bạn dừng lại và suy nghĩ? Điều gì làm nó mạnh mẽ?"
      },
      {
        "day_offset": 2,
        "sort_order": 2,
        "is_visible": true,
        "prompt_text": "Practice Level 2 listening in your next conversation. Afterward, write down what you noticed beyond the words — tone, pace, energy, pauses.",
        "prompt_text_vi": "Thực hành Lắng nghe Cấp độ 2 trong cuộc trò chuyện tiếp theo. Sau đó, viết ra những gì bạn nhận thấy ngoài lời nói — giọng điệu, nhịp độ, năng lượng, khoảng dừng."
      },
      {
        "day_offset": 3,
        "sort_order": 3,
        "is_visible": true,
        "prompt_text": "Write down three open-ended questions you could ask a colleague who is stuck on a problem — without embedding any advice in the question.",
        "prompt_text_vi": "Viết ra ba câu hỏi mở bạn có thể hỏi một đồng nghiệp đang bế tắc với một vấn đề — mà không nhúng bất kỳ lời khuyên nào trong câu hỏi."
      },
      {
        "day_offset": 4,
        "sort_order": 4,
        "is_visible": true,
        "prompt_text": "When someone shared a problem with you today, what was your first internal reaction — to solve, to empathize, or to ask? What does that tell you about your default mode?",
        "prompt_text_vi": "Khi ai đó chia sẻ vấn đề với bạn hôm nay, phản ứng nội tại đầu tiên của bạn là gì — giải quyết, đồng cảm, hay hỏi? Điều đó nói gì về chế độ mặc định của bạn?"
      },
      {
        "day_offset": 5,
        "sort_order": 5,
        "is_visible": true,
        "prompt_text": "Reflect on your listening this week. On a scale of 1-10, how often did you truly listen at Level 2 or above? What got in the way?",
        "prompt_text_vi": "Phản tư về việc lắng nghe của bạn tuần này. Trên thang 1-10, bạn thực sự lắng nghe ở Cấp độ 2 trở lên bao nhiêu lần? Điều gì đã cản trở?"
      }
    ],
    "quiz": {
      "id": "c2000000-0000-0000-0000-000000000002",
      "title": "Powerful Questions & Active Listening",
      "title_vi": "Câu hỏi Mạnh mẽ & Lắng nghe Chủ động",
      "instructions": "Test your understanding of open questioning and the three levels of listening. You can take this quiz once.",
      "instructions_vi": "Kiểm tra hiểu biết của bạn về đặt câu hỏi mở và ba cấp độ lắng nghe. Bạn có thể làm bài kiểm tra này một lần.",
      "sort_order": 1,
      "is_visible": true,
      "questions": [
        {
          "id": "c3200000-0000-0000-0000-000000000001",
          "sort_order": 1,
          "question_text": "Which of the following is a genuinely open, non-leading coaching question?",
          "question_text_vi": "Câu hỏi nào sau đây là một câu hỏi coaching thực sự mở, không dẫn dắt?",
          "options": [
            {
              "id": "a",
              "text": "Don't you think you should talk to your manager about this?",
              "text_vi": "Bạn không nghĩ là nên nói chuyện với quản lý của mình về việc này sao?",
              "is_correct": false
            },
            {
              "id": "b",
              "text": "What would it look like to resolve this in a way that works for everyone?",
              "text_vi": "Việc giải quyết vấn đề này theo cách phù hợp với mọi người sẽ trông như thế nào?",
              "is_correct": true
            },
            {
              "id": "c",
              "text": "Have you tried just being more direct with your team?",
              "text_vi": "Bạn đã thử trực tiếp hơn với nhóm của mình chưa?",
              "is_correct": false
            },
            {
              "id": "d",
              "text": "Isn't it obvious that the deadline is the real issue here?",
              "text_vi": "Chẳng phải rõ ràng là thời hạn mới là vấn đề thực sự ở đây sao?",
              "is_correct": false
            }
          ],
          "explanation": "A genuinely open question carries no embedded suggestion or judgment. Options a, c, and d are all advice or opinion disguised as a question — a true open question invites the client to generate their own answer.",
          "explanation_vi": "Một câu hỏi thực sự mở không chứa gợi ý hay phán xét ngầm. Các phương án a, c và d đều là lời khuyên hoặc ý kiến được ngụy trang thành câu hỏi — một câu hỏi mở thực sự mời khách hàng tự tạo ra câu trả lời của riêng họ."
        },
        {
          "id": "c3200000-0000-0000-0000-000000000002",
          "sort_order": 2,
          "question_text": "A coach practicing Level 2 (Focused) Listening is primarily paying attention to:",
          "question_text_vi": "Một coach thực hành Lắng nghe Cấp độ 2 (Tập trung) chủ yếu chú ý đến điều gì?",
          "options": [
            {
              "id": "a",
              "text": "How the client's story relates to the coach's own past experiences",
              "text_vi": "Câu chuyện của khách hàng liên quan như thế nào đến kinh nghiệm quá khứ của chính coach",
              "is_correct": false
            },
            {
              "id": "b",
              "text": "What the coach should say next",
              "text_vi": "Điều coach nên nói tiếp theo là gì",
              "is_correct": false
            },
            {
              "id": "c",
              "text": "The client fully — their words, tone, pace, energy shifts, and what is left unsaid",
              "text_vi": "Toàn bộ khách hàng — lời nói, giọng điệu, nhịp độ, sự thay đổi năng lượng và những gì chưa được nói ra",
              "is_correct": true
            },
            {
              "id": "d",
              "text": "Whether the session is on schedule",
              "text_vi": "Session có đang đúng tiến độ hay không",
              "is_correct": false
            }
          ],
          "explanation": "Level 2 listening moves attention entirely off the coach's own internal chatter (Level 1) and fully onto the client — verbal and non-verbal cues alike.",
          "explanation_vi": "Lắng nghe Cấp độ 2 chuyển toàn bộ sự chú ý ra khỏi tiếng ồn nội tại của coach (Cấp độ 1) và hoàn toàn hướng về khách hàng — cả tín hiệu lời nói lẫn phi ngôn ngữ."
        },
        {
          "id": "c3200000-0000-0000-0000-000000000003",
          "sort_order": 3,
          "question_text": "Why are \"Why?\" questions generally avoided in coaching conversations?",
          "question_text_vi": "Tại sao câu hỏi \"Tại sao?\" thường được tránh trong các cuộc đối thoại coaching?",
          "options": [
            {
              "id": "a",
              "text": "They are grammatically incorrect in most languages",
              "text_vi": "Chúng sai ngữ pháp trong hầu hết các ngôn ngữ",
              "is_correct": false
            },
            {
              "id": "b",
              "text": "They tend to trigger justification or defensiveness rather than open exploration",
              "text_vi": "Chúng có xu hướng kích hoạt sự biện minh hoặc phòng thủ thay vì khám phá cởi mở",
              "is_correct": true
            },
            {
              "id": "c",
              "text": "They are too long for clients to understand",
              "text_vi": "Chúng quá dài để khách hàng hiểu",
              "is_correct": false
            },
            {
              "id": "d",
              "text": "ICF certification rules prohibit their use entirely",
              "text_vi": "Quy tắc chứng nhận ICF cấm hoàn toàn việc sử dụng chúng",
              "is_correct": false
            }
          ],
          "explanation": "\"Why\" questions often put people on the back foot, prompting them to justify past decisions rather than explore forward. \"What\" and \"How\" questions tend to open up thinking instead.",
          "explanation_vi": "Câu hỏi \"Tại sao\" thường khiến mọi người rơi vào thế phòng thủ, thúc đẩy họ biện minh cho quyết định trong quá khứ thay vì khám phá về phía trước. Câu hỏi \"Cái gì\" và \"Như thế nào\" có xu hướng mở ra tư duy thay vào đó."
        },
        {
          "id": "c3200000-0000-0000-0000-000000000004",
          "sort_order": 4,
          "question_text": "Which characteristic is NOT typical of a powerful coaching question?",
          "question_text_vi": "Đặc điểm nào KHÔNG phải là đặc trưng của một câu hỏi coaching mạnh mẽ?",
          "options": [
            {
              "id": "a",
              "text": "It is short and simple",
              "text_vi": "Nó ngắn gọn và đơn giản",
              "is_correct": false
            },
            {
              "id": "b",
              "text": "It generates a pause or silence before the client answers",
              "text_vi": "Nó tạo ra một khoảng dừng hoặc im lặng trước khi khách hàng trả lời",
              "is_correct": false
            },
            {
              "id": "c",
              "text": "It contains the coach's own hypothesis about what the client should do",
              "text_vi": "Nó chứa giả thuyết của chính coach về điều khách hàng nên làm",
              "is_correct": true
            },
            {
              "id": "d",
              "text": "It is forward-looking rather than focused on justifying the past",
              "text_vi": "Nó hướng về phía trước thay vì tập trung vào việc biện minh cho quá khứ",
              "is_correct": false
            }
          ],
          "explanation": "A powerful question is assumption-free — it does not smuggle in the coach's own opinion. The moment a question contains the coach's hypothesis, it stops being a coaching question and becomes disguised advice.",
          "explanation_vi": "Một câu hỏi mạnh mẽ không chứa giả định — nó không lén đưa ý kiến riêng của coach vào. Ngay khi một câu hỏi chứa giả thuyết của coach, nó không còn là câu hỏi coaching nữa mà trở thành lời khuyên được ngụy trang."
        }
      ]
    }
  },
  {
    "id": "b0000000-0000-0000-0000-000000000003",
    "week_number": 3,
    "sort_order": 3,
    "title": "The SHIFT Model in Practice",
    "title_vi": "Mô hình SHIFT trong Thực hành",
    "subtitle": "Structuring a complete coaching conversation using Erickson's SHIFT framework",
    "subtitle_vi": "Cấu trúc một cuộc đối thoại coaching hoàn chỉnh sử dụng khung SHIFT của Erickson",
    "is_visible": true,
    "skill_card_visible": true,
    "unlock_date": "2026-09-22",
    "video_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "pdf_storage_path": "tasc-essential/week-3-shift-model-en.pdf",
    "pdf_storage_path_vi": "tasc-essential/week-3-shift-model-vi.pdf",
    "skill_card_html": "<div class=\"skill-card\"><h2>The SHIFT Model</h2><p>SHIFT is Erickson Coaching International's signature coaching conversation framework. It provides a complete structure for a coaching session — from contracting to commitment — while staying flexible enough to follow the client's energy.</p><h3>The Five Stages</h3><ol><li><strong>S — Set the Foundation</strong>: Establish rapport, clarify the coaching agreement for this session. \"What would make this session valuable for you today?\"</li><li><strong>H — Hear the Current Situation</strong>: Explore what is happening now — facts, feelings, and the gap between current reality and the desired state.</li><li><strong>I — Identify the Desired Outcome</strong>: Help the client articulate a clear, compelling vision of what they want. Make it sensory-rich: \"What will you see, hear, and feel when this is working?\"</li><li><strong>F — Find Resources and Options</strong>: Expand the client's awareness of what they already have (strengths, past successes, relationships) and brainstorm new possibilities.</li><li><strong>T — Take Action</strong>: Narrow to a specific, time-bound commitment. \"What is one thing you will do before our next session?\"</li></ol><h3>Common Pitfalls</h3><ul><li>Jumping to \"T\" (action) before the client has fully explored \"I\" (desired outcome)</li><li>Spending too long in \"H\" (current situation) — this can become venting without direction</li><li>Skipping \"S\" (set the foundation) — without a clear contract, the session drifts</li></ul><h3>Practice This Week</h3><p>Record a 20-minute practice coaching session with a peer. Afterward, map each part of the conversation to S-H-I-F-T. Where did you spend the most time? Where did you skip?</p></div>",
    "skill_card_html_vi": "<div class=\"skill-card\"><h2>Mô hình SHIFT</h2><p>SHIFT là khung đối thoại coaching đặc trưng của Erickson Coaching International. Nó cung cấp cấu trúc hoàn chỉnh cho một session coaching — từ thiết lập hợp đồng đến cam kết — trong khi đủ linh hoạt để theo năng lượng của khách hàng.</p><h3>Năm Giai đoạn</h3><ol><li><strong>S — Thiết lập Nền tảng</strong>: Xây dựng mối quan hệ, làm rõ thỏa thuận coaching cho session này. \"Điều gì sẽ làm cho session hôm nay có giá trị với bạn?\"</li><li><strong>H — Lắng nghe Tình huống Hiện tại</strong>: Khám phá điều gì đang diễn ra — sự kiện, cảm xúc, và khoảng cách giữa thực tại và trạng thái mong muốn.</li><li><strong>I — Xác định Kết quả Mong muốn</strong>: Giúp khách hàng diễn đạt tầm nhìn rõ ràng, hấp dẫn về điều họ muốn. Làm cho nó giàu cảm giác: \"Bạn sẽ thấy, nghe và cảm nhận gì khi điều này hoạt động?\"</li><li><strong>F — Tìm Nguồn lực và Lựa chọn</strong>: Mở rộng nhận thức của khách hàng về những gì họ đã có (thế mạnh, thành công quá khứ, các mối quan hệ) và sáng tạo những khả năng mới.</li><li><strong>T — Hành động</strong>: Thu hẹp thành cam kết cụ thể, có thời hạn. \"Một điều bạn sẽ làm trước session tiếp theo là gì?\"</li></ol><h3>Những Sai lầm Thường gặp</h3><ul><li>Nhảy sang \"T\" (hành động) trước khi khách hàng khám phá hết \"I\" (kết quả mong muốn)</li><li>Dành quá nhiều thời gian ở \"H\" (tình huống hiện tại) — có thể trở thành than phiền không định hướng</li><li>Bỏ qua \"S\" (thiết lập nền tảng) — không có hợp đồng rõ ràng, session sẽ trôi dạt</li></ul><h3>Thực hành Tuần này</h3><p>Ghi lại một session coaching thực hành 20 phút với đồng nghiệp. Sau đó, ánh xạ từng phần của cuộc trò chuyện vào S-H-I-F-T. Bạn dành nhiều thời gian nhất ở đâu? Bạn đã bỏ qua chỗ nào?</p></div>",
    "dailyPrompts": [
      {
        "day_offset": 1,
        "sort_order": 1,
        "is_visible": true,
        "prompt_text": "In your next conversation, consciously try to identify which SHIFT stage the other person seems to be in. Are they exploring their situation (H), or ready for action (T)?",
        "prompt_text_vi": "Trong cuộc trò chuyện tiếp theo, hãy có ý thức xác định giai đoạn SHIFT nào mà người kia dường như đang ở. Họ đang khám phá tình huống (H), hay sẵn sàng hành động (T)?"
      },
      {
        "day_offset": 2,
        "sort_order": 2,
        "is_visible": true,
        "prompt_text": "Think about a goal you are working on right now. Describe it in sensory terms: what will you see, hear, and feel when you achieve it? (This is the \"I\" in SHIFT.)",
        "prompt_text_vi": "Hãy nghĩ về một mục tiêu bạn đang thực hiện. Mô tả nó bằng các thuật ngữ giác quan: bạn sẽ thấy, nghe, và cảm nhận gì khi đạt được nó? (Đây là \"I\" trong SHIFT.)"
      },
      {
        "day_offset": 3,
        "sort_order": 3,
        "is_visible": true,
        "prompt_text": "After a practice coaching conversation today, write down: which stage of SHIFT did I skip or rush through? What question could I have asked to stay in that stage longer?",
        "prompt_text_vi": "Sau cuộc đối thoại coaching thực hành hôm nay, viết ra: giai đoạn nào của SHIFT tôi đã bỏ qua hoặc vội vàng? Câu hỏi nào tôi có thể đã đặt để ở lại giai đoạn đó lâu hơn?"
      },
      {
        "day_offset": 4,
        "sort_order": 4,
        "is_visible": true,
        "prompt_text": "The \"F\" stage is about finding resources the client already has. What is a strength you have that you tend to forget about when you face challenges?",
        "prompt_text_vi": "Giai đoạn \"F\" là về tìm kiếm nguồn lực mà khách hàng đã có. Thế mạnh nào của bạn mà bạn thường quên đi khi đối mặt với thách thức?"
      },
      {
        "day_offset": 5,
        "sort_order": 5,
        "is_visible": true,
        "prompt_text": "On a scale of 1-10, how comfortable are you with silence in a coaching conversation? What would help you become more comfortable?",
        "prompt_text_vi": "Trên thang 1-10, bạn thoải mái đến mức nào với sự im lặng trong cuộc đối thoại coaching? Điều gì sẽ giúp bạn thoải mái hơn?"
      }
    ],
    "quiz": {
      "id": "c2000000-0000-0000-0000-000000000003",
      "title": "The SHIFT Model",
      "title_vi": "Mô hình SHIFT",
      "instructions": "Test your understanding of the five SHIFT stages. You can take this quiz once.",
      "instructions_vi": "Kiểm tra hiểu biết của bạn về năm giai đoạn SHIFT. Bạn có thể làm bài kiểm tra này một lần.",
      "sort_order": 1,
      "is_visible": true,
      "questions": [
        {
          "id": "c3300000-0000-0000-0000-000000000001",
          "sort_order": 1,
          "question_text": "What is the main purpose of the \"S — Set the Foundation\" stage of SHIFT?",
          "question_text_vi": "Mục đích chính của giai đoạn \"S — Thiết lập Nền tảng\" trong SHIFT là gì?",
          "options": [
            {
              "id": "a",
              "text": "To immediately identify the client's action steps",
              "text_vi": "Xác định ngay các bước hành động của khách hàng",
              "is_correct": false
            },
            {
              "id": "b",
              "text": "To build rapport and clarify what would make this specific session valuable",
              "text_vi": "Xây dựng mối quan hệ và làm rõ điều gì sẽ làm cho session cụ thể này có giá trị",
              "is_correct": true
            },
            {
              "id": "c",
              "text": "To review the client's progress since the last session in detail",
              "text_vi": "Xem xét chi tiết tiến độ của khách hàng kể từ session trước",
              "is_correct": false
            },
            {
              "id": "d",
              "text": "To explain the SHIFT model to the client",
              "text_vi": "Giải thích mô hình SHIFT cho khách hàng",
              "is_correct": false
            }
          ],
          "explanation": "S establishes the working agreement for this specific session — rapport plus a clear contract on what \"valuable\" looks like today, before any content is explored.",
          "explanation_vi": "S thiết lập thỏa thuận làm việc cho session cụ thể này — mối quan hệ cộng với hợp đồng rõ ràng về việc \"có giá trị\" trông như thế nào hôm nay, trước khi khám phá bất kỳ nội dung nào."
        },
        {
          "id": "c3300000-0000-0000-0000-000000000002",
          "sort_order": 2,
          "question_text": "What is the most common mistake coaches make when applying the SHIFT model?",
          "question_text_vi": "Sai lầm phổ biến nhất mà coach mắc phải khi áp dụng mô hình SHIFT là gì?",
          "options": [
            {
              "id": "a",
              "text": "Spending too much time in \"S\" (Set the Foundation)",
              "text_vi": "Dành quá nhiều thời gian ở \"S\" (Thiết lập Nền tảng)",
              "is_correct": false
            },
            {
              "id": "b",
              "text": "Jumping to \"T\" (Take Action) before the client has fully explored \"I\" (Identify the Desired Outcome)",
              "text_vi": "Nhảy sang \"T\" (Hành động) trước khi khách hàng khám phá đầy đủ \"I\" (Xác định Kết quả Mong muốn)",
              "is_correct": true
            },
            {
              "id": "c",
              "text": "Using too many open questions",
              "text_vi": "Sử dụng quá nhiều câu hỏi mở",
              "is_correct": false
            },
            {
              "id": "d",
              "text": "Ending the session exactly on time",
              "text_vi": "Kết thúc session đúng giờ",
              "is_correct": false
            }
          ],
          "explanation": "Coaches under time pressure often rush toward a concrete action step before the client has a compelling, sensory-rich picture of what they actually want, which weakens motivation and follow-through.",
          "explanation_vi": "Coach dưới áp lực thời gian thường vội vàng hướng đến một bước hành động cụ thể trước khi khách hàng có một hình ảnh hấp dẫn, giàu cảm giác về điều họ thực sự muốn, điều này làm suy yếu động lực và việc thực hiện."
        },
        {
          "id": "c3300000-0000-0000-0000-000000000003",
          "sort_order": 3,
          "question_text": "What does it mean to make a desired outcome \"sensory-rich\" during the \"I\" stage?",
          "question_text_vi": "Việc làm cho kết quả mong muốn \"giàu cảm giác\" trong giai đoạn \"I\" có nghĩa là gì?",
          "options": [
            {
              "id": "a",
              "text": "Describing the outcome only in terms of numbers and deadlines",
              "text_vi": "Chỉ mô tả kết quả bằng con số và thời hạn",
              "is_correct": false
            },
            {
              "id": "b",
              "text": "Asking the client what they will see, hear, and feel when the outcome is achieved",
              "text_vi": "Hỏi khách hàng họ sẽ thấy, nghe và cảm nhận gì khi đạt được kết quả",
              "is_correct": true
            },
            {
              "id": "c",
              "text": "Focusing on the physical location where the goal will be achieved",
              "text_vi": "Tập trung vào địa điểm vật lý nơi mục tiêu sẽ đạt được",
              "is_correct": false
            },
            {
              "id": "d",
              "text": "Listing every possible obstacle in vivid detail",
              "text_vi": "Liệt kê mọi trở ngại có thể xảy ra một cách chi tiết sống động",
              "is_correct": false
            }
          ],
          "explanation": "Sensory-rich language engages the client's imagination across sight, sound, and feeling, making the desired outcome vivid and motivating rather than abstract.",
          "explanation_vi": "Ngôn ngữ giàu cảm giác thu hút trí tưởng tượng của khách hàng qua thị giác, thính giác và cảm xúc, làm cho kết quả mong muốn trở nên sống động và tạo động lực thay vì trừu tượng."
        },
        {
          "id": "c3300000-0000-0000-0000-000000000004",
          "sort_order": 4,
          "question_text": "What is the purpose of the \"F — Find Resources and Options\" stage?",
          "question_text_vi": "Mục đích của giai đoạn \"F — Tìm Nguồn lực và Lựa chọn\" là gì?",
          "options": [
            {
              "id": "a",
              "text": "To tell the client which resources they should use",
              "text_vi": "Cho khách hàng biết họ nên sử dụng nguồn lực nào",
              "is_correct": false
            },
            {
              "id": "b",
              "text": "To expand the client's awareness of strengths and past successes they already have, and to brainstorm new possibilities",
              "text_vi": "Mở rộng nhận thức của khách hàng về những thế mạnh và thành công quá khứ họ đã có, và sáng tạo những khả năng mới",
              "is_correct": true
            },
            {
              "id": "c",
              "text": "To move directly to scheduling the next session",
              "text_vi": "Chuyển thẳng sang việc lên lịch session tiếp theo",
              "is_correct": false
            },
            {
              "id": "d",
              "text": "To evaluate whether the client is capable of achieving the goal",
              "text_vi": "Đánh giá xem khách hàng có khả năng đạt được mục tiêu hay không",
              "is_correct": false
            }
          ],
          "explanation": "F surfaces resources the client already has — strengths, relationships, past wins — rather than the coach supplying solutions, and opens space for new options the client had not yet considered.",
          "explanation_vi": "F làm nổi bật những nguồn lực khách hàng đã có — thế mạnh, các mối quan hệ, chiến thắng trong quá khứ — thay vì coach cung cấp giải pháp, và mở ra không gian cho những lựa chọn mới mà khách hàng chưa từng nghĩ đến."
        }
      ]
    }
  },
  {
    "id": "b0000000-0000-0000-0000-000000000004",
    "week_number": 4,
    "sort_order": 4,
    "title": "Integration & Sustainable Change",
    "title_vi": "Tích hợp & Thay đổi Bền vững",
    "subtitle": "Accountability, ICF ethics, and building your coaching practice",
    "subtitle_vi": "Trách nhiệm giải trình, đạo đức ICF, và xây dựng thực hành coaching",
    "is_visible": true,
    "skill_card_visible": true,
    "unlock_date": "2026-09-29",
    "video_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "pdf_storage_path": "tasc-essential/week-4-integration-en.pdf",
    "pdf_storage_path_vi": "tasc-essential/week-4-integration-vi.pdf",
    "skill_card_html": "<div class=\"skill-card\"><h2>Integration & Sustainable Change</h2><p>The final week brings everything together: mindset, questioning, the SHIFT structure, and now — how to make coaching stick. A great session means nothing if the client walks away and nothing changes.</p><h3>The Accountability Partnership</h3><ul><li><strong>Commitment, not compliance</strong>: The client chooses their action, not the coach.</li><li><strong>Follow-up is not follow-through</strong>: Ask \"What happened with X?\" at the start of the next session — always.</li><li><strong>Celebrate progress, not perfection</strong>: Even partial action is evidence of movement.</li></ul><h3>ICF Core Competencies Covered</h3><ol><li>Demonstrates Ethical Practice</li><li>Embodies a Coaching Mindset</li><li>Establishes and Maintains Agreements</li><li>Cultivates Trust and Safety</li><li>Maintains Presence</li><li>Listens Actively</li><li>Evokes Awareness</li><li>Facilitates Client Growth</li></ol><h3>Building Your Practice</h3><ul><li>Log every practice session — hours count toward ICF credentialing</li><li>Find a mentor coach (this platform supports it — check the Mentoring tab)</li><li>Join or form a triad group for peer observation and feedback</li><li>Re-rate your own coaching confidence at the end of this programme</li></ul><h3>Final Reflection</h3><p>What is one thing you believed about coaching before this programme that you now see differently? Write it down. That shift IS the learning.</p></div>",
    "skill_card_html_vi": "<div class=\"skill-card\"><h2>Tích hợp & Thay đổi Bền vững</h2><p>Tuần cuối cùng kết nối tất cả: tư duy, đặt câu hỏi, cấu trúc SHIFT, và bây giờ — làm thế nào để coaching có hiệu quả lâu dài. Một session tuyệt vời không có ý nghĩa gì nếu khách hàng rời đi và không có gì thay đổi.</p><h3>Quan hệ Đối tác Trách nhiệm</h3><ul><li><strong>Cam kết, không phải tuân thủ</strong>: Khách hàng chọn hành động, không phải coach.</li><li><strong>Theo dõi không phải thực hiện thay</strong>: Hỏi \"Chuyện gì đã xảy ra với X?\" ở đầu session tiếp theo — luôn luôn.</li><li><strong>Ăn mừng tiến bộ, không phải sự hoàn hảo</strong>: Ngay cả hành động một phần cũng là bằng chứng của sự chuyển động.</li></ul><h3>Năng lực Cốt lõi ICF được Đề cập</h3><ol><li>Thể hiện Thực hành Đạo đức</li><li>Thể hiện Tư duy Coaching</li><li>Thiết lập và Duy trì Thỏa thuận</li><li>Nuôi dưỡng Niềm tin và Sự An toàn</li><li>Duy trì Sự Hiện diện</li><li>Lắng nghe Chủ động</li><li>Khơi gợi Nhận thức</li><li>Hỗ trợ Sự Phát triển của Khách hàng</li></ol><h3>Xây dựng Thực hành</h3><ul><li>Ghi nhật ký mỗi session thực hành — số giờ tính vào chứng nhận ICF</li><li>Tìm một mentor coach (nền tảng này hỗ trợ — kiểm tra tab Mentoring)</li><li>Tham gia hoặc thành lập nhóm triad để quan sát và phản hồi</li><li>Đánh giá lại sự tự tin coaching của bạn vào cuối chương trình</li></ul><h3>Phản tư Cuối cùng</h3><p>Một điều bạn đã tin về coaching trước chương trình này mà bây giờ bạn nhìn khác là gì? Viết nó ra. Sự thay đổi đó CHÍNH LÀ bài học.</p></div>",
    "dailyPrompts": [
      {
        "day_offset": 1,
        "sort_order": 1,
        "is_visible": true,
        "prompt_text": "Think about a time someone held you accountable in a way that felt supportive, not controlling. What did they do differently from people who felt controlling?",
        "prompt_text_vi": "Nghĩ về một lần ai đó giữ trách nhiệm cho bạn theo cách cảm thấy hỗ trợ, không kiểm soát. Họ đã làm gì khác so với những người khiến bạn cảm thấy bị kiểm soát?"
      },
      {
        "day_offset": 2,
        "sort_order": 2,
        "is_visible": true,
        "prompt_text": "Which of the 8 ICF Core Competencies feels strongest in your practice right now? Which one needs the most development? Be specific about why.",
        "prompt_text_vi": "Năng lực cốt lõi ICF nào cảm thấy mạnh nhất trong thực hành coaching của bạn hiện tại? Năng lực nào cần phát triển nhất? Hãy cụ thể về lý do."
      },
      {
        "day_offset": 3,
        "sort_order": 3,
        "is_visible": true,
        "prompt_text": "If you were to describe your emerging coaching style in three words, what would they be? How does this style serve your clients?",
        "prompt_text_vi": "Nếu bạn mô tả phong cách coaching đang hình thành của mình bằng ba từ, đó sẽ là gì? Phong cách này phục vụ khách hàng như thế nào?"
      },
      {
        "day_offset": 4,
        "sort_order": 4,
        "is_visible": true,
        "prompt_text": "Write a commitment to yourself: \"By the end of next month, I will have completed ___ practice coaching sessions.\" Make it specific and realistic.",
        "prompt_text_vi": "Viết một cam kết với chính mình: \"Đến cuối tháng tới, tôi sẽ hoàn thành ___ session coaching thực hành.\" Hãy cụ thể và thực tế."
      },
      {
        "day_offset": 5,
        "sort_order": 5,
        "is_visible": true,
        "prompt_text": "Looking back at Day 1 of this programme: what is one belief about coaching that has shifted for you? What caused that shift?",
        "prompt_text_vi": "Nhìn lại Ngày 1 của chương trình: một niềm tin nào về coaching đã thay đổi ở bạn? Điều gì đã gây ra sự thay đổi đó?"
      }
    ],
    "quiz": {
      "id": "c2000000-0000-0000-0000-000000000004",
      "title": "Integration & Ethics",
      "title_vi": "Tích hợp & Đạo đức",
      "instructions": "Test your understanding of accountability, ICF competencies, and building a sustainable coaching practice. You can take this quiz once.",
      "instructions_vi": "Kiểm tra hiểu biết của bạn về trách nhiệm giải trình, năng lực ICF, và xây dựng thực hành coaching bền vững. Bạn có thể làm bài kiểm tra này một lần.",
      "sort_order": 1,
      "is_visible": true,
      "questions": [
        {
          "id": "c3400000-0000-0000-0000-000000000001",
          "sort_order": 1,
          "question_text": "What is the key difference between accountability and control in a coaching relationship?",
          "question_text_vi": "Sự khác biệt chính giữa trách nhiệm giải trình và kiểm soát trong mối quan hệ coaching là gì?",
          "options": [
            {
              "id": "a",
              "text": "Accountability means the coach checks the client's work; control means the client checks their own work",
              "text_vi": "Trách nhiệm giải trình nghĩa là coach kiểm tra công việc của khách hàng; kiểm soát nghĩa là khách hàng tự kiểm tra công việc của mình",
              "is_correct": false
            },
            {
              "id": "b",
              "text": "The client chooses and owns their own commitment under accountability; under control, the coach dictates the action and enforces compliance",
              "text_vi": "Dưới trách nhiệm giải trình, khách hàng chọn và sở hữu cam kết của chính họ; dưới kiểm soát, coach áp đặt hành động và ép buộc tuân thủ",
              "is_correct": true
            },
            {
              "id": "c",
              "text": "There is no meaningful difference — both terms describe the same coaching behaviour",
              "text_vi": "Không có sự khác biệt đáng kể — cả hai thuật ngữ mô tả cùng một hành vi coaching",
              "is_correct": false
            },
            {
              "id": "d",
              "text": "Accountability only applies to group coaching, control only applies to 1:1 coaching",
              "text_vi": "Trách nhiệm giải trình chỉ áp dụng cho coaching nhóm, kiểm soát chỉ áp dụng cho coaching 1:1",
              "is_correct": false
            }
          ],
          "explanation": "Accountability is client-owned: the client sets and follows through on their own commitment, with the coach checking in supportively. Control shifts ownership to the coach, which undermines client resourcefulness.",
          "explanation_vi": "Trách nhiệm giải trình thuộc sở hữu của khách hàng: khách hàng đặt ra và thực hiện cam kết của chính họ, với coach theo dõi một cách hỗ trợ. Kiểm soát chuyển quyền sở hữu sang coach, điều này làm suy yếu nguồn lực của khách hàng."
        },
        {
          "id": "c3400000-0000-0000-0000-000000000002",
          "sort_order": 2,
          "question_text": "Which ICF Core Competency most directly relates to a coach staying flexible, observant, and attuned moment-to-moment during a session?",
          "question_text_vi": "Năng lực Cốt lõi ICF nào liên quan trực tiếp nhất đến việc coach giữ sự linh hoạt, quan sát, và đồng điệu theo từng khoảnh khắc trong session?",
          "options": [
            {
              "id": "a",
              "text": "Demonstrates Ethical Practice",
              "text_vi": "Thể hiện Thực hành Đạo đức",
              "is_correct": false
            },
            {
              "id": "b",
              "text": "Establishes and Maintains Agreements",
              "text_vi": "Thiết lập và Duy trì Thỏa thuận",
              "is_correct": false
            },
            {
              "id": "c",
              "text": "Maintains Presence",
              "text_vi": "Duy trì Sự Hiện diện",
              "is_correct": true
            },
            {
              "id": "d",
              "text": "Facilitates Client Growth",
              "text_vi": "Hỗ trợ Sự Phát triển của Khách hàng",
              "is_correct": false
            }
          ],
          "explanation": "Maintains Presence is being fully conscious and flexible during the session, staying attuned to the client moment-to-moment rather than following a fixed script.",
          "explanation_vi": "Duy trì Sự Hiện diện là hoàn toàn ý thức và linh hoạt trong session, đồng điệu với khách hàng theo từng khoảnh khắc thay vì theo một kịch bản cố định."
        },
        {
          "id": "c3400000-0000-0000-0000-000000000003",
          "sort_order": 3,
          "question_text": "In a company-sponsored coaching programme, how should a coach handle confidentiality?",
          "question_text_vi": "Trong một chương trình coaching được công ty tài trợ, coach nên xử lý bảo mật như thế nào?",
          "options": [
            {
              "id": "a",
              "text": "Share session content freely with the sponsor since they are paying for the programme",
              "text_vi": "Chia sẻ nội dung session tự do với nhà tài trợ vì họ đang trả tiền cho chương trình",
              "is_correct": false
            },
            {
              "id": "b",
              "text": "Keep session content confidential, sharing only what the client explicitly agrees to (e.g. aggregated progress or goals marked shared)",
              "text_vi": "Giữ bí mật nội dung session, chỉ chia sẻ những gì khách hàng đồng ý rõ ràng (ví dụ: tiến độ tổng hợp hoặc mục tiêu được đánh dấu chia sẻ)",
              "is_correct": true
            },
            {
              "id": "c",
              "text": "Only keep confidentiality if the client specifically requests it in writing",
              "text_vi": "Chỉ giữ bí mật nếu khách hàng yêu cầu cụ thể bằng văn bản",
              "is_correct": false
            },
            {
              "id": "d",
              "text": "Confidentiality does not apply in sponsored programmes",
              "text_vi": "Bảo mật không áp dụng trong các chương trình được tài trợ",
              "is_correct": false
            }
          ],
          "explanation": "ICF ethics require the coach to maintain strict confidentiality with client information, disclosing only what the client has explicitly agreed to share — even when a third party is sponsoring the engagement.",
          "explanation_vi": "Đạo đức ICF yêu cầu coach duy trì bảo mật nghiêm ngặt với thông tin khách hàng, chỉ tiết lộ những gì khách hàng đã đồng ý rõ ràng để chia sẻ — ngay cả khi một bên thứ ba đang tài trợ cho chương trình."
        },
        {
          "id": "c3400000-0000-0000-0000-000000000004",
          "sort_order": 4,
          "question_text": "What most contributes to coaching being \"sustainable\" after a formal programme ends?",
          "question_text_vi": "Điều gì góp phần nhiều nhất để coaching trở nên \"bền vững\" sau khi một chương trình chính thức kết thúc?",
          "options": [
            {
              "id": "a",
              "text": "The client memorising the coach's advice",
              "text_vi": "Khách hàng ghi nhớ lời khuyên của coach",
              "is_correct": false
            },
            {
              "id": "b",
              "text": "The client internalising the coaching mindset and questioning habits so they can continue applying them independently",
              "text_vi": "Khách hàng nội tâm hóa tư duy coaching và thói quen đặt câu hỏi để họ có thể tiếp tục áp dụng một cách độc lập",
              "is_correct": true
            },
            {
              "id": "c",
              "text": "Scheduling as many sessions as possible before the programme ends",
              "text_vi": "Lên lịch càng nhiều session càng tốt trước khi chương trình kết thúc",
              "is_correct": false
            },
            {
              "id": "d",
              "text": "Ensuring the coach remains available indefinitely after the programme",
              "text_vi": "Đảm bảo coach luôn sẵn sàng vô thời hạn sau chương trình",
              "is_correct": false
            }
          ],
          "explanation": "Sustainable change happens when the client has internalised the mindset and skills (self-questioning, resourcefulness, accountability) rather than depending on the coach's continued presence.",
          "explanation_vi": "Thay đổi bền vững xảy ra khi khách hàng đã nội tâm hóa tư duy và kỹ năng (tự đặt câu hỏi, nguồn lực, trách nhiệm giải trình) thay vì phụ thuộc vào sự hiện diện liên tục của coach."
        }
      ]
    }
  }
];

const REFLECTIONS = [
  {
    "id": "c4000000-0000-0000-0000-000000000001",
    "reflection_number": 1,
    "title": "Mid-Programme Reflection: Your Coaching Journey So Far",
    "title_vi": "Phản tư Giữa chương trình: Hành trình Coaching của Bạn",
    "instructions": "Take 10 minutes to reflect on your first two weeks. There are no right answers — this is about noticing your own growth and identifying what needs attention.",
    "instructions_vi": "Dành 10 phút để phản tư về hai tuần đầu tiên. Không có câu trả lời đúng — đây là về việc nhận ra sự phát triển của bạn và xác định điều gì cần chú ý.",
    "appears_at_week": 2,
    "is_visible": true,
    "questions": [
      {
        "id": "c5100000-0000-0000-0000-000000000001",
        "sort_order": 1,
        "question_type": "open_text",
        "is_required": true,
        "question_text": "What has been your biggest insight about coaching so far?",
        "question_text_vi": "Cái nhìn sâu sắc lớn nhất của bạn về coaching cho đến nay là gì?"
      },
      {
        "id": "c5100000-0000-0000-0000-000000000002",
        "sort_order": 2,
        "question_type": "scale_1_10",
        "is_required": true,
        "question_text": "How confident do you feel asking open-ended questions instead of giving advice?",
        "question_text_vi": "Bạn tự tin đến mức nào khi đặt câu hỏi mở thay vì đưa ra lời khuyên?"
      },
      {
        "id": "c5100000-0000-0000-0000-000000000003",
        "sort_order": 3,
        "question_type": "open_text",
        "is_required": false,
        "question_text": "Describe a moment this week where you successfully held back from advising and asked a question instead. What happened?",
        "question_text_vi": "Mô tả một khoảnh khắc tuần này khi bạn thành công trong việc kiềm chế lời khuyên và đặt câu hỏi thay vào đó. Điều gì đã xảy ra?"
      },
      {
        "id": "c5100000-0000-0000-0000-000000000004",
        "sort_order": 4,
        "question_type": "scale_1_10",
        "is_required": true,
        "question_text": "How would you rate your active listening skills right now?",
        "question_text_vi": "Bạn đánh giá kỹ năng lắng nghe chủ động của mình hiện tại như thế nào?"
      },
      {
        "id": "c5100000-0000-0000-0000-000000000005",
        "sort_order": 5,
        "question_type": "open_text",
        "is_required": true,
        "question_text": "What is one specific area you want to focus on improving in weeks 3 and 4?",
        "question_text_vi": "Một lĩnh vực cụ thể bạn muốn tập trung cải thiện trong tuần 3 và 4 là gì?"
      }
    ]
  },
  {
    "id": "c4000000-0000-0000-0000-000000000002",
    "reflection_number": 2,
    "title": "Final Reflection: Measuring Your Growth",
    "title_vi": "Phản tư Cuối cùng: Đo lường Sự Phát triển",
    "instructions": "This is your final programme reflection. Be honest with yourself — the value of this exercise is in noticing what has genuinely shifted, not in performing progress.",
    "instructions_vi": "Đây là phản tư cuối cùng của chương trình. Hãy thành thật với chính mình — giá trị của bài tập này nằm ở việc nhận ra điều gì đã thực sự thay đổi, không phải ở việc thể hiện sự tiến bộ.",
    "appears_at_week": 4,
    "is_visible": true,
    "questions": [
      {
        "id": "c5200000-0000-0000-0000-000000000001",
        "sort_order": 1,
        "question_type": "scale_1_10",
        "is_required": true,
        "question_text": "How confident do you feel conducting a full coaching session using the SHIFT model?",
        "question_text_vi": "Bạn tự tin đến mức nào khi thực hiện một session coaching đầy đủ sử dụng mô hình SHIFT?"
      },
      {
        "id": "c5200000-0000-0000-0000-000000000002",
        "sort_order": 2,
        "question_type": "open_text",
        "is_required": true,
        "question_text": "What is the single most important thing you have learned in this programme?",
        "question_text_vi": "Điều quan trọng nhất bạn đã học được trong chương trình này là gì?"
      },
      {
        "id": "c5200000-0000-0000-0000-000000000003",
        "sort_order": 3,
        "question_type": "open_text",
        "is_required": true,
        "question_text": "How has your understanding of the coach's role changed since week 1?",
        "question_text_vi": "Hiểu biết của bạn về vai trò của coach đã thay đổi như thế nào kể từ tuần 1?"
      },
      {
        "id": "c5200000-0000-0000-0000-000000000004",
        "sort_order": 4,
        "question_type": "scale_1_10",
        "is_required": true,
        "question_text": "Rate your overall readiness to coach a real client:",
        "question_text_vi": "Đánh giá mức độ sẵn sàng tổng thể của bạn để coach một khách hàng thực:"
      },
      {
        "id": "c5200000-0000-0000-0000-000000000005",
        "sort_order": 5,
        "question_type": "open_text",
        "is_required": true,
        "question_text": "What will you do in the next 30 days to continue developing your coaching skills? Be specific.",
        "question_text_vi": "Bạn sẽ làm gì trong 30 ngày tới để tiếp tục phát triển kỹ năng coaching? Hãy cụ thể."
      },
      {
        "id": "c5200000-0000-0000-0000-000000000006",
        "sort_order": 6,
        "question_type": "scale_1_10",
        "is_required": false,
        "question_text": "How effectively did the triad practice sessions support your learning?",
        "question_text_vi": "Các session thực hành triad hỗ trợ việc học tập của bạn hiệu quả đến mức nào?"
      }
    ]
  }
];

const TRIAD_ROUNDS = [
  {
    "id": "c6000000-0000-0000-0000-000000000001",
    "round_number": 1,
    "title": "Triad Practice Round 1: Basic Coaching Conversation",
    "title_vi": "Vòng Thực hành Triad 1: Cuộc đối thoại Coaching Cơ bản",
    "training_week_id": "b0000000-0000-0000-0000-000000000002",
    "completion_deadline": "2026-09-21",
    "auto_assign_date": "2026-09-15",
    "auto_assign_status": "pending",
    "is_visible": true
  },
  {
    "id": "c6000000-0000-0000-0000-000000000002",
    "round_number": 2,
    "title": "Triad Practice Round 2: Full SHIFT Session",
    "title_vi": "Vòng Thực hành Triad 2: Session SHIFT Đầy đủ",
    "training_week_id": "b0000000-0000-0000-0000-000000000004",
    "completion_deadline": "2026-10-05",
    "auto_assign_date": "2026-09-29",
    "auto_assign_status": "pending",
    "is_visible": true
  }
];

function promptId(week: number, day: number): string {
  return `c1000000-0000-0000-0000-0000000000${week}${day}`;
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req, {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  });
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  const token = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
  const isServiceRole = token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const { data: userData } = isServiceRole ? { data: null } : await admin.auth.getUser(token);
  if (!isServiceRole && !userData?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  let isAdmin = isServiceRole;
  if (!isAdmin) {
    const { data } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userData!.user!.id)
      .eq("role", "admin")
      .maybeSingle();
    isAdmin = !!data;
  }
  if (!isAdmin) {
    return new Response(JSON.stringify({ error: "Admins only" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // ---- 1. Programme (resolve by name; update in place if it already exists) ----
    // Never upsert PROGRAMME.id directly: a plain upsert would include "id" in
    // the ON CONFLICT DO UPDATE SET clause, which tries to change the primary
    // key of a pre-existing row and breaks the FK from cohorts.programme_id.
    const { data: existingProgramme } = await admin
      .from("programmes")
      .select("id")
      .eq("name", PROGRAMME.name)
      .maybeSingle();
    let programmeId: string;
    if (existingProgramme) {
      programmeId = existingProgramme.id;
      const { error } = await admin.from("programmes").update({ ...PROGRAMME, id: undefined }).eq("id", programmeId);
      if (error) throw error;
    } else {
      const { data, error } = await admin.from("programmes").insert(PROGRAMME).select("id").single();
      if (error) throw error;
      programmeId = data.id;
    }

    // ---- 2. Programme modules ----
    for (const m of MODULES) {
      const { error } = await admin
        .from("programme_modules")
        .upsert({ ...m, programme_id: programmeId }, { onConflict: "programme_id,module" });
      if (error) throw error;
    }

    // ---- 3. Cohort (resolve by name within this programme) ----
    const { data: existingCohort } = await admin
      .from("cohorts")
      .select("id")
      .eq("programme_id", programmeId)
      .eq("name", COHORT.name)
      .maybeSingle();
    let cohortId: string;
    if (existingCohort) {
      cohortId = existingCohort.id;
      const { error } = await admin.from("cohorts").update({ ...COHORT, id: undefined, programme_id: programmeId }).eq("id", cohortId);
      if (error) throw error;
    } else {
      const { data, error } = await admin.from("cohorts").insert({ ...COHORT, programme_id: programmeId }).select("id").single();
      if (error) throw error;
      cohortId = data.id;
    }

    // ---- 4-6. Training weeks + daily prompts + quizzes ----
    const weekIds: string[] = [];
    const quizIds: string[] = [];
    for (const w of WEEKS as any[]) {
      const { dailyPrompts, quiz, id: _weekFallbackId, ...weekRow } = w;
      const { data: existingWeek } = await admin
        .from("training_weeks")
        .select("id")
        .eq("programme_id", programmeId)
        .eq("week_number", w.week_number)
        .maybeSingle();
      let weekId: string;
      if (existingWeek) {
        weekId = existingWeek.id;
        const { error } = await admin.from("training_weeks").update({ ...weekRow, programme_id: programmeId }).eq("id", weekId);
        if (error) throw error;
      } else {
        const { data, error } = await admin.from("training_weeks").insert({ ...weekRow, programme_id: programmeId }).select("id").single();
        if (error) throw error;
        weekId = data.id;
      }
      weekIds.push(weekId);

      // Replace any existing daily prompts for this week with the real ones
      { const { error } = await admin.from("daily_prompts").delete().eq("training_week_id", weekId); if (error) throw error; }
      for (const dp of dailyPrompts) {
        const { error } = await admin
          .from("daily_prompts")
          .insert({ ...dp, id: promptId(w.week_number, dp.day_offset), training_week_id: weekId });
        if (error) throw error;
      }

      // Quiz: resolve the existing quiz-type assignment for this week, if any
      const { questions, id: _quizFallbackId, ...assignmentRow } = quiz;
      const { data: existingQuiz } = await admin
        .from("assignments")
        .select("id")
        .eq("training_week_id", weekId)
        .eq("assignment_type", "quiz")
        .maybeSingle();
      let quizId: string;
      if (existingQuiz) {
        quizId = existingQuiz.id;
        const { error } = await admin.from("assignments").update({ ...assignmentRow, training_week_id: weekId, assignment_type: "quiz" }).eq("id", quizId);
        if (error) throw error;
      } else {
        const { data, error } = await admin.from("assignments").insert({ ...assignmentRow, training_week_id: weekId, assignment_type: "quiz" }).select("id").single();
        if (error) throw error;
        quizId = data.id;
      }
      quizIds.push(quizId);
      { const { error } = await admin.from("quiz_questions").delete().eq("assignment_id", quizId); if (error) throw error; }
      for (const q of questions) {
        const { error } = await admin.from("quiz_questions").insert({ ...q, assignment_id: quizId });
        if (error) throw error;
      }
    }

    // ---- 7. Programme reflections + reflection questions ----
    const reflectionIds: string[] = [];
    for (const r of REFLECTIONS as any[]) {
      const { questions, id: _reflFallbackId, ...reflectionRow } = r;
      const { data: existingRefl } = await admin
        .from("programme_reflections")
        .select("id")
        .eq("programme_id", programmeId)
        .eq("reflection_number", r.reflection_number)
        .maybeSingle();
      let reflectionId: string;
      if (existingRefl) {
        reflectionId = existingRefl.id;
        const { error } = await admin.from("programme_reflections").update({ ...reflectionRow, programme_id: programmeId }).eq("id", reflectionId);
        if (error) throw error;
      } else {
        const { data, error } = await admin.from("programme_reflections").insert({ ...reflectionRow, programme_id: programmeId }).select("id").single();
        if (error) throw error;
        reflectionId = data.id;
      }
      reflectionIds.push(reflectionId);
      { const { error } = await admin.from("reflection_questions").delete().eq("reflection_id", reflectionId); if (error) throw error; }
      for (const q of questions) {
        const { error } = await admin.from("reflection_questions").insert({ ...q, reflection_id: reflectionId });
        if (error) throw error;
      }
    }

    // ---- 8. Triad rounds ----
    const roundIds: string[] = [];
    for (const tr of TRIAD_ROUNDS as any[]) {
      const { id: _roundFallbackId, ...roundRow } = tr;
      const weekIdx = WEEKS.findIndex((w: any) => w.id === tr.training_week_id);
      const trainingWeekId = weekIdx >= 0 ? weekIds[weekIdx] : null;
      const { data: existingRound } = await admin
        .from("triad_rounds")
        .select("id")
        .eq("programme_id", programmeId)
        .eq("round_number", tr.round_number)
        .maybeSingle();
      let roundId: string;
      if (existingRound) {
        roundId = existingRound.id;
        const { error } = await admin.from("triad_rounds").update({ ...roundRow, programme_id: programmeId, training_week_id: trainingWeekId }).eq("id", roundId);
        if (error) throw error;
      } else {
        const { data, error } = await admin.from("triad_rounds").insert({ ...roundRow, programme_id: programmeId, training_week_id: trainingWeekId }).select("id").single();
        if (error) throw error;
        roundId = data.id;
      }
      roundIds.push(roundId);
    }

    // ============================================================
    // Session / feedback test data for trang.tt@hsp.consulting.
    // ============================================================
    let trangSeed: Record<string, unknown> = { skipped: true, reason: "not attempted" };

    const { data: trangProfile } = await admin
      .from("profiles")
      .select("id")
      .eq("email", TRANG_EMAIL)
      .maybeSingle();

    if (!trangProfile) {
      trangSeed = { skipped: true, reason: `User ${TRANG_EMAIL} not found` };
    } else {
      const trangId: string = trangProfile.id;

      // Excludes Trang herself: she may carry a 'coach' role on the target
      // project, so without this exclusion she could be picked as her own coach.
      const { data: coachRows } = await admin
        .from("user_roles")
        .select("user_id")
        .eq("role", "coach")
        .neq("user_id", trangId)
        .limit(3);
      const coach1Id: string | undefined = coachRows?.[0]?.user_id;
      const coach2Id: string = coachRows?.[1]?.user_id ?? coach1Id!;

      const { data: coacheeRows } = await admin
        .from("user_roles")
        .select("user_id")
        .eq("role", "coachee")
        .neq("user_id", trangId)
        .limit(3);
      const peer1Id: string | undefined = coacheeRows?.[0]?.user_id;
      const peer2Id: string = coacheeRows?.[1]?.user_id ?? peer1Id!;

      if (!coach1Id) {
        trangSeed = { skipped: true, reason: "No coach found (other than Trang herself)" };
      } else {
    // 9. Programme enrollment (update in place if she's already enrolled)
    const { data: existingEnrollment } = await admin.from("programme_enrollments").select("id").eq("user_id", trangId).eq("programme_id", programmeId).maybeSingle();
    if (existingEnrollment) {
      const { error } = await admin.from("programme_enrollments").update({
        cohort_id: cohortId,
        status: "active",
        start_date: "2026-09-08",
        end_date: "2026-10-06",
        progress_pct: 55,
        notes: "Pilot participant — joined from day 1",
      }).eq("id", existingEnrollment.id);
      if (error) throw error;
    } else {
      const { error } = await admin.from("programme_enrollments").insert({
        user_id: trangId, coachee_id: trangId, programme_id: programmeId, cohort_id: cohortId,
        status: "active", start_date: "2026-09-08",
        end_date: "2026-10-06", progress_pct: 55, notes: "Pilot participant — joined from day 1",
      });
      if (error) throw error;
    }

      // 10. Coachee goals, ratings, milestones (added alongside any pre-existing goals)
      { const { error } = await admin.from("coachee_goals").upsert(
      {
        "id": "d0000000-0000-0000-0000-000000000001",
        "coachee_id": trangId,
        "title": "Ask powerful questions instead of giving advice",
        "description": "Break the habit of jumping to solutions in conversations. Practice open-ended questions that help others find their own answers.",
        "status": "active",
        "sort_order": 1,
        "shared_with_sponsor": true,
        "target_date": "2026-10-06"
      }
      , { onConflict: "id" }); if (error) throw error; }
      { const { error } = await admin.from("coachee_goal_ratings").upsert(
      {
        "goal_id": "d0000000-0000-0000-0000-000000000001",
        "coachee_id": trangId,
        "start_rating": 3,
        "current_rating": 6,
        "target_rating": 8
      }
      , { onConflict: "goal_id" }); if (error) throw error; }
      { const { error } = await admin.from("coachee_milestones").upsert(
      {
        "id": "f2d20658-102f-4bf5-b24d-dda1de9b7e30",
        "goal_id": "d0000000-0000-0000-0000-000000000001",
        "coachee_id": trangId,
        "title": "Complete one full conversation using only questions",
        "sort_order": 1,
        "is_done": true,
        "done_at": "2026-09-12T10:00:00Z"
      }
      , { onConflict: "id" }); if (error) throw error; }
      { const { error } = await admin.from("coachee_milestones").upsert(
      {
        "id": "6d184b7b-3f8f-4a22-b181-75f49f5622b3",
        "goal_id": "d0000000-0000-0000-0000-000000000001",
        "coachee_id": trangId,
        "title": "Get feedback from peer on questioning quality",
        "sort_order": 2,
        "is_done": true,
        "done_at": "2026-09-19T14:00:00Z"
      }
      , { onConflict: "id" }); if (error) throw error; }
      { const { error } = await admin.from("coachee_milestones").upsert(
      {
        "id": "35072318-c0e3-4c55-8270-3f69015e3049",
        "goal_id": "d0000000-0000-0000-0000-000000000001",
        "coachee_id": trangId,
        "title": "Apply powerful questions in a real work meeting",
        "sort_order": 3,
        "is_done": false,
        "done_at": null
      }
      , { onConflict: "id" }); if (error) throw error; }
      { const { error } = await admin.from("coachee_goals").upsert(
      {
        "id": "d0000000-0000-0000-0000-000000000002",
        "coachee_id": trangId,
        "title": "Structure conversations using the SHIFT model",
        "description": "Be able to guide a complete 30-minute coaching conversation through all five SHIFT stages without losing the client or rushing to action.",
        "status": "active",
        "sort_order": 2,
        "shared_with_sponsor": true,
        "target_date": "2026-10-06"
      }
      , { onConflict: "id" }); if (error) throw error; }
      { const { error } = await admin.from("coachee_goal_ratings").upsert(
      {
        "goal_id": "d0000000-0000-0000-0000-000000000002",
        "coachee_id": trangId,
        "start_rating": 2,
        "current_rating": 5,
        "target_rating": 8
      }
      , { onConflict: "goal_id" }); if (error) throw error; }
      { const { error } = await admin.from("coachee_goals").upsert(
      {
        "id": "d0000000-0000-0000-0000-000000000003",
        "coachee_id": trangId,
        "title": "Hold silence without filling it",
        "description": "Develop comfort with 5-10 seconds of silence after asking a question, giving the client space to think deeply.",
        "status": "active",
        "sort_order": 3,
        "shared_with_sponsor": false,
        "target_date": "2026-10-06"
      }
      , { onConflict: "id" }); if (error) throw error; }
      { const { error } = await admin.from("coachee_goal_ratings").upsert(
      {
        "goal_id": "d0000000-0000-0000-0000-000000000003",
        "coachee_id": trangId,
        "start_rating": 2,
        "current_rating": 4,
        "target_rating": 7
      }
      , { onConflict: "goal_id" }); if (error) throw error; }

      // 11. Coaching sessions with coach1
      { const { error } = await admin.from("sessions").upsert(
      {
        "id": "e0000000-0000-0000-0000-000000000001",
        "coach_id": coach1Id,
        "coachee_id": trangId,
        "topic": "Understanding my coaching mindset — where I default to advice-giving",
        "start_time": "2026-09-10T09:00:00+07:00",
        "duration_minutes": 60,
        "status": "completed",
        "confirmed_at": "2026-09-09T10:00:00Z",
        "meeting_url": "https://zoom.us/j/1234567890",
        "coach_notes": "Trang showed strong self-awareness about her advice-giving tendency. We explored the gap between knowing she should ask questions and actually doing it under pressure. She identified that her trigger is when someone looks stressed — she instinctively wants to \"fix\" the situation. We agreed she would practice noticing the trigger without acting on it for one week. Good energy, very coachable.",
        "coachee_notes": "I realised that my urge to give advice comes from wanting to help quickly, but it actually takes away the other person's chance to find their own solution. The question \"What would you do if you trusted yourself to figure this out?\" really landed for me. I want to use it more.",
        "action_items": [
          {
            "text": "Notice the advice-giving trigger 3 times this week without acting on it",
            "done": true
          },
          {
            "text": "Write down one powerful question after each team meeting",
            "done": true
          },
          {
            "text": "Re-read Erickson Principle 2: People already have all the resources they need",
            "done": false
          }
        ],
        "coachee_rating": 5,
        "coachee_rated_at": "2026-09-10T10:30:00Z",
        "coachee_rating_comment": "Very helpful first session. My coach helped me see a pattern I was blind to. Looking forward to the next one."
      }
      , { onConflict: "id" }); if (error) throw error; }
      { const { error } = await admin.from("session_goal_ratings").upsert(
      {
        "session_id": "e0000000-0000-0000-0000-000000000001",
        "goal_id": "d0000000-0000-0000-0000-000000000001",
        "coachee_id": trangId,
        "rating": 4,
        "note": "Starting to notice the pattern, not yet changing it"
      }
      , { onConflict: "session_id,goal_id" }); if (error) throw error; }
      { const { error } = await admin.from("session_goal_ratings").upsert(
      {
        "session_id": "e0000000-0000-0000-0000-000000000001",
        "goal_id": "d0000000-0000-0000-0000-000000000002",
        "coachee_id": trangId,
        "rating": 3,
        "note": "Just introduced to SHIFT, haven't practiced yet"
      }
      , { onConflict: "session_id,goal_id" }); if (error) throw error; }
      { const { error } = await admin.from("session_goal_ratings").upsert(
      {
        "session_id": "e0000000-0000-0000-0000-000000000001",
        "goal_id": "d0000000-0000-0000-0000-000000000003",
        "coachee_id": trangId,
        "rating": 2,
        "note": "Silence still feels very uncomfortable"
      }
      , { onConflict: "session_id,goal_id" }); if (error) throw error; }
      { const { error } = await admin.from("coach_session_private_notes").upsert(
      {
        "session_id": "e0000000-0000-0000-0000-000000000001",
        "coach_id": coach1Id,
        "body": "Strong participant. Emotional intelligence is high — she just needs permission to slow down. Watch for perfectionism as a blocker later in the programme. Consider introducing the \"scaling question\" technique next session."
      }
      , { onConflict: "session_id" }); if (error) throw error; }
      { const { error } = await admin.from("session_messages").upsert(
      {
        "id": "1decfba7-fa33-4a3b-9c69-b4b84841f1e9",
        "session_id": "e0000000-0000-0000-0000-000000000001",
        "sender_id": trangId,
        "body": "Hi! Looking forward to our first session. I've been reading the Week 1 skill card and Erickson's 5 principles really resonated with me, especially \"People already have all the resources they need.\" I'd like to explore why I still default to giving advice even when I believe this.",
        "created_at": "2026-09-09T14:00:00Z",
        "read_at": null
      }
      , { onConflict: "id" }); if (error) throw error; }
      { const { error } = await admin.from("session_messages").upsert(
      {
        "id": "0069ef2d-df3c-4172-9c6d-415573eaacf6",
        "session_id": "e0000000-0000-0000-0000-000000000001",
        "sender_id": coach1Id,
        "body": "Great topic to start with, Trang. That gap between belief and behaviour is exactly the space coaching works in. Come ready to think about a specific recent example where you noticed yourself advising instead of asking. See you tomorrow!",
        "created_at": "2026-09-09T15:30:00Z",
        "read_at": "2026-09-09T16:00:00Z"
      }
      , { onConflict: "id" }); if (error) throw error; }
      { const { error } = await admin.from("sessions").upsert(
      {
        "id": "e0000000-0000-0000-0000-000000000002",
        "coach_id": coach1Id,
        "coachee_id": trangId,
        "topic": "Practicing the SHIFT model — where I get stuck between H and I",
        "start_time": "2026-09-24T09:00:00+07:00",
        "duration_minutes": 60,
        "status": "completed",
        "confirmed_at": "2026-09-23T08:00:00Z",
        "meeting_url": "https://zoom.us/j/1234567891",
        "coach_notes": "Clear progress since session 1. Trang's awareness of the advice trigger has improved noticeably — she caught herself twice during our conversation and self-corrected. Main challenge today: she can hold the \"H\" (hear current situation) stage well, but jumps to \"T\" (take action) without fully exploring \"I\" (desired outcome). We did a live practice where I coached her through a real scenario and she mapped it to SHIFT afterward. She saw the gap clearly. Homework: practice \"I\" stage with her triad group.",
        "coachee_notes": "I can see that I skip over asking people what they actually want and go straight to \"so what will you do about it?\" My coach showed me how spending more time on the vision (I stage) actually makes the action step clearer and more motivating. The question \"What will be different when this is working?\" is now my favourite tool.",
        "action_items": [
          {
            "text": "In triad practice this week, specifically focus on spending 10 minutes in the I stage",
            "done": false
          },
          {
            "text": "Ask three colleagues: What does success look like for you on this project?",
            "done": true
          },
          {
            "text": "Journal: What am I noticing about my own growth as a coach?",
            "done": false
          }
        ],
        "coachee_rating": 5,
        "coachee_rated_at": "2026-09-24T10:15:00Z",
        "coachee_rating_comment": "I can feel my coaching improving. The SHIFT model practice was exactly what I needed. My coach is patient and precise."
      }
      , { onConflict: "id" }); if (error) throw error; }
      { const { error } = await admin.from("session_goal_ratings").upsert(
      {
        "session_id": "e0000000-0000-0000-0000-000000000002",
        "goal_id": "d0000000-0000-0000-0000-000000000001",
        "coachee_id": trangId,
        "rating": 6,
        "note": "Caught myself twice and chose to ask a question instead"
      }
      , { onConflict: "session_id,goal_id" }); if (error) throw error; }
      { const { error } = await admin.from("session_goal_ratings").upsert(
      {
        "session_id": "e0000000-0000-0000-0000-000000000002",
        "goal_id": "d0000000-0000-0000-0000-000000000002",
        "coachee_id": trangId,
        "rating": 5,
        "note": "Can do S-H-I but still rushing to T"
      }
      , { onConflict: "session_id,goal_id" }); if (error) throw error; }
      { const { error } = await admin.from("session_goal_ratings").upsert(
      {
        "session_id": "e0000000-0000-0000-0000-000000000002",
        "goal_id": "d0000000-0000-0000-0000-000000000003",
        "coachee_id": trangId,
        "rating": 4,
        "note": "Managed 5 seconds of silence in practice — it felt like a minute"
      }
      , { onConflict: "session_id,goal_id" }); if (error) throw error; }
      { const { error } = await admin.from("coach_session_private_notes").upsert(
      {
        "session_id": "e0000000-0000-0000-0000-000000000002",
        "coach_id": coach1Id,
        "body": "She is ready for a real coaching practicum now. Her self-correction speed has improved dramatically. Consider suggesting she volunteer to coach first in the triad session — she will learn more from doing than watching at this stage."
      }
      , { onConflict: "session_id" }); if (error) throw error; }

      // Coach client notes
      { const { error } = await admin.from("coach_client_notes").upsert(
      {
        "id": "69138332-567a-4a94-8be0-4dafc13099be",
        "coach_id": coach1Id,
        "coachee_id": trangId,
        "body": "Trang is highly motivated and self-aware. Main development edges: (1) trusting silence, (2) staying in the \"I\" stage of SHIFT longer before jumping to action. She responds very well to experiential learning — practice > theory for her. Trigger pattern: advice-giving activates when she sees someone in distress. Possible root: strong caretaker identity. Not therapeutic territory — keep coaching-focused on the behaviour, not the identity."
      }
      , { onConflict: "id" }); if (error) throw error; }

      // 12. Peer coaching session (Trang as peer-coachee)
      { const { error } = await admin.from("peer_sessions").upsert(
      {
        "id": "e0000000-0000-0000-0000-000000000010",
        "peer_coach_id": coach2Id,
        "peer_coachee_id": trangId,
        "topic": "Peer practice: Coaching Trang through a real workplace challenge using open questions only",
        "start_time": "2026-09-17T14:00:00+07:00",
        "duration_minutes": 45,
        "status": "completed",
        "confirmed_at": "2026-09-16T10:00:00Z",
        "meeting_url": "https://zoom.us/j/9876543210",
        "coach_notes": "Practiced staying in Level 2 listening throughout. I noticed that when Trang talked about her team lead frustration, I almost gave advice three times but caught myself. The question \"What would your ideal outcome look like?\" opened up the conversation significantly. Need to work on my pacing — I asked follow-up questions too quickly without giving space.",
        "coachee_notes": "My peer coach asked really good open questions. The one that unlocked things for me was \"If you could redesign this relationship from scratch, what would it look like?\" I hadn't thought about it that way before. Feedback: sometimes the questions came very quickly one after another — a bit more silence would have helped me think.",
        "action_items": [
          {
            "text": "Try the redesign question with my own team member",
            "done": true
          },
          {
            "text": "Give peer coach written feedback on their questioning technique",
            "done": true
          }
        ],
        "coachee_rating": 4,
        "coachee_rated_at": "2026-09-17T15:00:00Z",
        "coachee_rating_comment": "Good session — I felt genuinely heard. Would benefit from more pauses between questions."
      }
      , { onConflict: "id" }); if (error) throw error; }
      { const { error } = await admin.from("peer_session_competency_feedback").upsert(
      {
        "id": "107ca8b3-8b95-4a8d-bb32-7e8144812dab",
        "peer_session_id": "e0000000-0000-0000-0000-000000000010",
        "peer_coach_id": coach2Id,
        "peer_coachee_id": trangId,
        "ethical_practice": 8,
        "coaching_mindset": 7,
        "maintains_agreements": 8,
        "trust_safety": 9,
        "maintains_presence": 6,
        "listens_actively": 7,
        "evokes_awareness": 8,
        "facilitates_growth": 7,
        "feedback_note": "Strong on creating trust and safety — I felt comfortable sharing real challenges. The area for growth is maintaining presence: sometimes the next question came before I finished processing the last one. Overall, a very supportive and growth-oriented session."
      }
      , { onConflict: "peer_session_id" }); if (error) throw error; }
      { const { error } = await admin.from("peer_coach_session_private_notes").upsert(
      {
        "peer_session_id": "e0000000-0000-0000-0000-000000000010",
        "peer_coach_id": coach2Id,
        "body": "Trang is an excellent practice partner — brings real topics. My main learning: I need to count to 5 after asking a question before speaking again. She gave me feedback about pacing which matches what my mentor told me last week. Pattern confirmed — this is my #1 development area."
      }
      , { onConflict: "peer_session_id" }); if (error) throw error; }

      // 13. Mentoring session + feedback
      { const { error } = await admin.from("mentoring_sessions").upsert(
      {
        "id": "e0000000-0000-0000-0000-000000000020",
        "mentor_id": coach1Id,
        "mentee_id": trangId,
        "topic": "Mentoring: Developing my coaching presence and working with silence",
        "start_time": "2026-09-19T10:00:00+07:00",
        "duration_minutes": 60,
        "status": "completed",
        "confirmed_at": "2026-09-18T09:00:00Z",
        "meeting_url": "https://zoom.us/j/5555555555",
        "mentor_notes": "Trang is progressing well. Today we focused specifically on her discomfort with silence. I demonstrated a coaching conversation where I deliberately used 8-10 second pauses. She observed that the client (me role-playing) actually produced deeper insights after the longer pauses. She then practiced: her first pause was 3 seconds, her last was 7 seconds. Significant growth in one session. Recommended: practice the \"pregnant pause\" technique in her triad group.",
        "mentee_notes": "My mentor showed me that silence is not awkward — it is generous. When they paused for almost 10 seconds after my answer, I found myself going deeper without being prompted. I want to master this. The key insight: silence is a coaching tool, not a gap to fill.",
        "action_items": [
          {
            "text": "Practice 7-second pauses in triad session this week",
            "done": false
          },
          {
            "text": "Record a practice session and count my average pause length",
            "done": false
          },
          {
            "text": "Read the ICF competency on Maintains Presence",
            "done": true
          }
        ],
        "prep_file_path": "mentoring-prep/trang-session-1-prep.pdf",
        "prep_file_notes": "I want to focus on: (1) why silence feels uncomfortable for me, (2) how to use silence as a tool not just endure it, (3) how my mentor handles silence in their own coaching practice.",
        "prep_file_submitted_at": "2026-09-18T14:00:00Z",
        "feedback_submitted_at": "2026-09-19T11:30:00Z"
      }
      , { onConflict: "id" }); if (error) throw error; }
      { const { error } = await admin.from("mentoring_feedback").upsert(
      {
        "id": "c8b34141-b11c-47ba-854e-3cfa052a2ec0",
        "mentoring_session_id": "e0000000-0000-0000-0000-000000000020",
        "mentor_id": coach1Id,
        "mentee_id": trangId,
        "submitted_at": "2026-09-19T11:30:00Z",
        "ethical_practice": "Strong — Trang is clear about boundaries between coaching, advising, and therapy. No concerns.",
        "coaching_mindset": "Excellent progress. She genuinely believes in client resourcefulness and is actively working to let go of the \"fixer\" identity. This is her biggest growth edge and she is leaning into it.",
        "maintains_agreements": "Good — she sets clear session topics. Area to develop: explicitly re-contracting mid-session when the topic shifts, rather than just following the energy.",
        "trust_safety": "Natural strength. Clients and peers report feeling very safe with her. Warm, non-judgmental presence.",
        "maintains_presence": "This is where the main work is. She is aware of her discomfort with silence and actively working on it. Progress: from 2-3 second pauses to 5-7 seconds in today's session. Recommend continued deliberate practice.",
        "listens_actively": "Good Level 2 listening. Starting to pick up on what is NOT said, which is Level 3 territory. Encourage her to trust these intuitions and name them: \"I notice you didn't mention X — is that significant?\"",
        "evokes_awareness": "Strong questioning instincts. Her questions are becoming shorter and more powerful. Favourite today: \"What would you do if you already knew the answer?\" Beautiful.",
        "facilitates_growth": "Trang consistently moves sessions toward action. Her growth area is spending more time in the visioning/desired-outcome space before jumping to commitment. This maps directly to the SHIFT model I-to-T transition she is working on in her coaching sessions.",
        "overall_notes": "Trang is one of the strongest participants in this cohort. Her self-awareness and willingness to be uncomfortable are exceptional. If she continues at this pace, she will be ready for ACC-level practice within 3 months. Recommend: (1) increase practice hours, (2) seek more diverse practice clients, (3) consider applying for ICF ACC credential by Q1 2027.",
        "submitted_by": coach1Id
      }
      , { onConflict: "mentoring_session_id" }); if (error) throw error; }

      // 14. Triad group, session, reflections (requires 2 other coachees)
      if (peer1Id && peer2Id && peer1Id !== peer2Id) {
        { const { error } = await admin.from("triad_groups").upsert(
        {
          "id": "f0000000-0000-0000-0000-000000000001",
          "programme_id": programmeId,
          "triad_round_id": roundIds[0],
          "member_1_id": trangId,
          "member_2_id": peer1Id,
          "member_3_id": peer2Id,
          "name": "Triad Alpha",
          "is_active": true,
          "assigned_by": "admin",
          "group_language": "vi"
        }
        , { onConflict: "id" }); if (error) throw error; }
        { const { error } = await admin.from("triad_sessions").upsert(
        {
          "id": "e0000000-0000-0000-0000-000000000030",
          "triad_group_id": "f0000000-0000-0000-0000-000000000001",
          "proposed_start_time": "2026-09-20T15:00:00+07:00",
          "proposed_end_time": "2026-09-20T16:30:00+07:00",
          "proposed_by": trangId,
          "status": "completed",
          "meeting_url": "https://zoom.us/j/7777777777",
          "notes": "Round 1 practice session. Trang coached, Peer1 was coachee, Peer2 observed. Topic: Peer1's challenge with delegating to a new team member. 25-minute coaching conversation followed by 15 minutes of observer feedback and group debrief.",
          "member_1_response": "accepted",
          "member_2_response": "accepted",
          "member_3_response": "accepted"
        }
        , { onConflict: "id" }); if (error) throw error; }
        { const { error } = await admin.from("triad_reflections").upsert(
        {
          "id": "f0c9db26-2887-4ceb-addc-39dde0254924",
          "triad_session_id": "e0000000-0000-0000-0000-000000000030",
          "participant_id": trangId,
          "learned_as_coach": "I learned that I can actually hold a 25-minute coaching conversation using SHIFT without running out of things to ask. My biggest learning: when I trusted the silence after asking \"What does successful delegation look like for you?\", my coachee gave a much deeper answer than I expected. I also noticed I skipped the S stage — next time I need to explicitly contract the session at the start.",
          "will_use_as_coach": "I will explicitly set the foundation (S stage) by asking \"What would make this conversation valuable for you?\" at the very start of every practice session from now on. I will also aim for at least 5-second pauses after every question.",
          "learned_as_coachee": null,
          "will_use_as_coachee": null,
          "learned_as_observer": null,
          "will_use_as_observer": null,
          "satisfaction_rating": 5,
          "submitted_at": "2026-09-20T17:00:00Z"
        }
        , { onConflict: "triad_session_id,participant_id" }); if (error) throw error; }
        { const { error } = await admin.from("triad_reflections").upsert(
        {
          "id": "8b3ad01f-8e95-47cb-bed0-3f9ff07f2ca7",
          "triad_session_id": "e0000000-0000-0000-0000-000000000030",
          "participant_id": peer1Id,
          "learned_as_coach": null,
          "will_use_as_coach": null,
          "learned_as_coachee": "Being coached by a peer feels different from being coached by our professional coach — in a good way. Trang asked me \"If you trusted this person to figure it out, what would you do differently?\" and I realised I was micromanaging because I didn't trust my new team member yet. That was a breakthrough. The silence after some questions felt long but productive.",
          "will_use_as_coachee": "I am going to have an honest conversation with my new team member about what \"good enough\" looks like for their first deliverables, instead of reviewing every detail.",
          "learned_as_observer": null,
          "will_use_as_observer": null,
          "satisfaction_rating": 5,
          "submitted_at": "2026-09-20T17:15:00Z"
        }
        , { onConflict: "triad_session_id,participant_id" }); if (error) throw error; }
        { const { error } = await admin.from("triad_reflections").upsert(
        {
          "id": "f2886392-4aa1-49d9-be5f-43d38f81c3fd",
          "triad_session_id": "e0000000-0000-0000-0000-000000000030",
          "participant_id": peer2Id,
          "learned_as_coach": null,
          "will_use_as_coach": null,
          "learned_as_coachee": null,
          "will_use_as_coachee": null,
          "learned_as_observer": "Watching from the outside, I could clearly see the SHIFT stages unfolding. Trang spent about 5 minutes in H (hearing the situation), then moved to I (identifying desired outcome) with the question about what delegation success looks like. I noticed she jumped over F (finding resources) and went straight to T (action). When I pointed this out in the debrief, she agreed and said she would work on that. As observer, I also noticed that the moments of silence produced the richest client responses — something I want to remember for my own coaching practice.",
          "will_use_as_observer": "In my next observation, I want to explicitly track time spent in each SHIFT stage and share that data with the coach as quantitative feedback.",
          "satisfaction_rating": 4,
          "submitted_at": "2026-09-20T17:30:00Z"
        }
        , { onConflict: "triad_session_id,participant_id" }); if (error) throw error; }
      } else {
        console.log("Fewer than 2 other coachees found — skipping triad group/session/reflections seed");
      }

      // 15. Coachee journal reflections
      { const { error } = await admin.from("coachee_reflections").upsert(
      {
        "id": "c04a97f6-e656-4876-ab96-b76f6a95fc99",
        "coachee_id": trangId,
        "body": "Week 1 reflection: I came into this programme thinking coaching was about asking better questions. Now I realise it starts before the questions — with believing that the person in front of me already has what they need. That shift in belief changes everything about how I show up in conversations. I noticed today that when I stopped trying to \"help\" my colleague and just asked what she wanted to happen, she came up with a solution I would never have thought of. Erickson was right: people are creative, resourceful, and whole.",
        "mood": "energized",
        "created_at": "2026-09-12T20:00:00Z"
      }
      , { onConflict: "id" }); if (error) throw error; }
      { const { error } = await admin.from("coachee_reflections").upsert(
      {
        "id": "6d0a6201-48c0-4b82-b105-f221ef824811",
        "coachee_id": trangId,
        "body": "Week 3 reflection: The SHIFT model is becoming more intuitive but I still rush through it. Today in practice I spent 15 of my 25 minutes in the H stage (hearing the situation) and only 3 minutes in I (desired outcome). My observer pointed out that I was \"swimming in the problem\" instead of pivoting to what the client wanted. This is my next edge. The good news: my silence is improving. I held a 7-second pause today and my practice client said she appreciated the thinking space. Small wins.",
        "mood": "reflective",
        "created_at": "2026-09-25T21:00:00Z"
      }
      , { onConflict: "id" }); if (error) throw error; }

      // 16. Training progress
      { const { error } = await admin.from("training_progress").upsert(
      {
        "id": "305ac1c3-f2fd-43ed-9072-68103042da4d",
        "user_id": trangId,
        "training_week_id": weekIds[0],
        "viewed_at": "2026-09-08T08:00:00Z",
        "completed_at": "2026-09-12T18:00:00Z",
        "pdf_downloaded_at": "2026-09-08T08:15:00Z"
      }
      , { onConflict: "user_id,training_week_id" }); if (error) throw error; }
      { const { error } = await admin.from("training_progress").upsert(
      {
        "id": "18f0453e-0006-4d85-b67b-ac282342601f",
        "user_id": trangId,
        "training_week_id": weekIds[1],
        "viewed_at": "2026-09-15T08:00:00Z",
        "completed_at": "2026-09-19T17:00:00Z",
        "pdf_downloaded_at": "2026-09-15T09:00:00Z"
      }
      , { onConflict: "user_id,training_week_id" }); if (error) throw error; }
      { const { error } = await admin.from("training_progress").upsert(
      {
        "id": "f92f29f4-5117-4629-9fd3-603568788814",
        "user_id": trangId,
        "training_week_id": weekIds[2],
        "viewed_at": "2026-09-22T08:00:00Z",
        "completed_at": "2026-09-26T16:00:00Z",
        "pdf_downloaded_at": "2026-09-22T08:30:00Z"
      }
      , { onConflict: "user_id,training_week_id" }); if (error) throw error; }
      { const { error } = await admin.from("training_progress").upsert(
      {
        "id": "ec853b1b-cd81-4314-bd3d-4f78cce4e662",
        "user_id": trangId,
        "training_week_id": weekIds[3],
        "viewed_at": "2026-09-29T08:00:00Z",
        "completed_at": null,
        "pdf_downloaded_at": null
      }
      , { onConflict: "user_id,training_week_id" }); if (error) throw error; }

      // 17. Daily prompt responses (all 20 prompts across 4 weeks)
      { const { error } = await admin.from("daily_prompt_responses").upsert(
      {
        "id": "ae8b42ef-5399-4812-81d4-b436569ba1c9",
        "daily_prompt_id": "c1000000-0000-0000-0000-000000000011",
        "user_id": trangId,
        "opened_at": "2026-09-08T08:30:00Z",
        "response_text": "I had a conversation with my team lead about a project delay. I shifted from listening to advising almost immediately — within 30 seconds. I suggested she restructure the timeline before she even finished explaining the problem. If I had asked \"What do you think would help?\" she might have come up with something better. Lesson: my instinct to advise is fast and automatic.",
        "responded_at": "2026-09-08T12:00:00Z"
      }
      , { onConflict: "daily_prompt_id,user_id" }); if (error) throw error; }
      { const { error } = await admin.from("daily_prompt_responses").upsert(
      {
        "id": "fdc01c9c-8e92-4782-a44f-e576c27a1f9c",
        "daily_prompt_id": "c1000000-0000-0000-0000-000000000012",
        "user_id": trangId,
        "opened_at": "2026-09-09T08:15:00Z",
        "response_text": "Principle 2 — \"People already have all the resources they need\" — feels most natural to me intellectually, but the hardest to live. I believe it in theory, but in practice I still jump in to help. Principle 5 — \"Change is inevitable\" — is the one I find most comforting. It reminds me that even when progress feels slow, the fact that I am in this programme means something is already shifting.",
        "responded_at": "2026-09-09T13:00:00Z"
      }
      , { onConflict: "daily_prompt_id,user_id" }); if (error) throw error; }
      { const { error } = await admin.from("daily_prompt_responses").upsert(
      {
        "id": "2473cf47-2b44-4b71-a6ee-186a09f590bd",
        "daily_prompt_id": "c1000000-0000-0000-0000-000000000013",
        "user_id": trangId,
        "opened_at": "2026-09-10T08:20:00Z",
        "response_text": "I watched my director in a strategy meeting. She asked \"What are we not seeing?\" and then waited. She literally leaned back in her chair and waited for someone to speak. It took about 8 seconds. Then three people jumped in with ideas that were much more creative than the original direction. She creates space by physically slowing down and staying quiet.",
        "responded_at": "2026-09-10T18:00:00Z"
      }
      , { onConflict: "daily_prompt_id,user_id" }); if (error) throw error; }
      { const { error } = await admin.from("daily_prompt_responses").upsert(
      {
        "id": "b70a4548-3598-4d55-ac1a-b5a6ff6b3837",
        "daily_prompt_id": "c1000000-0000-0000-0000-000000000014",
        "user_id": trangId,
        "opened_at": "2026-09-11T08:10:00Z",
        "response_text": "In a 1:1 with a junior colleague, I assumed she was struggling with the analytics tool because she seemed frustrated. I started explaining the shortcut keys. But she was actually frustrated about something completely different — a miscommunication with another department. My assumption was wrong, and my \"help\" was irrelevant. Lesson: ask before assuming.",
        "responded_at": "2026-09-11T19:30:00Z"
      }
      , { onConflict: "daily_prompt_id,user_id" }); if (error) throw error; }
      { const { error } = await admin.from("daily_prompt_responses").upsert(
      {
        "id": "af71b7c0-14d1-497d-b5fe-2d3f8e422445",
        "daily_prompt_id": "c1000000-0000-0000-0000-000000000015",
        "user_id": trangId,
        "opened_at": "2026-09-12T08:05:00Z",
        "response_text": "The hardest part of only asking questions for an hour would be resisting the urge to share my own experience. When someone tells me about a challenge, my brain immediately generates \"I had the same thing happen, and here is what I did…\" Cutting that off would feel unnatural but might let the other person go deeper. I would probably discover that people can solve most of their own problems when given space.",
        "responded_at": "2026-09-12T17:45:00Z"
      }
      , { onConflict: "daily_prompt_id,user_id" }); if (error) throw error; }
      { const { error } = await admin.from("daily_prompt_responses").upsert(
      {
        "id": "ec80c374-00ba-4855-84ea-66241aafc164",
        "daily_prompt_id": "c1000000-0000-0000-0000-000000000021",
        "user_id": trangId,
        "opened_at": "2026-09-15T08:10:00Z",
        "response_text": "A colleague asked me \"What would you do if this project belonged entirely to you?\" It made me stop because I realised I had been treating it as someone else's decision to make, even though I was the one responsible. What made it powerful was that it exposed an assumption I didn't know I was carrying.",
        "responded_at": "2026-09-15T12:30:00Z"
      }
      , { onConflict: "daily_prompt_id,user_id" }); if (error) throw error; }
      { const { error } = await admin.from("daily_prompt_responses").upsert(
      {
        "id": "cbeff856-c044-4fa5-ac2d-5b6736a230c5",
        "daily_prompt_id": "c1000000-0000-0000-0000-000000000022",
        "user_id": trangId,
        "opened_at": "2026-09-16T08:05:00Z",
        "response_text": "I practiced Level 2 listening with my husband over dinner. I noticed his pace slowed down when he talked about work stress, and there was a pause before he mentioned his manager's name — I think that pause meant something. I usually would have missed both of those signals because I am normally halfway to a response while he is still talking.",
        "responded_at": "2026-09-16T20:00:00Z"
      }
      , { onConflict: "daily_prompt_id,user_id" }); if (error) throw error; }
      { const { error } = await admin.from("daily_prompt_responses").upsert(
      {
        "id": "12a244e7-985c-4655-9844-62a9a3fcc253",
        "daily_prompt_id": "c1000000-0000-0000-0000-000000000023",
        "user_id": trangId,
        "opened_at": "2026-09-17T08:00:00Z",
        "response_text": "1) What would it look like if this already felt manageable? 2) What have you already tried that gave you even a small result? 3) What do you actually want to happen here? I had to rewrite the third one twice — my first draft was \"Have you thought about talking to your manager?\", which is advice, not a question.",
        "responded_at": "2026-09-17T21:00:00Z"
      }
      , { onConflict: "daily_prompt_id,user_id" }); if (error) throw error; }
      { const { error } = await admin.from("daily_prompt_responses").upsert(
      {
        "id": "3bc89be4-1c58-41c4-89c6-2c9b65224eef",
        "daily_prompt_id": "c1000000-0000-0000-0000-000000000024",
        "user_id": trangId,
        "opened_at": "2026-09-18T08:00:00Z",
        "response_text": "My first instinct was to solve — I immediately started thinking of three possible fixes before my colleague had finished her sentence. That tells me my default mode is still \"fixer,\" not \"asker.\" I caught it this time and asked a question instead, but it took real effort. This is clearly the pattern I need to keep working on.",
        "responded_at": "2026-09-18T14:00:00Z"
      }
      , { onConflict: "daily_prompt_id,user_id" }); if (error) throw error; }
      { const { error } = await admin.from("daily_prompt_responses").upsert(
      {
        "id": "ddd7fc78-8c69-4306-a468-a3f52bc9cdaf",
        "daily_prompt_id": "c1000000-0000-0000-0000-000000000025",
        "user_id": trangId,
        "opened_at": "2026-09-19T08:00:00Z",
        "response_text": "I would rate myself about a 6 out of 10 this week. I truly listened at Level 2 in maybe half of my conversations. What got in the way was being rushed — when I am checking the clock, I default back to Level 1 and start planning my response too early. Slowing my own pace seems to be the real lever, not just \"trying harder\" to listen.",
        "responded_at": "2026-09-19T19:00:00Z"
      }
      , { onConflict: "daily_prompt_id,user_id" }); if (error) throw error; }
      { const { error } = await admin.from("daily_prompt_responses").upsert(
      {
        "id": "5fa45906-007f-40e6-ab48-4622627ed427",
        "daily_prompt_id": "c1000000-0000-0000-0000-000000000031",
        "user_id": trangId,
        "opened_at": "2026-09-22T08:00:00Z",
        "response_text": "In a 1:1 with my team member, I noticed she was still deep in \"H\" — describing everything that was going wrong with the client relationship — for almost the whole conversation. I resisted jumping to solutions and instead asked \"What would a good outcome look like from here?\" which finally moved her toward \"I\". Naming the stage in my head helped me stay patient.",
        "responded_at": "2026-09-22T13:00:00Z"
      }
      , { onConflict: "daily_prompt_id,user_id" }); if (error) throw error; }
      { const { error } = await admin.from("daily_prompt_responses").upsert(
      {
        "id": "aef04d3b-0662-437c-9d84-83c54c33b3b5",
        "daily_prompt_id": "c1000000-0000-0000-0000-000000000032",
        "user_id": trangId,
        "opened_at": "2026-09-23T08:00:00Z",
        "response_text": "My goal is to run a full coaching conversation confidently using SHIFT. When I achieve it, I will see myself staying calm and unhurried even during silence, I will hear the client thinking out loud instead of me filling gaps, and I will feel a steady groundedness instead of the urge to \"perform.\" That picture makes the goal feel much more real than just \"get better at coaching.\"",
        "responded_at": "2026-09-23T18:00:00Z"
      }
      , { onConflict: "daily_prompt_id,user_id" }); if (error) throw error; }
      { const { error } = await admin.from("daily_prompt_responses").upsert(
      {
        "id": "60943f7f-95f6-46af-bc8d-0eec55e324b3",
        "daily_prompt_id": "c1000000-0000-0000-0000-000000000033",
        "user_id": trangId,
        "opened_at": "2026-09-24T08:00:00Z",
        "response_text": "I skipped \"F\" entirely today — I moved straight from the client's desired outcome to \"so what will you do?\" without ever asking what resources or past successes she could draw on. Next time I could ask \"What has helped you handle something like this before?\" before moving to action. Noticing this in the moment is still hard, but I caught it afterward, which is progress.",
        "responded_at": "2026-09-24T19:30:00Z"
      }
      , { onConflict: "daily_prompt_id,user_id" }); if (error) throw error; }
      { const { error } = await admin.from("daily_prompt_responses").upsert(
      {
        "id": "b64de72e-0a43-46c3-a09f-574b0502ec1f",
        "daily_prompt_id": "c1000000-0000-0000-0000-000000000034",
        "user_id": trangId,
        "opened_at": "2026-09-25T08:00:00Z",
        "response_text": "A strength I have that I forget under pressure is that I am genuinely good at building trust quickly — people open up to me fast. When I am stressed I discount this and think I need to \"prove\" my coaching skill through clever questions, when actually my presence alone is already doing a lot of the work.",
        "responded_at": "2026-09-25T15:00:00Z"
      }
      , { onConflict: "daily_prompt_id,user_id" }); if (error) throw error; }
      { const { error } = await admin.from("daily_prompt_responses").upsert(
      {
        "id": "9dfe678b-1315-42d9-81d0-49c07ef3b505",
        "daily_prompt_id": "c1000000-0000-0000-0000-000000000035",
        "user_id": trangId,
        "opened_at": "2026-09-26T08:00:00Z",
        "response_text": "I would say a 6 out of 10 now, up from a 2 in week 1. What would help me go further is deliberately counting to five in my head after I ask a question, instead of trusting myself to \"just know\" when to stay quiet. Structure seems to help me more than willpower alone.",
        "responded_at": "2026-09-26T16:30:00Z"
      }
      , { onConflict: "daily_prompt_id,user_id" }); if (error) throw error; }
      { const { error } = await admin.from("daily_prompt_responses").upsert(
      {
        "id": "d858d161-ad2a-4148-8b00-9441108a491d",
        "daily_prompt_id": "c1000000-0000-0000-0000-000000000041",
        "user_id": trangId,
        "opened_at": "2026-09-29T08:00:00Z",
        "response_text": "My manager once held me accountable by asking \"What did you decide, and how did it go?\" instead of \"Did you do what I told you?\" It felt supportive because the choice was still mine — she was curious about my decision, not checking whether I obeyed her instruction. That distinction is exactly what I want to bring into my own coaching practice.",
        "responded_at": "2026-09-29T13:00:00Z"
      }
      , { onConflict: "daily_prompt_id,user_id" }); if (error) throw error; }
      { const { error } = await admin.from("daily_prompt_responses").upsert(
      {
        "id": "07a303f8-faf4-42e1-9fd9-03664b0f5436",
        "daily_prompt_id": "c1000000-0000-0000-0000-000000000042",
        "user_id": trangId,
        "opened_at": "2026-09-30T08:00:00Z",
        "response_text": "Trust and Safety feels strongest for me right now — people consistently tell me they feel comfortable being honest with me. Maintains Presence needs the most development; I still sometimes plan my next question while the other person is still talking, which pulls me out of full presence. I want to practice staying with \"nothing to say yet\" instead of rushing to fill it.",
        "responded_at": "2026-09-30T17:00:00Z"
      }
      , { onConflict: "daily_prompt_id,user_id" }); if (error) throw error; }
      { const { error } = await admin.from("daily_prompt_responses").upsert(
      {
        "id": "34bae059-0e93-4087-a6dc-b894b1b04205",
        "daily_prompt_id": "c1000000-0000-0000-0000-000000000043",
        "user_id": trangId,
        "opened_at": "2026-10-01T08:00:00Z",
        "response_text": "Warm, patient, and curious. This style serves my clients because it gives them permission to think slowly instead of performing a quick answer for my benefit. People seem to relax noticeably once they realise I am not going to rush them or judge whatever they say.",
        "responded_at": "2026-10-01T20:00:00Z"
      }
      , { onConflict: "daily_prompt_id,user_id" }); if (error) throw error; }
      { const { error } = await admin.from("daily_prompt_responses").upsert(
      {
        "id": "911b0eba-8ef3-4a75-8ba3-7132bc08f610",
        "daily_prompt_id": "c1000000-0000-0000-0000-000000000044",
        "user_id": trangId,
        "opened_at": "2026-10-02T08:00:00Z",
        "response_text": null,
        "responded_at": null
      }
      , { onConflict: "daily_prompt_id,user_id" }); if (error) throw error; }
      { const { error } = await admin.from("daily_prompt_responses").upsert(
      {
        "id": "4d2e58ed-27f5-40b3-b77b-9bb09b2ffba3",
        "daily_prompt_id": "c1000000-0000-0000-0000-000000000045",
        "user_id": trangId,
        "opened_at": "2026-10-03T08:00:00Z",
        "response_text": null,
        "responded_at": null
      }
      , { onConflict: "daily_prompt_id,user_id" }); if (error) throw error; }

      // 18. Quiz submissions (weeks 1-3; week 4 not yet taken). If Trang
      // already has a submission for a given quiz (can't be changed once
      // made), this leaves her existing one in place.
      { const { error } = await admin.from("assignment_submissions").upsert(
      {
        "id": "9024911f-9d40-4bef-bec0-ba5e37127ca8",
        "assignment_id": quizIds[0],
        "user_id": trangId,
        "answers": {
          "c3100000-0000-0000-0000-000000000001": "a",
          "c3100000-0000-0000-0000-000000000002": "c",
          "c3100000-0000-0000-0000-000000000003": "b",
          "c3100000-0000-0000-0000-000000000004": "b"
        },
        "reflection_text": "I got question 1 wrong — I said the coach should explain why the choice might not work. Now I understand that the coach should trust the client's choice and help expand options instead.",
        "submitted_at": "2026-09-12T15:00:00Z"
      }
      , { onConflict: "assignment_id,user_id", ignoreDuplicates: true }); if (error) throw error; }
      { const { error } = await admin.from("assignment_submissions").upsert(
      {
        "id": "54e4e53a-12ba-4e0c-924a-02329aa685d5",
        "assignment_id": quizIds[1],
        "user_id": trangId,
        "answers": {
          "c3200000-0000-0000-0000-000000000001": "b",
          "c3200000-0000-0000-0000-000000000002": "c",
          "c3200000-0000-0000-0000-000000000003": "b",
          "c3200000-0000-0000-0000-000000000004": "c"
        },
        "reflection_text": "I feel much more confident about the questioning framework now. The distinction between a leading question and an open question is clear to me.",
        "submitted_at": "2026-09-19T14:00:00Z"
      }
      , { onConflict: "assignment_id,user_id", ignoreDuplicates: true }); if (error) throw error; }
      { const { error } = await admin.from("assignment_submissions").upsert(
      {
        "id": "9c0ec499-33ce-42e2-8137-c83c7c156d9c",
        "assignment_id": quizIds[2],
        "user_id": trangId,
        "answers": {
          "c3300000-0000-0000-0000-000000000001": "b",
          "c3300000-0000-0000-0000-000000000002": "b",
          "c3300000-0000-0000-0000-000000000003": "b",
          "c3300000-0000-0000-0000-000000000004": "a"
        },
        "reflection_text": "I got the question about the F stage wrong. I thought it was about finding NEW resources, but it is actually about surfacing resources the client ALREADY has. That is a crucial distinction.",
        "submitted_at": "2026-09-26T13:00:00Z"
      }
      , { onConflict: "assignment_id,user_id", ignoreDuplicates: true }); if (error) throw error; }

      // 19. Reflection submission (mid-programme reflection)
      { const { error } = await admin.from("reflection_submissions").upsert(
      {
        "id": "6ecdc548-e756-4236-bd55-00710f987533",
        "reflection_id": reflectionIds[0],
        "user_id": trangId,
        "confidence_score": 6,
        "submitted_at": "2026-09-19T18:00:00Z"
      }
      , { onConflict: "reflection_id,user_id" }); if (error) throw error; }
      { const { error } = await admin.from("reflection_answers").upsert(
      {
        "id": "dc8193c3-4030-4d6d-a52a-be1ecf8cc57e",
        "submission_id": "6ecdc548-e756-4236-bd55-00710f987533",
        "question_id": "c5100000-0000-0000-0000-000000000001",
        "answer_text": "My biggest insight is that coaching is not about having the right answer — it is about asking the right question and then getting out of the way. This sounds simple but it goes against everything I have been trained to do as a manager.",
        "answer_value": null
      }
      , { onConflict: "submission_id,question_id" }); if (error) throw error; }
      { const { error } = await admin.from("reflection_answers").upsert(
      {
        "id": "f462e4f4-3fec-41f4-a96c-0cfefd87a275",
        "submission_id": "6ecdc548-e756-4236-bd55-00710f987533",
        "question_id": "c5100000-0000-0000-0000-000000000002",
        "answer_text": null,
        "answer_value": 6
      }
      , { onConflict: "submission_id,question_id" }); if (error) throw error; }
      { const { error } = await admin.from("reflection_answers").upsert(
      {
        "id": "be1d7aa1-f44b-4a85-bbf1-b3b61321edcc",
        "submission_id": "6ecdc548-e756-4236-bd55-00710f987533",
        "question_id": "c5100000-0000-0000-0000-000000000003",
        "answer_text": "On Wednesday, a team member came to me with a budget problem. Instead of suggesting she cut the training line item (my first instinct), I asked: What would you do if you had full authority to solve this? She paused, then laid out a plan that was better than anything I would have suggested. I felt proud of both of us.",
        "answer_value": null
      }
      , { onConflict: "submission_id,question_id" }); if (error) throw error; }
      { const { error } = await admin.from("reflection_answers").upsert(
      {
        "id": "12eacfa9-a6e4-4c2f-8439-16af61bcb88b",
        "submission_id": "6ecdc548-e756-4236-bd55-00710f987533",
        "question_id": "c5100000-0000-0000-0000-000000000004",
        "answer_text": null,
        "answer_value": 5
      }
      , { onConflict: "submission_id,question_id" }); if (error) throw error; }
      { const { error } = await admin.from("reflection_answers").upsert(
      {
        "id": "a677d27d-15bf-4938-945f-cb16b87c2154",
        "submission_id": "6ecdc548-e756-4236-bd55-00710f987533",
        "question_id": "c5100000-0000-0000-0000-000000000005",
        "answer_text": "I want to focus on the SHIFT model — specifically staying in the I (desired outcome) stage longer instead of rushing to action. I also want to get more comfortable with silence.",
        "answer_value": null
      }
      , { onConflict: "submission_id,question_id" }); if (error) throw error; }

      // 20. Notifications
      { const { error } = await admin.from("notifications").upsert(
      {
        "id": "ab14c074-e869-4a80-9142-fd75ae4dd4b1",
        "user_id": trangId,
        "notification_type": "session_confirmed",
        "title": "Session confirmed",
        "title_vi": "Session đã xác nhận",
        "body": "Your coaching session on Sep 10 at 9:00 AM has been confirmed.",
        "body_vi": "Session coaching ngày 10/9 lúc 9:00 sáng đã được xác nhận.",
        "is_read": true,
        "read_at": "2026-09-09T10:05:00Z",
        "link": "/sessions/e0000000-0000-0000-0000-000000000001",
        "created_at": "2026-09-09T10:00:00Z"
      }
      , { onConflict: "id" }); if (error) throw error; }
      { const { error } = await admin.from("notifications").upsert(
      {
        "id": "f61d112c-b7d5-4d02-8694-ea64490778d7",
        "user_id": trangId,
        "notification_type": "new_training_week",
        "title": "Week 3 is now available",
        "title_vi": "Tuần 3 đã mở",
        "body": "The SHIFT Model in Practice — your new training content is ready.",
        "body_vi": "Mô hình SHIFT trong Thực hành — nội dung đào tạo mới đã sẵn sàng.",
        "is_read": true,
        "read_at": "2026-09-22T08:02:00Z",
        "link": "/training",
        "created_at": "2026-09-22T08:00:00Z"
      }
      , { onConflict: "id" }); if (error) throw error; }
      { const { error } = await admin.from("notifications").upsert(
      {
        "id": "1265a5f7-18d0-40d2-841f-843841835125",
        "user_id": trangId,
        "notification_type": "triad_session_booked",
        "title": "Triad session scheduled",
        "title_vi": "Session triad đã được lên lịch",
        "body": "Triad Alpha practice session on Sep 20 at 3:00 PM.",
        "body_vi": "Session thực hành Triad Alpha ngày 20/9 lúc 3:00 chiều.",
        "is_read": true,
        "read_at": "2026-09-19T08:00:00Z",
        "link": "/triads",
        "created_at": "2026-09-19T07:00:00Z"
      }
      , { onConflict: "id" }); if (error) throw error; }
      { const { error } = await admin.from("notifications").upsert(
      {
        "id": "8b4d2e4c-387c-431d-9077-e48696c6e524",
        "user_id": trangId,
        "notification_type": "daily_prompt",
        "title": "Your daily coaching prompt",
        "title_vi": "Câu hỏi coaching hàng ngày",
        "body": "A new reflection prompt is waiting for you.",
        "body_vi": "Một câu hỏi phản tư mới đang chờ bạn.",
        "is_read": false,
        "read_at": null,
        "link": "/dashboard",
        "created_at": "2026-09-29T07:00:00Z"
      }
      , { onConflict: "id" }); if (error) throw error; }

      trangSeed = { skipped: false };
      }
    }

    return new Response(
      JSON.stringify({ ok: true, programme_id: programmeId, training_week_ids: weekIds, trang_seed: trangSeed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

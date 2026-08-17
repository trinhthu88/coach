# Clariva — Vietnamese localization style guide (v1, pilot)

This is the working reference for reviewing every `vi/*.json` batch Claude Code produces during Phase 5 of the i18n build. Bring future batches back with this guide attached so the register stays consistent across ~25K lines rather than drifting page to page.

## Locked decision

**Bilingual mix**, not full translation: *coach*, *coaching*, and *session* stay as English loanwords in-product. Everything else is translated into natural Vietnamese. This matches how Vietnamese banking/finance L&D audiences (your target — Seabank, Techcombank-style clients) actually read premium coaching products; a fully-Vietnamese UI can read as less premium to this specific audience, not more accessible.

## Glossary (locked + recommended)

| English | Vietnamese | Status |
|---|---|---|
| coach / coaching | *coach* / *coaching* | **Locked** — stays English |
| session | *session* | **Locked** — stays English |
| programme | chương trình | Locked |
| goal(s) | mục tiêu | Locked |
| rate / rating | đánh giá / mức đánh giá | Locked |
| chemistry call | buổi trò chuyện làm quen | Locked — spell out once with "(chemistry call)" on first use per page, then Vietnamese-only after |
| dashboard | trang tổng quan | Recommended — common in VN banking apps; flag if you'd rather keep "dashboard" as a loanword too |
| booking / to book | đặt lịch | Recommended |
| availability | lịch trống | Recommended |
| accreditation | chứng nhận chuyên môn | Recommended |
| notes (session notes) | ghi chú buổi *session* | Recommended — keeps "session" as the loanword, translates the rest |
| action item | việc cần làm | Recommended |
| peer coaching | *peer coaching* | Recommended to keep English — this is a specific product feature name, translating it risks losing the concept; revisit if it tests poorly |

Add to this table as new terms come up in later batches rather than making one-off calls per file — consistency across the whole app matters more than any single "better" phrasing.

## Register notes (from Vietnamese corporate coaching norms)

- Second person throughout: **bạn** (you), warm but professional — not overly formal **quý khách**, not overly casual.
- Concrete before abstract: keep the original's habit of a concrete example before the general principle (already true of the English copy, preserve the order in translation).
- Avoid blunt corrective framing — "your goal rating hasn't moved" type language should stay observational, not judgmental, consistent with face-saving norms.
- Collectivist framing isn't really applicable to this specific onboarding copy (it's individual-goal-focused by design), so don't force team-language in — follow the source's intent.

---

## Pilot translation — coachee onboarding steps

English (source, unchanged) alongside the Vietnamese localization, for your review before this pattern gets applied to the other ~26 pages.

### Step 1 — Welcome
**EN:** A programme shaped around your goals.
Your plan sets how many sessions you have and over what period. Nothing is scheduled for you and no curriculum is assigned — each session covers whatever you bring to it.

**VI:** Một chương trình được xây dựng quanh mục tiêu của bạn.
Kế hoạch của bạn xác định số lượng *session* và khoảng thời gian thực hiện. Không có gì được lên lịch sẵn thay bạn, cũng không có giáo trình cố định — mỗi *session* sẽ xoay quanh đúng điều bạn mang đến.

### Step 2 — Name what you want to change
**EN:** Write one to three goals in your own words and rate each 1-10 today. The rating is a starting line, not a judgement, and only you can change it.
- Specific: "Hold a hard conversation without softening it" beats "communicate better."
- Yours: Rewrite, split, or drop a goal at any point in the programme.
- Rated: Re-rate whenever something shifts — that movement is your progress.

**VI:** Viết ra một đến ba mục tiêu bằng chính lời của bạn, và đánh giá mỗi mục tiêu theo thang điểm 1-10 ngay hôm nay. Mức đánh giá này là điểm khởi đầu, không phải một lời phán xét — và chỉ bạn mới có quyền thay đổi nó.
- Cụ thể: "Có thể nói thẳng một điều khó nói mà không giảm nhẹ" tốt hơn nhiều so với "giao tiếp tốt hơn."
- Của riêng bạn: Bạn có thể viết lại, tách nhỏ, hoặc bỏ một mục tiêu bất cứ lúc nào trong chương trình.
- Có đánh giá: Đánh giá lại bất cứ khi nào có sự thay đổi — chính sự thay đổi đó là tiến bộ của bạn.

### Step 3 — Choose your coach
**EN:** Your goals filter the accredited network down to the coaches who work on exactly that. Read profiles, book a free 20-minute chemistry call, and decide after you've met.
- Filter: By focus area, language, and availability this month.
- Meet first: Chemistry calls don't count against your session allowance.
- Switch once: You can change coach mid-programme without giving a reason.

**VI:** Mục tiêu của bạn sẽ lọc ra trong mạng lưới *coach* đã được chứng nhận những người phù hợp nhất với đúng vấn đề bạn đang cần. Đọc hồ sơ, đặt một buổi trò chuyện làm quen (chemistry call) miễn phí 20 phút, và quyết định sau khi đã gặp trực tiếp.
- Lọc theo tiêu chí: Theo lĩnh vực chuyên môn, ngôn ngữ, và lịch trống trong tháng.
- Gặp trước khi quyết định: Buổi trò chuyện làm quen không tính vào số *session* của bạn.
- Có thể đổi một lần: Bạn có thể đổi *coach* giữa chương trình mà không cần nêu lý do.

### Step 4 — Book session one
**EN:** You see your coach's live availability and pick a slot. Reminders, the video link, and rescheduling all live in the session — no email chains.

**VI:** Bạn xem lịch trống thực tế của *coach* và chọn một khung giờ phù hợp. Nhắc lịch, đường link video, và việc đổi lịch — tất cả đều nằm ngay trong *session*, không cần trao đổi qua email.

### Step 5 — The session is a closed room
**EN:** Notes, recordings, your goal wording, and everything you say belong to you and your coach. Nothing leaves that room unless you send it yourself.
- You control: What you write, what you share, and who you invite in.
- Never exposed: Session notes, recordings, and the wording of your goals.
- Your coach: Keeps private prep notes too; only summaries marked shared reach you.

**VI:** Ghi chú, bản ghi âm, cách bạn diễn đạt mục tiêu, và mọi điều bạn chia sẻ đều thuộc về bạn và *coach* của bạn. Không có gì rời khỏi không gian đó trừ khi chính bạn gửi đi.
- Bạn là người quyết định: Bạn viết gì, chia sẻ gì, và mời ai tham gia.
- Không bao giờ bị lộ: Ghi chú buổi *session*, bản ghi âm, và cách bạn diễn đạt mục tiêu.
- *Coach* của bạn: Cũng giữ ghi chú chuẩn bị riêng; chỉ những phần tóm tắt được đánh dấu chia sẻ mới đến tay bạn.

### Step 6 — Progress is your own rating, moving
**EN:** Your dashboard tracks each goal's rating across every session you have. No score is calculated for you, and there is no ranking — the line moves when you say it moved.

**VI:** Trang tổng quan của bạn theo dõi mức đánh giá của từng mục tiêu qua mỗi *session*. Không có điểm số nào được tính sẵn thay bạn, và cũng không có bảng xếp hạng — đường biểu đồ chỉ thay đổi khi chính bạn nói rằng nó đã thay đổi.

### Pointers (in-app tour)

**EN — Left navigation:** Find coaches is your starting point. Profiles, chemistry calls, and live calendars all sit here. It stays open for the whole programme, including if you switch coach.

**VI:** "Find coaches" là điểm bắt đầu của bạn. Hồ sơ *coach*, buổi trò chuyện làm quen, và lịch trống thực tế — tất cả đều nằm ở đây. Mục này luôn mở trong suốt chương trình, kể cả khi bạn đổi *coach*.

**EN — Top of your dashboard:** Your next session, always first. Topic, coach, and time. Open it to add what you want to cover — your coach sees that, nobody else does.

**VI:** *Session* tiếp theo của bạn luôn hiển thị đầu tiên. Chủ đề, *coach*, và thời gian. Mở ra để thêm những điều bạn muốn trao đổi — chỉ *coach* của bạn nhìn thấy, không ai khác.

**EN — Session log and action items:** What you agreed to, in one place. Every session leaves its log entry and its action items here. Tick them off as you go — this is also where you re-rate a goal after something shifts.

**VI:** Những điều bạn đã thống nhất, tất cả ở một nơi. Mỗi *session* đều để lại nhật ký và danh sách việc cần làm tại đây. Đánh dấu hoàn thành khi bạn thực hiện xong — đây cũng là nơi bạn đánh giá lại mục tiêu khi có điều gì đó thay đổi.

---

## Next steps

- Confirm this register feels right before it's applied elsewhere — small wording calls here (e.g. "trang tổng quan" for dashboard) set precedent for the whole app.
- Once approved, I can do the same pass for the **coach** onboarding steps, then this becomes the standing reference for reviewing each Phase 5 batch as Claude Code produces it — paste or upload the `vi/*.json` file content here and I'll revise it against this glossary rather than starting from scratch each time.

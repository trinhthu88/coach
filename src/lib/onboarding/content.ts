// Onboarding tour content — coachee and coach are wired to the live app
// (see src/components/onboarding/OnboardingTour.tsx and AppLayout.tsx's "How it
// works" nav entry). `sponsor` content is transcribed and ready, but there is no
// sponsor route/nav in the current app, so it is intentionally never passed to
// <OnboardingTour>. When the sponsor portal is built, wiring it up should be a
// one-line addition (mount <OnboardingTour role="sponsor" .../> in that layout,
// add a "How it works" nav entry for the sponsor role) — not new component work.

export type BulletKind = "in" | "ok" | "no"; // "in" = informational/neutral, "ok" = allowed/visible, "no" = withheld/not allowed
export type OnboardingBullet = { kind: BulletKind; label: string; text: string };
export type OnboardingStep = { kicker: string; title: string; body: string; bullets?: OnboardingBullet[] };
export type OnboardingPointer = { where: string; title: string; body: string; targetSelector: string | null };

export type OnboardingContent = { steps: OnboardingStep[]; pointers: OnboardingPointer[] };

export type OnboardingRole = "coachee" | "coach" | "sponsor";

const coachee: OnboardingContent = {
  steps: [
    {
      kicker: "Welcome to Clariva",
      title: "A programme shaped around your goals.",
      body: "Your plan sets how many sessions you have and over what period. Nothing is scheduled for you and no curriculum is assigned — each session covers whatever you bring to it.",
    },
    {
      kicker: "Step one",
      title: "Name what you want to change.",
      body: "Write one to three goals in your own words and rate each 1-10 today. The rating is a starting line, not a judgement, and only you can change it.",
      bullets: [
        { kind: "in", label: "Specific", text: "'Hold a hard conversation without softening it' beats 'communicate better'." },
        { kind: "in", label: "Yours", text: "Rewrite, split, or drop a goal at any point in the programme." },
        { kind: "in", label: "Rated", text: "Re-rate whenever something shifts — that movement is your progress." },
      ],
    },
    {
      kicker: "Step two",
      title: "Choose your coach.",
      body: "Your goals filter the accredited network down to the coaches who work on exactly that. Read profiles, book a free 20-minute chemistry call, and decide after you've met.",
      bullets: [
        { kind: "in", label: "Filter", text: "By focus area, language, and availability this month." },
        { kind: "in", label: "Meet first", text: "Chemistry calls don't count against your session allowance." },
        { kind: "in", label: "Switch once", text: "You can change coach mid-programme without giving a reason." },
      ],
    },
    {
      kicker: "Step three",
      title: "Book session one.",
      body: "You see your coach's live availability and pick a slot. Reminders, the video link, and rescheduling all live in the session — no email chains.",
    },
    {
      kicker: "Step four",
      title: "The session is a closed room.",
      body: "Notes, recordings, your goal wording, and everything you say belong to you and your coach. Nothing leaves that room unless you send it yourself.",
      bullets: [
        { kind: "ok", label: "You control", text: "What you write, what you share, and who you invite in." },
        { kind: "no", label: "Never exposed", text: "Session notes, recordings, and the wording of your goals." },
        { kind: "in", label: "Your coach", text: "Keeps private prep notes too; only summaries marked shared reach you." },
      ],
    },
    {
      kicker: "Step five",
      title: "Progress is your own rating, moving.",
      body: "Your dashboard tracks each goal's rating across every session you have. No score is calculated for you, and there is no ranking — the line moves when you say it moved.",
    },
  ],
  pointers: [
    {
      where: "Left navigation",
      title: "Find coaches is your starting point.",
      body: "Profiles, chemistry calls, and live calendars all sit here. It stays open for the whole programme, including if you switch coach.",
      targetSelector: '[data-onboarding="nav-find-coaches"]',
    },
    {
      where: "Top of your dashboard",
      title: "Your next session, always first.",
      body: "Topic, coach, and time. Open it to add what you want to cover — your coach sees that, nobody else does.",
      targetSelector: '[data-onboarding="dashboard-next-session"]',
    },
    {
      where: "Session log and action items",
      title: "What you agreed to, in one place.",
      body: "Every session leaves its log entry and its action items here. Tick them off as you go — this is also where you re-rate a goal after something shifts.",
      targetSelector: '[data-onboarding="dashboard-session-log"]',
    },
  ],
};

const coach: OnboardingContent = {
  steps: [
    {
      kicker: "Welcome to Clariva",
      title: "Your practice, on one surface.",
      body: "Matching, booking, reminders, notes, and session history sit in one place — for the clients you coach and for your own practice as a coachee and peer. You keep your method; the platform removes the admin around it.",
    },
    {
      kicker: "Step one",
      title: "Complete your coach profile.",
      body: "Your specialties, experience, and languages are what the matching runs on. A thin profile simply doesn't surface when a coachee filters by their goal.",
      bullets: [
        { kind: "in", label: "Specialties", text: "Pick the two or three you genuinely work in, not everything you could." },
        { kind: "in", label: "Bio", text: "One paragraph in your own voice — it appears on every match card." },
        { kind: "in", label: "Accreditation", text: "Credentials are verified once, then shown as a badge on your profile." },
      ],
    },
    {
      kicker: "Step two",
      title: "Publish your availability.",
      body: "Nobody can book you until windows are open. Set recurring weekly blocks in your own timezone; the platform converts them for each coachee and holds buffers between sessions.",
      bullets: [
        { kind: "in", label: "Recurring", text: "Set once, repeats weekly. Close any individual week when you need to." },
        { kind: "in", label: "Buffers", text: "Add gaps so back-to-back sessions can't be booked." },
        { kind: "in", label: "Chemistry calls", text: "Reserve a short weekly window for 20-minute intro calls." },
      ],
    },
    {
      kicker: "Step three",
      title: "Coach, and be coached.",
      body: "Clariva is also where your own practice grows. Opt in to peer coaching to exchange sessions with other accredited coaches, book a coach for yourself, and keep your practice hours in one record.",
      bullets: [
        { kind: "in", label: "Peer exchange", text: "Give a session, receive a session. Both count as peer sessions on your dashboard." },
        { kind: "in", label: "Your own coach", text: "Find a coach works exactly as it does for a coachee — you are the coachee there." },
        { kind: "in", label: "Practice journey", text: "Sessions delivered, peer sessions, and reflections build the record behind your accreditation." },
      ],
    },
    {
      kicker: "Step four",
      title: "Your notes stay in the room.",
      body: "Organisations fund programmes but have no route into sessions. That boundary is enforced by the product, not by policy.",
      bullets: [
        { kind: "ok", label: "Organisations see", text: "That a session happened, its length, and attendance." },
        { kind: "no", label: "They never see", text: "Notes, recordings, or your name against a named individual." },
        { kind: "in", label: "Your coachee sees", text: "Only the summaries you mark as shared. Prep notes stay private." },
      ],
    },
    {
      kicker: "Step five",
      title: "The platform flags who is stalling.",
      body: "Flat goal ratings and long booking gaps surface on your dashboard before a programme runs out of sessions. Nudges go out from you, never from anyone's employer.",
    },
  ],
  pointers: [
    {
      where: "Left navigation",
      title: "My availability comes first.",
      body: "Until there are open windows here, matched coachees see you as fully booked. It is the one screen to visit before anything else.",
      targetSelector: '[data-onboarding="nav-my-availability"]',
    },
    {
      where: "Top of your dashboard",
      title: "Next session, with context.",
      body: "Topic, client, and time — coaching and peer sessions both surface here. Open it to review your last notes before you join.",
      targetSelector: '[data-onboarding="dashboard-next-session"]',
    },
    {
      where: "Booking requests",
      title: "Approve or decline in one tap.",
      body: "Requests land here with topic, length, and time. Approving confirms the slot and sends the meeting link; declining frees the window immediately.",
      targetSelector: '[data-onboarding="dashboard-booking-requests"]',
    },
  ],
};

// Sponsor: content only — no sponsor role in app_role, no sponsor dashboard/nav yet.
// All three targetSelectors are null since there is nothing in the DOM to point at.
const sponsor: OnboardingContent = {
  steps: [
    {
      kicker: "Welcome to Clariva",
      title: "Programme health, without the content.",
      body: "You can see whether your cohort is engaged and whether people are moving. You cannot see coaching. That trade is what makes the sessions candid enough to work.",
    },
    {
      kicker: "Step one",
      title: "Know where the cohort sits in time.",
      body: "Every figure is read against the programme window. Six sessions across four months means low usage in month one is normal and flat ratings in month three are not.",
    },
    {
      kicker: "Step two",
      title: "Close out enrolment.",
      body: "Eleven of twelve leaders have accepted. Open the roster, find who hasn't, and send a reminder — it arrives from the programme, not from a manager.",
      bullets: [
        { kind: "in", label: "Invite", text: "Add leaders by email; each one picks their own coach." },
        { kind: "in", label: "Nudge", text: "One tap for anyone who hasn't enrolled or hasn't booked." },
        { kind: "in", label: "At risk", text: "Flags appear automatically after five weeks with no session." },
      ],
    },
    {
      kicker: "Step three",
      title: "What is withheld, and why.",
      body: "Restrictions appear in the product as visible locked items, so you always know what exists rather than wondering what you're missing.",
      bullets: [
        { kind: "ok", label: "You see", text: "Enrolment, attendance, sessions used, on-track status, goal growth." },
        { kind: "no", label: "You never see", text: "Notes, recordings, goal wording, or an individual's chosen coach." },
        { kind: "no", label: "Under five people", text: "Distributions are suppressed and only the cohort average shows." },
      ],
    },
    {
      kicker: "Step four",
      title: "Two numbers renew a programme.",
      body: "On-track rate says whether people are showing up. Average goal growth says whether anything changed. Export both for any period, with or without the roster.",
    },
  ],
  pointers: [
    {
      where: "Left navigation",
      title: "Three screens, no fourth.",
      body: "There is no route from here into session content. The absence is deliberate — nothing sits behind a permission you could request later.",
      targetSelector: null,
    },
    {
      where: "Top of the dashboard",
      title: "One cohort at a time.",
      body: "Switch cohort here and every figure below follows, including the roster and the export.",
      targetSelector: null,
    },
    {
      where: "Roster",
      title: "Status, not stories.",
      body: "Enrolment, sessions used, and self-rated growth per person. Rows don't open into content — they open into the same aggregates plus what's withheld.",
      targetSelector: null,
    },
  ],
};

export const ONBOARDING_CONTENT: Record<OnboardingRole, OnboardingContent> = {
  coachee,
  coach,
  sponsor,
};

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PASSWORD = "Clariva2026!";

const COACHES = [
  {
    email: "marta.ruiz@demo.clariva.club",
    full_name: "Marta Ruiz",
    title: "Executive & Leadership Coach",
    bio: "Twelve years coaching senior leaders through transitions — first-time P&L ownership, cross-border teams, post-merger ambiguity. My work is structured but not scripted: we start from the decision in front of you, then build the habits that make the next one easier.",
    specialties: ["Leadership", "Communication"],
    hourly_rate: 180,
    years_experience: 12,
    nationality: "Spanish",
    country_based: "Spain",
    diplomas_certifications: [
      "ICF Professional Certified Coach (PCC)",
      "Hogan Assessments certified",
      "MSc Organisational Psychology, IE Madrid",
    ],
    is_featured: true,
    rating_avg: 4.9,
    sessions_completed: 372,
  },
  {
    email: "daniel.okafor@demo.clariva.club",
    full_name: "Daniel Okafor",
    title: "Performance & Transitions Coach",
    bio: "I work with operators stepping into their first executive seat. Sessions are direct, evidence-based, and always end with one thing you will do differently before we meet again.",
    specialties: ["Performance", "Career transition", "Resilience"],
    hourly_rate: 150,
    years_experience: 9,
    nationality: "Nigerian",
    country_based: "United Kingdom",
    diplomas_certifications: [
      "ICF Associate Certified Coach (ACC)",
      "Erickson Solution-Focused Coaching",
    ],
    is_featured: true,
    rating_avg: 4.8,
    sessions_completed: 214,
  },
  {
    email: "yuki.tanaka@demo.clariva.club",
    full_name: "Yuki Tanaka",
    title: "Team & Systems Coach",
    bio: "Former engineering director. I coach technical leaders on the human systems around them — decision rights, feedback loops, and the quiet politics of scale.",
    specialties: ["Team dynamics", "Strategy", "Feedback"],
    hourly_rate: 165,
    years_experience: 11,
    nationality: "Japanese",
    country_based: "Singapore",
    diplomas_certifications: [
      "ICF Professional Certified Coach (PCC)",
      "Team Coaching Studio Practitioner",
    ],
    is_featured: false,
    rating_avg: 4.7,
    sessions_completed: 288,
  },
  {
    email: "claire.dubois@demo.clariva.club",
    full_name: "Claire Dubois",
    title: "Wellbeing & Executive Presence Coach",
    bio: "Presence is not performance. I help leaders find a sustainable voice — how they show up in the room, and how they recover between rooms.",
    specialties: ["Executive presence", "Wellbeing", "Communication"],
    hourly_rate: 140,
    years_experience: 8,
    nationality: "French",
    country_based: "France",
    diplomas_certifications: ["ICF ACC", "MBTI Step II certified"],
    is_featured: false,
    rating_avg: 4.6,
    sessions_completed: 131,
  },
];

const COACHEES = [
  {
    email: "linh.pham@demo.clariva.club",
    full_name: "Linh Pham",
    bio: "Regional operations lead moving into a group role across four markets.",
    job_title: "Head of Operations",
    industry: "Logistics",
    location: "Ho Chi Minh City, Vietnam",
    timezone: "Asia/Ho_Chi_Minh",
    goals: "Lead across cultures with more confidence and delegate the work I am still holding.",
  },
  {
    email: "adam.novak@demo.clariva.club",
    full_name: "Adam Novak",
    bio: "First-time director in a fast-scaling fintech.",
    job_title: "Director of Product",
    industry: "Financial services",
    location: "Prague, Czechia",
    timezone: "Europe/Prague",
    goals: "Give sharper feedback and stop making every decision myself.",
  },
  {
    email: "sofia.almeida@demo.clariva.club",
    full_name: "Sofia Almeida",
    bio: "Commercial leader preparing for a country-manager appointment.",
    job_title: "Commercial Director",
    industry: "Consumer goods",
    location: "Lisbon, Portugal",
    timezone: "Europe/Lisbon",
    goals: "Build executive presence and a clearer strategic narrative.",
  },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  // caller must be an admin
  const token = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
  const { data: userData } = await admin.auth.getUser(token);
  if (!userData?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { data: isAdmin } = await admin.rpc("has_role", {
    _user_id: userData.user.id,
    _role: "admin",
  });
  if (!isAdmin) {
    return new Response(JSON.stringify({ error: "Admins only" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const created: string[] = [];

  async function ensureUser(email: string, full_name: string) {
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existing = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (existing) return existing.id;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name },
    });
    if (error) throw error;
    created.push(email);
    return data.user!.id;
  }

  try {
    // programme for coachees
    let { data: programme } = await admin
      .from("programmes")
      .select("id")
      .eq("name", "Growth")
      .maybeSingle();
    if (!programme) {
      const { data } = await admin
        .from("programmes")
        .insert({
          name: "Growth",
          description: "Six-month leadership acceleration programme.",
          duration_months: 6,
          color: "#3db4d0",
          is_active: true,
          coachee_session_limit: 8,
          coach_session_limit: 8,
          peer_session_limit: 4,
          peer_given_limit: 4,
        })
        .select("id")
        .single();
      programme = data;
    }

    for (const c of COACHES) {
      const id = await ensureUser(c.email, c.full_name);
      await admin.from("profiles").upsert({
        id,
        full_name: c.full_name,
        email: c.email,
        bio: c.bio,
        status: "active",
        must_change_password: false,
      });
      await admin.from("user_roles").upsert({ user_id: id, role: "coach" }, { onConflict: "user_id,role" });
      await admin.from("coach_profiles").upsert({
        id,
        title: c.title,
        specialties: c.specialties,
        hourly_rate: c.hourly_rate,
        years_experience: c.years_experience,
        nationality: c.nationality,
        country_based: c.country_based,
        diplomas_certifications: c.diplomas_certifications,
        is_featured: c.is_featured,
        approval_status: "approved",
        rating_avg: c.rating_avg,
        sessions_completed: c.sessions_completed,
      });
    }

    for (const c of COACHEES) {
      const id = await ensureUser(c.email, c.full_name);
      await admin.from("profiles").upsert({
        id,
        full_name: c.full_name,
        email: c.email,
        bio: c.bio,
        status: "active",
        must_change_password: false,
      });
      await admin.from("user_roles").upsert({ user_id: id, role: "coachee" }, { onConflict: "user_id,role" });
      await admin.from("coachee_profiles").upsert({
        id,
        job_title: c.job_title,
        industry: c.industry,
        location: c.location,
        timezone: c.timezone,
        goals: c.goals,
        approval_status: "approved",
      });
      if (programme?.id) {
        const { data: enr } = await admin
          .from("programme_enrollments")
          .select("id")
          .eq("coachee_id", id)
          .maybeSingle();
        if (!enr) {
          await admin.from("programme_enrollments").insert({
            coachee_id: id,
            programme_id: programme.id,
            status: "active",
            start_date: new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10),
            progress_pct: 35,
          });
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, created, password: PASSWORD }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

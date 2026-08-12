// Backend target override.
// Uses the project's own Supabase backend. Aliased via vite.config.ts in
// place of src/integrations/supabase/client.ts (kept as a generated-types
// import target only) so this file is the single source of truth for
// client credentials.
//
// NOTE: Do NOT add import.meta.env.VITE_SUPABASE_URL here.
// Vite only exposes VITE_* vars from .env files — not from process.env /
// Replit secrets — so import.meta.env.VITE_SUPABASE_URL resolves to ""
// at runtime, which crashes the Supabase client. The hardcoded values
// below ARE the correct project credentials (anon key is public-safe).
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export const SUPABASE_URL = "https://ygufjhhpguauwwmfvczy.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlndWZqaGhwZ3VhdXd3bWZ2Y3p5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyODI1MzIsImV4cCI6MjEwMTg1ODUzMn0.8Rja2HJbJuMoJzhL-qJf68wYPow3VSwZipJ7Te8V560";

export const supabase = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      storage: localStorage,
      persistSession: true,
      autoRefreshToken: true,
    },
  }
);

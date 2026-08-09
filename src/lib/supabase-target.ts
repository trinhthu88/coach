// Backend target override.
// The platform injects Lovable Cloud's VITE_SUPABASE_* values at build time, so
// .env / .env.local cannot repoint the app. This module hardcodes the project's
// own Supabase backend and is aliased in place of the auto-generated client via
// vite.config.ts, so it survives regeneration of that file.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export const SUPABASE_URL = "https://ygufjhhpguauwwmfvczy.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlndWZqaGhwZ3VhdXd3bWZ2Y3p5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyODI1MzIsImV4cCI6MjEwMTg1ODUzMn0.8Rja2HJbJuMoJzhL-qJf68wYPow3VSwZipJ7Te8V560";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});

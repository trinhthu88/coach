// Backend target override.
// The platform injects Lovable Cloud's VITE_SUPABASE_* values at build time, so
// .env / .env.local cannot repoint the app. This module hardcodes the project's
// own Supabase backend and is aliased in place of the auto-generated client via
// vite.config.ts, so it survives regeneration of that file.
//
// On Replit, set these secrets in the Secrets panel:
//   VITE_SUPABASE_URL      → your Supabase project URL
//   VITE_SUPABASE_ANON_KEY → your Supabase anon/publishable key
// When these env vars are present they take precedence over the hardcoded values.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Support both naming conventions: VITE_SUPABASE_ANON_KEY (Replit secret) and
// VITE_SUPABASE_PUBLISHABLE_KEY (Lovable / .env convention).
const _url =
  import.meta.env.VITE_SUPABASE_URL ||
  "https://ygufjhhpguauwwmfvczy.supabase.co";

const _key =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlndWZqaGhwZ3VhdXd3bWZ2Y3p5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyODI1MzIsImV4cCI6MjEwMTg1ODUzMn0.8Rja2HJbJuMoJzhL-qJf68wYPow3VSwZipJ7Te8V560";

export const SUPABASE_URL = _url;
export const SUPABASE_PUBLISHABLE_KEY = _key;

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

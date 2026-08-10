// This module is intercepted by the Vite alias in vite.config.ts (@/integrations/supabase/client
// -> src/lib/supabase-target.ts) at build/runtime. The re-export below only exists so that
// TypeScript's path resolution (tsconfig `paths`, which Vite's alias doesn't affect) has a real
// module to resolve — every import of "@/integrations/supabase/client" actually gets
// supabase-target.ts either way.
export { supabase } from "@/lib/supabase-target";

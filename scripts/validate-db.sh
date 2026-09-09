#!/usr/bin/env bash
set -euo pipefail

# Docker-only validation. This never contacts the linked project.
npx supabase start
npx supabase db reset --local
npx supabase test db --local supabase/tests
npx supabase db lint --local
npx supabase gen types typescript --local --schema public > /tmp/clariva-generated-types.ts
diff -u src/integrations/supabase/types.ts /tmp/clariva-generated-types.ts
npx tsc --noEmit
npm run lint
npm run test
npm run build

#!/usr/bin/env bash
# Regenerates the repo-migration manifest embedded in full-ledger-audit.sql
# from supabase/migrations/. Run after adding or renaming a migration.
# Local only: reads the repository, contacts no database.
set -euo pipefail
cd "$(dirname "$0")/../.."
target=scripts/ledger/full-ledger-audit.sql
python3 - "$target" <<'PY'
import os, re, sys
target = sys.argv[1]
rows = []
for f in sorted(os.listdir('supabase/migrations')):
    if not f.endswith('.sql'):
        continue
    version, _, rest = f[:-4].partition('_')
    if not version.isdigit():
        raise SystemExit(f'unexpected migration filename: {f}')
    rows.append((version, rest.replace("'", "''")))
body = ',\n'.join(f"  ('{v}', '{n}')" for v, n in rows)
block = ("-- BEGIN REPO MANIFEST (generated — do not edit by hand)\n"
         f"{body}\n"
         "-- END REPO MANIFEST")
src = open(target).read()
new, count = re.subn(
    r"-- BEGIN REPO MANIFEST.*?-- END REPO MANIFEST", block, src, flags=re.S)
if count != 1:
    raise SystemExit('manifest markers not found exactly once')
open(target, 'w').write(new)
print(f'manifest: {len(rows)} migrations')
PY

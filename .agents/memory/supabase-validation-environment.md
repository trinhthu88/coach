---
name: Supabase validation environment
description: Constraints for validating repository migrations when the linked Supabase schema is behind the workspace.
---

When the linked Supabase project is missing repository migrations, do not apply historical migrations there solely to make a fixture run. Prefer a complete local database or an explicitly approved isolated branch; if branch creation is unavailable, keep the linked project unchanged and leave the validation gate blocked.

**Why:** The linked project can contain the canonical functions and a newly applied migration while still lacking later repository Sponsor migrations, making an unchanged reconciliation fixture fail on a return-shape mismatch. The available Supabase plan may reject development branch creation after cost confirmation.

**How to apply:** Compare the remote migration ledger with the workspace before validation. Treat a fixture contract mismatch as migration parity drift, not as permission to rename assertions or alter the production ledger. Resume only when local validation or an approved full-schema environment is available.
---
name: Demo credential reset
description: Safe handling for fictional live-demo account credentials
---

Demo account recovery must be an authenticated admin-only operation: rotate all fixed demo accounts directly in Auth, mark them for password change, never send recovery email, and return the temporary passwords only in the admin dashboard response.

**Why:** The demo addresses are fictional and cannot receive email, while exposing passwords through logs, chat, or public endpoints would violate the live-demo safety boundary.

**How to apply:** Keep the credential action separate from demo data provisioning/reset, require the demo registry to be ready, and treat the returned values as one-time display data.
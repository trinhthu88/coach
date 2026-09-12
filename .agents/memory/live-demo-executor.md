---
name: Live demo executor contract
description: Durable constraints for the Clariva live-demo Batch 1 executor.
---

The live-demo executor must reject every target except the approved fixed organization UUID and fixture anchor date, and all lifecycle mutations must remain callable only by the server role. Provisioning and reset requests use an organization-scoped transaction advisory lock, an idempotency key, and a generation compare-and-swap; stale or failed work leaves the registry failed-closed rather than silently resuming.

**Why:** A browser-controlled organization ID or an automatically adopted Auth identity could turn a demo reset into destructive cross-organization behavior or expose a real account to the fixture.

**How to apply:** Later fixture batches must use the existing operation state machine and resource registry. They must not add client-side writes, relax the fixed target, or infer ownership from matching email/name.
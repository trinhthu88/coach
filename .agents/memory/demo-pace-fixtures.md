---
name: Demo pace fixtures
description: Testing rule for deterministic enrollment progress and schedule scenarios.
---

Deterministic demo scenarios must assert the exact module result returned by the enrollment progress RPC at a documented fixed date. Do not infer pace from raw activity counts.

**Why:** Due units, booked coverage, completion, module schedules, and enrollment dates interact. Plausible row counts can still produce a different pace state, especially for scheduled and not-yet-due cases.

**How to apply:** Give every scenario stable enrollment and activity dates, call the progress RPC with a fixed `as_of` date, and assert the intended module and pace state directly.
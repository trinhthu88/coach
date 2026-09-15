---
name: Training timeline enrollment scope
description: Durable rule for keeping training weeks and progress tied to the selected programme enrollment.
---

Training timeline data must be resolved from the explicitly selected enrollment, not from any active enrollment for the user. A user can retain completed historical programmes while starting another active programme, and an active-enrollment join can otherwise surface the wrong programme's training weeks or merge multiple programmes.

**Why:** The production training timeline reader and module gate used active-enrollment joins while the app had separate enrollment selection and an explicit enrollment-scoped training reader. This made a historical/current programme mismatch easy to misdiagnose and leaves a real multi-active-enrollment mixing risk.

**How to apply:** Keep the selected enrollment ID in the query key and pass it to every training-week, module, assignment, prompt, reflection, and progress reader. Use enrollment-scoped progress rows rather than user-only progress joins.
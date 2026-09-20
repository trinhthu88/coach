---
name: Startup bundle loading
description: Performance constraints for the browser entry bundle and translation loading.
---

Keep public-route startup code limited to the shared shell, auth bootstrap, and the active route. Load authenticated layout features and translation namespaces on demand; test setup must preload namespaces because many component tests assert synchronously.

**Why:** The public entry previously bundled the authenticated layout, onboarding UI, and every English/Vietnamese namespace, making the initial JavaScript substantially larger even though most of it was not needed.

**How to apply:** Preserve route-level lazy imports, keep AppLayout and onboarding lazy, and use the i18next backend loaders for new namespaces. If adding tests for translated components, preload namespaces in the test setup rather than making production translations eager.
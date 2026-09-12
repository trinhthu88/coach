---
name: Live demo safety boundary
description: Production demo registry and provisioning/reset safety constraints.
---

The live demo registry migration must never create an organization, Auth identity, or fixture row. Provisioning and reset are separate server-only operations bound to one deployment-configured organization ID, with no browser-supplied target.

**Why:** Local reset fixtures and production demo data have different ownership and failure modes; automatic or client-targeted mutations could touch real organizations or identities.

**How to apply:** Keep the registry read-only to clients, record resource ownership and idempotent operations, validate collisions before writes, and fail closed when the executor or fixed target is absent.
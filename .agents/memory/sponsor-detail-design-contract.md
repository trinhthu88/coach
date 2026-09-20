---
name: Sponsor detail design contract
description: Durable constraint for sponsor cohort and leader detail visual work.
---

Sponsor cohort and leader detail pages may only expose values returned by the sponsor-safe summary RPCs. The current contract does not include weekly module history or a last-activity timestamp, so those reference-design regions must use clearly labelled aggregate or withheld states rather than inferred or fabricated values.

**Why:** Sponsor privacy is enforced through the RPC surface, and visual prototypes contain richer weekly/private activity than the production contract permits.

**How to apply:** Preserve the reference layout, typography, cards, and responsive structure, but label unavailable fields as withheld/not shared and do not add direct table queries or retired sponsor RPCs to make the mock data appear complete.
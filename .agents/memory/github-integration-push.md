---
name: GitHub integration push
description: How to preserve an existing local commit graph when the shell Git credential cannot push.
---

When a connected GitHub integration is available but shell Git authentication is rejected, upload the commits, trees, and blobs through the authenticated Git Database API, then create the branch ref only after every generated commit SHA matches the local SHA.

**Why:** File-by-file Contents API writes create a different commit history and can silently lose the local ancestry. Creating the ref only after SHA verification prevents publishing a partially reconstructed branch.

**How to apply:** Find the shared ancestor with the remote branch, upload only the local commits after that ancestor, preserve parents/authors/timestamps/messages, verify the remote tip, and never force-update `main` as part of this recovery.
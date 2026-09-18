---
name: GitHub integration push
description: How to preserve an existing local commit graph when the shell Git credential cannot push.
---

When a connected GitHub integration is available but shell Git authentication is rejected, upload the commits, trees, and blobs through the authenticated Git Database API, then create the branch ref only after every generated commit SHA matches the local SHA.

**Why:** File-by-file Contents API writes create a different commit history and can silently lose the local ancestry. Creating the ref only after SHA verification prevents publishing a partially reconstructed branch.

**How to apply:** Find the shared ancestor with the remote branch, upload only the local commits after that ancestor, preserve parents/authors/timestamps/messages, verify the remote tip, and never force-update `main` as part of this recovery.

When creating a commit through GitHub's Git Database API, include the exact terminal newline in the message if the local Git object has one; otherwise GitHub can create a semantically identical commit with a different SHA.

**Why:** Git commit hashes include the raw commit-message bytes, not just the displayed text. The API otherwise omits the terminal newline.

**How to apply:** Compare the remote tree and commit SHA with local Git before updating the branch ref; never accept a metadata-only match as sufficient.

When GitHub reports the fetched remote tip as the local merge base, do not merge or rebase just because a push was rejected; the safe operation is a normal fast-forward push.

**Why:** A push rejection can come from invalid shell credentials or a connector that can create Git objects but cannot execute `UpdateRef`; rewriting an already-linear history would add avoidable risk.

**How to apply:** Fetch first, report both exclusive commit sets, then retry a non-forced push through an authorized path. If REST returns 404 and GraphQL returns `FORBIDDEN` for `UpdateRef`, stop without changing the branch or dispatching CI.

The CodeExecution shell wrapper can normalize or remove tabs, NUL separators, and trailing whitespace from command output.

**Why:** Direct parsing of `git cat-file` and NUL-delimited tree output failed even though the underlying Git objects were valid.

**How to apply:** Base64-encode commit and blob contents before passing them to an impure connector call, and use a visible separator such as `|` for changed-path metadata.
---
name: Branch and PR workflow
description: Project contribution rule for isolating repository changes and merging through main.
---

**Rule:** Start each repository change on a new branch based on the intended current `main`, then open a pull request into `main`. Never push commits directly to `main`.

**Why:** The user explicitly requires review through pull requests and forbids direct pushes to the primary branch.

**How to apply:** Before editing project files, branch from the current main base. Push only the feature branch and open a PR into `main`. Keep direct production operations separate from repository changes.

---
name: implement-issue
description: Author role. Implement one GitHub issue on a branch and open a PR for the reviewer.
disable-model-invocation: true
argument-hint: "<issue number>"
---

You are the **author** (decision 0008). You write the change and answer review. A separate reviewer session approves and merges it; your PR is finished when it is opened, never merged by you.

## Build

1. **Title** this session `#N - author: <issue title>` with `set_session_title` (session `self`), unless it already has that title.
2. **Read** the issue (`gh api repos/ptra243/WhatsForDinner/issues/N`), `CLAUDE.md`, and the docs it names. If the issue is unclear or needs an owner decision, stop and say so in your final message; the dispatcher passes it on.
3. **Branch** `issue-N-<short-slug>` from the latest `master`.
4. **Implement** until every acceptance criterion is met. The issue's **Owner checks** are the owner's to do after merge; leave them to the owner. The live database is for dry runs inside a transaction that rolls back; the reviewer applies real changes after merge.
5. **Check** with whatever runs locally (build scripts, tests, lint).
6. **Open the PR** against `master`: title from the issue, body with `Closes #N` (or `Refs #N` when the issue has an **Owner checks** section, so it stays open for the owner), a **What** section, and a **Tested** section split into *CI covers* and *Checked by hand* (say exactly what was run). Name anything not verified.

End your turn with the PR link.

## Answering review

When told there is a new review on your PR: read the newest `Review:` comment. For every finding either fix it or reply on the PR with why it should stand. Push, then post one PR comment listing each finding and what you did. End your turn.

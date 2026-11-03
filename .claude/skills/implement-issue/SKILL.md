---
name: implement-issue
description: Author role. Implement one GitHub issue on a branch and open a PR for the reviewer.
disable-model-invocation: true
argument-hint: "<issue number> [--after <issue> ...]"
---

You are the **author** (decisions 0008, 0009 and 0010). You write the change and answer review. A separate reviewer session approves and merges it; your PR is finished when it is opened, never merged by you.

## Wait (on deck only)

With `--after A B …`, wait before building: run `bash .claude/skills/ship/wait-for.sh merged A B …` with the Bash tool's `run_in_background`, then end your turn. You are woken when it exits. If it printed `merged`, go on with **Build** from the latest `master`. If it timed out, end your turn saying what you were waiting for.

## Build

1. **Title** this session `#N - author: <issue title>` with `set_session_title` (session `self`), unless it already has that title.
2. **Read** the issue (`gh api repos/ptra243/WhatsForDinner/issues/N`), `CLAUDE.md`, and the docs it names. If the issue is unclear or needs an owner decision, stop and say so in your final message; the dispatcher passes it on.
3. **Branch** `issue-N-<short-slug>` from the latest `master`.
4. **Implement** until every acceptance criterion is met. The issue's **Owner checks** are the owner's to do after merge; leave them to the owner. The live database is for dry runs inside a transaction that rolls back; the reviewer applies real changes after merge.
5. **Check** with whatever runs locally (build scripts, tests, lint). For any change the app shows, run the local stack and the dev server, sign in with `npm run dev:login` in `web/` (README, "To sign in locally"; add `-- --app <dev server URL>` when it is not on port 5173), and use the changed screens at phone width (375 px) in the built-in browser, walking the issue's **Goal** from the tab the owner would open.
6. **Rebase** on the latest `master` and re-run the checks: other issues land in parallel (decision 0009). If a migration you added now sorts before one already on `master`, rename it to a later timestamp.
7. **Open the PR** against `master`: title from the issue, body with `Closes #N` (or `Refs #N` when the issue has an **Owner checks** section, so it stays open for the owner), a **What** section, and a **Tested** section split into *CI covers* and *Checked by hand* (say exactly what was run). Name anything not verified.
8. **Hand off**: once the PR is open and pushed, post a PR comment whose first line is `Ready for review`. The reviewer session is already waiting for it. Post it only once, when everything above is done.

End your turn with the PR link.

## Answering review

When told there is a new review on your PR: read the newest `Review:` comment. For every finding either fix it or reply on the PR with why it should stand. Rebase on the latest `master` if asked or if GitHub reports a conflict. Push, then post one PR comment listing each finding and what you did. End your turn.

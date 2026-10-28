---
name: ship
description: Take an issue or a milestone from open to merged, with a separate author and adversarial reviewer per issue.
disable-model-invocation: true
argument-hint: "#<issue> | <milestone, e.g. M1>"
---

You are the **dispatcher** (decisions 0008 and 0009). You start sessions and pass pointers between them. The author session writes the code, the reviewer session judges and merges, the owner settles disputes. Your own work is limited to reading GitHub and starting or messaging sessions.

## Scope

Read it from the arguments:

- `#N` or `N`: that one issue.
- A milestone (`M1`, `M1 · Real use`): its open issues that have no merged PR, in waves (below).
- Anything else, or nothing: ask the owner.

## Session titles

Every session in the workflow is titled `#<issue> - <what it is doing>` so the owner can read the sidebar at a glance. Rename yourself with `set_session_title` (session `self`): `#N - ship: <issue title>` for one issue, `M1 - ship milestone` in milestone mode.

## Waves

An issue is **ready** when it is open, has acceptance criteria, and every issue under "Depends on" is closed or has a merged PR (an issue with owner checks stays open after its PR merges; that counts as done). If "Depends on" names an owner decision, ask the owner first. An issue that is unclear or not ready for another reason: tell the owner why and leave it out.

Keep up to **3 issues in flight**, taking ready issues in the build order in `docs/roadmap.md`, except:

- Two issues whose criteria mention a migration or schema change are never in flight together.
- An issue whose criteria name a file another in-flight issue creates waits for it.

Whenever an issue merges, fill the free slot.

## Per issue

1. **Start the author.** `start_session`: initiation `user_asked`, context `fresh`, `use_worktree: true`, title `#N - author: <issue title>`, prompt `/implement-issue N`. Nothing else in the prompt.
2. **Find the PR** when the author's note arrives: `gh pr list --state open --search "N in:body"`. No PR means the author is blocked; pass its question to the owner.
3. **Start the reviewer.** `start_session`: initiation `user_asked`, context `fresh`, `use_worktree: true`, title `#N - review PR #P`, prompt `/review-pr P`. Nothing else in the prompt: the reviewer's brief is its skill, never your summary.
4. **Relay** each time the reviewer ends a turn. Read the newest PR comment starting `Review:` (`gh api repos/ptra243/WhatsForDinner/issues/P/comments`):
   - `Review: APPROVE` and the PR is merged: tell the owner in one line (`#N merged as PR #P`), then fill the slot.
   - `Review: CHANGES REQUESTED`: `SendMessage` the author `New review on PR #P.` When the author ends its turn, `SendMessage` the reviewer `Author updated PR #P; re-review.`
   - `Review: ESCALATED`: hand the PR link to the owner; the issue leaves the wave, the others carry on.

Relay pointers only. The PR thread is the record; findings and replies stay there in the author's and reviewer's own words.

## Sweep on every turn

Notes can arrive late or not at all: the app holds them after a long run of notes with no message from the owner, and while the owner is talking to a session directly. So at the start of **every** turn, whatever woke you, rebuild the state from GitHub and `list_sessions` `{"linked": true}` instead of trusting the last note:

- an in-flight issue with an open PR and no reviewer session: start the reviewer;
- a `Review:` comment newer than your last relay: relay it;
- a merged PR whose slot is still empty: fill it.

**When a start is refused** (the app does not let you start sessions in a turn another session's message or an automated event started): send the owner a push notification if the tool is available, and end your turn with one line naming each waiting step, for example `PR #50 is ready for review; reply "go" to start the reviewer.` The owner's reply is your next turn; the sweep starts it.

End every turn the owner started with one line on what is in flight (`In flight: #10 in review, #11 authoring`).

**Done** when every issue in scope is merged or handed to the owner with a reason. Then list every open **Owner checks** item in scope, one row per issue with its link, in one message.

## Talking to the owner

Interrupt for blockers only: an issue that is not ready or unclear, an escalation, an author question that is the owner's decision, a refused start. Plus the one-line merge note and the closing owner-checks list.

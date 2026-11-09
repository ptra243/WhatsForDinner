---
name: ship
description: Take an issue or a milestone from open to merged, with a separate author and adversarial reviewer per issue.
disable-model-invocation: true
argument-hint: "#<issue> | <milestone, e.g. M1>"
---

You are the **dispatcher** (decisions 0008, 0009 and 0010). You start sessions and pass pointers between them. The author session writes the code, the reviewer session judges and merges, the owner settles disputes. Your own work is limited to reading GitHub and starting or messaging sessions.

## Scope

Read it from the arguments:

- `#N` or `N`: that one issue.
- A milestone (`M1`, `M1 · Real use`): its open issues that have no merged PR, in waves (below).
- Anything else, or nothing: ask the owner.

## Session titles

Every session in the workflow is titled `#<issue> - <what it is doing>` so the owner can read the sidebar at a glance. Rename yourself with `set_session_title` (session `self`): `#N - ship: <issue title>` for one issue, `M1 - ship milestone` in milestone mode.

## Hourly sweep ping (milestone mode)

Background waits die without waking anyone (an app restart, or Git Bash running out of processes), and scheduled-task completion notifications do not wake you either; a `SendMessage` does (decision 0010). So in milestone mode, before starting any session:

1. Get your own session id with `get_session` `"self"`.
2. Create a scheduled task with `mcp__scheduled-tasks__create_scheduled_task`. There is one ping per milestone:
   - `taskId` `<milestone>-ship-sweep-ping` (for example `m3-ship-sweep-ping`). If that id is taken, an earlier dispatcher for this milestone (or a hand-made ping) left it: do not create a second one. Take it over with `mcp__scheduled-tasks__update_scheduled_task`, with the `prompt` below carrying your id and `enabled: true`, and tell the owner in one line that you took over an earlier ping, since the session it pointed at may still be running.
   - `description`, for example `Wakes the /ship M3 dispatcher hourly`.
   - `cronExpression` at a minute that isn't :00 or :30, for example `11 * * * *`.
   - `notifyOnCompletion: false` (the notifications never wake you; the message does).
   - `prompt`, with your session id filled in: `This task only wakes the /ship dispatcher session <id>, which does the real work. Load the SendMessage tool (ToolSearch "select:SendMessage") and send exactly one message: to = "<id>", message = "Hourly sweep ping: run the sweep.". Do nothing else: do not read or change any files, repos, GitHub issues or other sessions. Reply with one line saying whether the message was delivered.`

Each ping is a turn like any other: run the sweep. A ping turn was started by a message, so starts are refused in it; the deck covers that (see **When a start is refused**).

When the milestone is **done**, after the owner-checks list has gone out, delete the task with `mcp__scheduled-tasks__delete_scheduled_task`. Delete it too if the owner stops the milestone before then. Single-issue mode does not create one.

## Waves

An issue is **ready** when it is open, has acceptance criteria, and every issue under "Depends on" is closed or has a merged PR (an issue with owner checks stays open after its PR merges; that counts as done). If "Depends on" names an owner decision, ask the owner first. An issue whose dependencies are still in flight waits for a later slot (single issue: tell the owner which dependency is open and stop). An issue that is unclear or not ready for another reason: tell the owner why and leave it out.

Keep up to **3 issues in flight**, taking ready issues in the build order in `docs/roadmap.md`, except:

- Two issues whose criteria mention a migration or schema change are never in flight together.
- An issue whose criteria name a file another in-flight issue creates waits for it.

Whenever an issue merges, fill the free slot.

### On deck

The app refuses to start sessions in a turn that another session's message or an automated event started, so every start would otherwise wait for the owner's next message. So in every turn where starts work, after filling the free slots, put up to **3 issues on deck**: the issues that will take the next slots, in build order. Each starts now and waits on GitHub, with `--after` naming the issues it waits for:

- the in-flight (or on-deck) issue whose slot it takes;
- plus any in-flight or on-deck issue it depends on, shares a schema change with, or needs a file from.

An issue whose "Depends on" names an open owner decision is never put on deck. With issues on deck, the owner is only needed when the deck runs out.

## Per issue

1. **Start the pair in the same turn.** Two `start_session` calls, each initiation `user_asked`, context `fresh`, `use_worktree: true`, and nothing else in the prompt (a session's brief is its skill, never your summary):
   - author: title `#N - author: <issue title>`, prompt `/implement-issue N`, or `/implement-issue N --after A B` on deck;
   - reviewer: title `#N - review`, prompt `/review-pr --issue N`. It waits for the author's `Ready for review` comment, then reviews and renames itself `#N - review PR #P`.
2. **Find the PR** by its branch, which `/implement-issue` names `issue-N-<slug>`: `gh api "repos/ptra243/WhatsForDinner/pulls?state=open&per_page=100" --jq '.[] | select(.head.ref | startswith("issue-N-")) | .number'`. (Not a body search: other PRs name #N under "Depends on".) An author that has ended its turn with no PR is blocked; pass its question to the owner.
3. **Relay** each time the reviewer ends a turn. Read the newest PR comment starting `Review:` (`gh api repos/ptra243/WhatsForDinner/issues/P/comments`):
   - `Review: APPROVE` and the PR is merged: tell the owner in one line (`#N merged as PR #P`). The on-deck issue waiting for it starts by itself; refill the deck when you can start sessions.
   - `Review: CHANGES REQUESTED`: `SendMessage` the author `New review on PR #P.` When the author ends its turn, `SendMessage` the reviewer `Author updated PR #P; re-review.`
   - `Review: ESCALATED`: hand the PR link to the owner; the issue leaves the wave, the others carry on. Name any on-deck issue waiting for it: it keeps waiting until the owner settles the PR or the wait times out.

Relay pointers only. The PR thread is the record; findings and replies stay there in the author's and reviewer's own words.

## Sweep on every turn

Notes can arrive late or not at all: the app holds them after a long run of notes with no message from the owner, and while the owner is talking to a session directly. So at the start of **every** turn, whatever woke you, rebuild the state from GitHub and `list_sessions` `{"linked": true}` instead of trusting the last note:

- an in-flight or on-deck issue with no reviewer session (for example one started before decision 0010): start one with `/review-pr --issue N`, or `/review-pr P` when its PR is already ready;
- free slots or deck places with ready issues left: fill them;
- a `Review:` comment newer than your last relay: relay it;
- after `CHANGES REQUESTED`, an author push or PR comment newer than the newest `Review:` comment, and the reviewer not yet asked: send it `Author updated PR #P; re-review.`;
- an author session that is idle with no PR and not waiting: pass its question to the owner;
- a waiting session (idle, its issue not built or its PR not reviewed) whose wait has died: read its newest events with `list_events`. A failed `wait-for.sh` notice with no output is a wait killed from outside (an app restart kills every background wait, and so can Git Bash running out of processes; the session is not woken for it). `SendMessage` it `Your wait was killed; start it again.`;
- a session whose wait timed out: tell the owner what it was waiting for.

After an app restart the sweep is the only thing that notices killed waits, and it runs only when something wakes you: the hourly ping in milestone mode, or the owner's next message. So on the first turn after a restart, sweep every waiting session.

**When a start is refused** (the app does not let you start sessions in a turn another session's message or an automated event started): only needed once the deck is empty. Send the owner a push notification if the tool is available, and end your turn with one line naming each waiting step, for example `#21 is ready for a slot; reply "go" to start it.` The owner's reply is your next turn; the sweep starts it.

End every turn the owner started with one line on what is in flight (`In flight: #10 in review, #11 authoring; on deck: #12 after #10`).

**Done** when every issue in scope is merged or handed to the owner with a reason. Then list every open **Owner checks** item in scope, one row per issue with its link, in one message. In milestone mode, then delete the hourly sweep ping task.

## Talking to the owner

Interrupt for blockers only: an issue that is not ready or unclear, an escalation, an author question that is the owner's decision, a refused start. Plus the one-line merge note and the closing owner-checks list.

When the owner stops the milestone (tells you to stop, or abandons it), delete the hourly sweep ping task before ending your turn, so nothing keeps waking a finished dispatcher.

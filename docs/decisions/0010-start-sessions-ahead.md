# 0010 · Start reviewers and next authors ahead; they wait on GitHub

**Date:** 2026-11-03 · **Status:** accepted; amends [0009](0009-parallel-waves-and-used-reviews.md)

**Context.** In `/ship M2` every hand-off stalled until the owner wrote something. The app refuses to start a session in a turn that another session's message started, and it holds notes after a run of them with no message from the owner. So "PR is open, start the reviewer" and "PR merged, start the next author" each needed a "go", even with the sweep and push notifications from 0009. Wave 2's three PRs (#71, #72, #73) sat with no reviewer until the owner asked whether the authors were done. Push notifications only help when Remote Control is on, and even then the owner has to reply.

**Decision.**

- The dispatcher starts each issue's reviewer in the same turn as its author. It runs `/review-pr --issue N`, which waits in the background with `.claude/skills/ship/wait-for.sh ready N` and reviews once the author posts a `Ready for review` comment on the PR.
- In every turn where it can start sessions, the dispatcher also puts up to 3 issues **on deck**: author and reviewer pairs for the issues that take the next slots. The author runs `/implement-issue N --after A B`, which waits until those issues have merged PRs, then builds from the latest `master`. `--after` names the issue whose slot it takes plus any issue it depends on, shares a schema change with, or needs a file from, so the wave rules from 0009 still hold.
- Review rounds are relayed with messages, as before, since the app allows messages where it refuses starts.
- Waits poll GitHub's REST API once a minute and time out after 48 hours, so a stuck hand-off reaches the owner. (First set at 12 hours. Raised on 2026-11-04: #24's reviewer, started at the back of a chain of schema issues, would have timed out before #24 had a PR.)
- An app restart kills every background wait without waking its session (the #24 pair on 2026-11-04 sat idle after a failed notice with exit code 4). The dispatcher's sweep reads each waiting session's newest events and tells one whose wait died to start it again.

**Consequences.** A PR goes from opened to merged, and the next issue starts, with no message from the owner, until the deck runs out (at most 3 issues ahead). More sessions sit open in the sidebar while they wait; the wait is a shell loop, so it costs no tokens. On-deck issues are chosen before earlier ones merge, so a merge that changes the order (an escalation, a new dependency) can leave an issue waiting for the wrong thing until the dispatcher's next sweep or the timeout. Killed waits are only caught when something wakes the dispatcher, so after an app restart the chain can sit still until the owner's next message.

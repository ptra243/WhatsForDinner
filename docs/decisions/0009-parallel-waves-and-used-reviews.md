# 0009 · Ship milestones in waves; reviewers use the app

**Date:** 2026-10-28 · **Status:** accepted; amends [0008](0008-review-harness.md)

**Context.** `/ship M1` merged 14 PRs in about 4½ hours, one issue at a time. About 105 of the 268 minutes were two stalls where a PR sat with no reviewer. The app holds session notes after a long run of them with no message from the owner, and while the owner talks to a session directly. It also refuses to start a session in a turn that another session's message started. Working one issue at a time cost about another 40 minutes: the longest chain of dependencies (#5 → #6 → #8 → #10 → #14) was about 86 minutes of work, against about 128 minutes for #5–#14 in sequence. All 14 reviews approved in the first round, and several PRs merged without anyone opening the app, because signing in locally took too many steps. The owner found two gaps on their phone within minutes (#51, #52).

**Decision.**

- In milestone mode the dispatcher keeps up to 3 ready issues in flight, in roadmap order. Two issues that change the schema never run together, and an issue that needs a file another in-flight issue creates waits for it. This replaces "one issue at a time" in 0008.
- Authors rebase on the latest `master` before opening a PR. A migration that would sort before one already on `master` gets a later timestamp. Reviewers test with `master` merged in locally, and treat a conflicting PR as a blocking finding.
- At the start of every turn the dispatcher rebuilds the state from GitHub and the linked sessions instead of trusting the last note. It starts any reviewer that is missing. When the app refuses a start, it tells the owner in one line (and sends a push notification when it can) and waits for a reply.
- For any change the app shows, the author and reviewer both sign in on the local stack and use the changed screens at phone width. They walk the issue's goal from the tab the owner would open. A goal the screens don't reach is a finding. A reviewer who cannot run the app escalates rather than approving. The review comment says what was tried, and an approval with no findings names the cases the reviewer tried to break. A one-command dev sign-in (#59) makes this quick.
- At the end of a milestone the dispatcher lists every open owner check.

**Consequences.** Faster milestones, at the cost of more rebases and more relay messages, which reach the app's note limit sooner, so refused starts that need the owner's "go" become more likely. Reviews take longer because they run the app. Playwright end-to-end tests were considered and left until the app has more screens. The planned GitHub Actions reviewer from 0008 still applies.

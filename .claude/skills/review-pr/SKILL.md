---
name: review-pr
description: Reviewer role. Adversarially review one PR, then approve and merge it, request changes, or escalate to the owner.
disable-model-invocation: true
argument-hint: "<PR number>"
---

You are the **adversarial reviewer** (decisions 0008 and 0009). The PR is wrong until it proves itself. You judge and merge; the author fixes. Your hands stay off the PR branch: findings go in a PR comment, never a commit.

## Review

1. **Load** the PR (`gh pr view P --json title,body,headRefName,commits,files`), its diff (`gh pr diff P`), the issue it closes, every earlier `Review:` comment and author reply on the PR, `CLAUDE.md`, and the docs the change touches. The round number is the count of earlier `Review:` comments plus one. Title this session `#N - review PR #P` (N is the issue it closes) with `set_session_title` (session `self`), unless it already has that title.
2. **Guard.** If this session wrote any commit on the PR, post `Review: ESCALATED` saying so and stop.
3. **Check out** the PR head (`gh pr checkout P`) and run what the change can be run with. Read every changed file in full, not only the diff. If `master` has moved since the PR branched, also run the tests with `origin/master` merged in locally (never pushed): other issues land in parallel (decision 0009). If GitHub reports the PR as conflicting, that is a blocking finding: rebase on `master`.
4. **Use it.** For any change the app shows, run the local stack and the dev server (README, "To sign in locally"; `npm run dev:login` once #59 lands), sign in, and use the changed screens at phone width (375 px) in the built-in browser. Walk the issue's **Goal** as the owner would, starting from the tab they would open: a goal the screens don't reach, or a step that is slow or confusing, is a finding. Try an empty week, a failed save and a reload mid-action. If you cannot run it (for example Docker is not running), post `Review: ESCALATED` with the reason and everything else you checked, so the owner decides; never approve without it.
5. **Judge** against the checklist below. Every acceptance criterion and every item gets a verdict with evidence.
6. **CI.** `gh pr checks P`; if pending, wait with `gh pr checks P --watch` in the background.
7. **Post one comment** on the PR:
   - first line `Review: APPROVE`, `Review: CHANGES REQUESTED` or `Review: ESCALATED`, then `Round k of 3`;
   - each acceptance criterion: met / not met, with the file or test that shows it;
   - **Used it**: what you did in the browser and what you saw, or why you could not;
   - each finding: `file:line`, what goes wrong, the concrete case that breaks it. Mark minor convention issues `nit:`; nits never block.
   - An approval with no findings names the cases you tried to break and how each held.

## Checklist

- **Acceptance criteria**: each one met by something you can point at. The issue's **Owner checks** section is the owner's, after merge; it never blocks your verdict.
- **Hard rules** in `CLAUDE.md`: secrets, `household_id` plus Row Level Security, fixed units and sections in step across code, skill and docs, schema changes as new migrations with docs updated.
- **Tested claims**: a claim CI covers stands when CI is green and a test actually exercises the changed code; confirm the test exists. A claim CI cannot see (live database, phone, by hand) you reproduce, or you ask for evidence.
- **Bugs**: wrong results, unhandled cases, broken re-runs, data loss. Each one with its failure case.
- **Use**: the issue's goal can be reached from the screens, at phone width, without lag or a dead end.
- **Scope**: changes outside the issue are findings.

## Verdict

- **APPROVE** only when every criterion is met, no blocking finding is left, and CI is green. Then:
  1. `gh pr merge P --squash --delete-branch`.
  2. **Live database** (project `fckheksaemriadvrveoj`): apply each migration file the PR added, in filename order, with the Supabase `apply_migration` tool (name = file name without `.sql`); if `supabase/seed/seed.sql` changed, run it with `execute_sql`. Report the result on the PR.
- **CHANGES REQUESTED** when anything blocks, in rounds 1 and 2.
- **ESCALATED** when anything still blocks in round 3, or the author disputes a finding you still hold. Name the open points for the owner.

End your turn after posting.

---
name: update
description: Report where the Forecast tier refactor stands — the current Part and step, what is happening against the spec, and the next step. Use when asked "where are we", "what's the status", "what's next", "what step am I on", or when /update is typed.
---

# /update — refactor progress report

Spawn the `update` agent and relay what it says.

## Steps

1. Call the **Agent** tool with:
   - `subagent_type: "update"`
   - `run_in_background: false` — the user is waiting for this answer
   - `description: "Refactor progress report"`
   - `prompt:` the standing ask, plus any argument the user passed as a focus hint:

     > Report where the Forecast tier refactor stands. Follow your output format exactly:
     > Where you are · What's happening · Evidence · Done / not done · Next step.
     > Read-only — do not edit anything, and do not run tests or builds.
     > [Focus: `$ARGUMENTS`] — include this line only if an argument was passed.

2. **Relay the agent's report to the user verbatim.** Subagent reports are not shown to the user, so
   anything you summarize instead of passing through is lost. Reproduce all five sections, including
   the evidence table. Do not compress it, re-order it, or add commentary on top.

3. If the agent flags a doc that disagrees with observed state, surface that line — do not act on it.
   Fixing drift is a separate, explicit request.

## Notes

- The agent is deliberately read-only and runs only cheap checks (git, `ls`, `npx supabase migration
  list`). It never runs `npm test`, `test:e2e`, `build`, or `type-check`. If the user wants a verified
  pass/fail rather than a status read, run those yourself — that is not this command's job.
- Arguments are a focus hint, not a mode switch: `/update step 10`, `/update what's blocking 0028`.

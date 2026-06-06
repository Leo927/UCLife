---
name: clear-issues
description: Autonomously work through the GitHub issue backlog end-to-end, one issue per fresh session, with no user interruption — triage and pick the next issue, implement it on a branch, open a PR, run an in-loop code review, get CI green, auto-merge, close the issue, then re-schedule itself for the next one and stop only when no eligible issues remain. Use this whenever the user wants to "clear out all the issues", "work through the backlog unattended", "fix every open issue", "run the autonomous issue loop", "keep shipping issues until none are left", or otherwise asks for continuous hands-off issue resolution. Trigger even if they don't say "loop" or "autonomous" — any request to burn down the whole issue list without supervision belongs here.
---

# Clear issues — autonomous backlog burn-down

Resolve the GitHub issue backlog **one issue per session, unattended, until it's empty.** Each invocation handles exactly one issue from end to end — pick → branch → implement → PR → review → CI → merge → close — then re-schedules itself to start the next issue with a **fresh context**, and stops only when no eligible issue remains.

## Why one issue per invocation

Carrying ten issues' worth of diffs, review threads, and CI logs in a single context degrades judgment and bloats cost. Each issue is independent work, so each gets a clean session. The loop's *memory* lives in GitHub itself — merged PRs, closed issues, and `needs-human` labels — not in the conversation. That's what makes a summarized / cleared context safe: re-deriving "what's left" from `gh issue list` is always correct, no matter what the previous session remembered.

## Authorization & guardrails

The user has explicitly opted into full autonomy for this loop. Within it, and **only** within it, you may merge to the default branch without per-PR human approval — this overrides the general "don't merge without approval" rule in `CLAUDE.md`. Everything else in `CLAUDE.md` still binds you (TDD, config discipline, engine boundary, layered deps, delete obsoleted code, zh-CN player strings, design-doc sync).

Hard stops — if any of these is true, do **not** loop; report and halt:
- No write access / `gh auth status` fails, or no `origin` remote.
- Working tree is dirty in a way you didn't create and can't safely stash.
- A merge would target something other than the repo's default branch.

This loop runs unattended, so it needs a permission mode that won't block on every tool call. If you hit repeated permission prompts, surface that to the user once and stop — silently retrying is worse than halting.

## The single-iteration workflow

Run these steps in order. Each invocation does **one** pass.

### 1. Triage and select the next issue

List the real state from GitHub (prefer the GitHub MCP tools; `gh` CLI is a fine fallback):
- All open issues with their labels, assignees, and bodies.
- All open PRs, so you can tell which issues already have work in flight.

Filter to **eligible** issues — open, and *not*:
- labeled `needs-human`, `blocked`, `wontfix`, `duplicate`, `question`, or `discussion` (these are markers that a human or more context is required — the loop deliberately leaves them);
- already linked to an open PR (work is in flight — don't double-implement);
- assigned to a human other than the bot/you.

Among the eligible set, **triage like a senior engineer picking the highest-leverage tractable ticket.** Prefer issues that are well-specified, have clear acceptance criteria, small-to-moderate blast radius, and no unanswered design questions. Deprioritize vague "make it better" issues and anything whose scope you can't pin down from the issue + linked design docs.

**If the eligible set is empty → the backlog is clear. STOP. Do not re-schedule.** Report a summary of what this run accomplished (issues closed, PRs merged, issues left for humans and why).

### 2. Branch from a clean default

```
git checkout main && git pull --ff-only
git checkout -b claude/issue-<N>-<short-slug>
```

Use the repo's actual default branch if it isn't `main`.

### 3. Implement the issue

Read the issue in full plus any linked design docs before touching code. Then follow this repo's engineering rules exactly — they are not optional just because no human is watching:
- **TDD**: failing test first (`npm run test:unit` for pure logic; a `tests/smoke/*.spec.ts` for end-to-end behavior — load the `deterministic-tests` skill before writing any test).
- **No magic numbers** — every literal lives in a `*.json5` config.
- Respect the **engine boundary** and **layered dependency direction**; fix import direction at design time, never refactor the baseline to hide a new violation.
- **Delete** obsoleted code; no compat shims, no "deprecated" comments, no half-merged renames.
- Player-facing strings zh-CN; code/comments/commits English.
- Keep `Design/` docs in sync with shipped behavior.

If, while implementing, the issue turns out to be ambiguous, under-specified, or to need a design decision you can't responsibly make alone — don't guess and don't ship something plausible-but-wrong. Treat it as **stuck** (step 9).

### 4. Gate locally before you push

CI here does **not** type-check (the build job is skipped), so a type error will sail through PR checks and break `main`. Run the full local gate yourself:

```
tsc -b                    # type-check — CI will NOT catch this for you
npm run test:unit
npm run lint:arch
npm run lint:determinism
npm run ci:local          # smoke/e2e + survive; the real end-to-end gate
```

Everything must be green locally before the PR exists. Fixing red here is cheaper than a CI round-trip.

### 5. Commit, push, open the PR

Commit with a clear conventional message ending in the required `Co-Authored-By` trailer. Push the branch and open a PR whose body:
- starts with `Closes #<N>` (so merge auto-closes the issue),
- summarizes the change and *why*,
- includes a short test plan (what you ran, what it proves).

### 6. In-loop code review (bounded)

Spawn a fresh **`feature-dev:code-reviewer`** subagent against the PR diff (or run the `/code-review` skill). Address every high-confidence finding, commit, push, and re-review. Cap at **3 review→fix cycles**. Stop early once the reviewer reports no high-priority issues. If the reviewer keeps surfacing real, distinct, high-priority problems after 3 cycles, the change isn't converging — treat as **stuck** (step 9).

### 7. Get CI green (bounded)

Watch the PR's checks (`gh pr checks <N> --watch`, or poll the checks via MCP/`Monitor`). On failure, read the failing job's logs, fix the root cause, push, and let CI re-run. Cap at **3 CI-fix attempts**. Never merge red, and never paper over a failure by skipping or retrying a flaky test — if a test is flaky, that's a real defect per this repo's "deterministic by construction" rule. If CI won't go green within the budget, treat as **stuck** (step 9).

### 8. Merge and close

Once CI is green **and** the reviewer is clean:

```
gh pr merge <N> --squash --delete-branch
```

Confirm the issue closed (the `Closes #<N>` should auto-close it on merge to the default branch). If it didn't, close it explicitly with a comment referencing the merged PR.

### 9. Stuck handling — bounded retries exhausted, then skip

When an issue can't be cleanly resolved (ambiguous spec, needs design, or the review/CI budgets in steps 6–7 are exhausted), **don't halt the whole loop and don't merge something half-right.** Instead, leave a clean handoff and move on:
- Comment on the issue explaining the blocker and exactly what you tried.
- Add the `needs-human` label (create it if absent). This label is what keeps the *next* fresh session from re-picking this same issue — it's the loop's persistent skip-marker.
- If a PR exists, convert it to **draft** and link it from the comment so the work isn't lost. Don't close it.
- Proceed to step 10 — a skipped issue is still a completed iteration.

### 10. Reset and continue with a fresh session

Return to a clean default branch:

```
git checkout main && git pull --ff-only
```

Then re-invoke this skill for the next issue via a self-scheduled wake-up, so the next iteration starts with a fresh (summarized) context. Use `ScheduleWakeup` with a short delay and a prompt that re-triggers this skill, e.g.:

- `delaySeconds`: ~60 (just long enough to let the merge settle; stays inside the prompt-cache window).
- `prompt`: `/clear-issues` (or the exact phrasing the user used to start the loop).
- `reason`: one line naming the next action, e.g. "merged #<N>, picking next issue".

**Only schedule the wake-up if step 1 of the *next* pass could find work.** You already know the backlog state from this pass — if the issue you just handled was the last eligible one, stop instead (step 1's empty-set rule). The loop ends when, and only when, no eligible issue remains.

## Loop invariants — keep these true every iteration

- Exactly one issue advances per invocation (merged or skipped-with-handoff).
- The working tree is clean and on the default branch before you re-schedule.
- Nothing red ever merges; nothing ambiguous ever merges.
- State lives in GitHub (closed issues, merged PRs, `needs-human` labels), never in session memory — so a cleared context can always recover.
- The loop is self-terminating: no eligible issues ⇒ no wake-up scheduled.

## Quick reference — one iteration

```
triage ──▶ branch ──▶ implement (TDD) ──▶ local gate (incl. tsc -b)
   │                                              │
   └─ none eligible ⇒ STOP                        ▼
                                       PR (Closes #N) ──▶ review×≤3 ──▶ CI×≤3
                                                                          │
                          stuck? comment + needs-human + draft PR ◀──── not green / not converging
                                                                          │ green & clean
                                                                          ▼
                                                  squash-merge ──▶ close ──▶ reset ──▶ ScheduleWakeup(/clear-issues)
```

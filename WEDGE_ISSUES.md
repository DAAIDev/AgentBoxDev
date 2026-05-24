# Wedge Issue Templates

Four GitHub issues to open in **`DAAITeam/AgentBoxDev`**, one at the start of each wedge. Title + labels + body listed below; paste verbatim. Adam comments progress, Chris comments feedback. Close at the exit gate.

**Don't open all four at once** — only open the next one when the previous wedge exits.

---

## Wedge 1 — Schema + Triage worker

**Title:** `[Wedge 1] Schema + Triage worker`
**Labels:** `wedge:1`, `agent-pipeline`, `assigned:adam`, `priority:high`
**Milestone:** Self-Repair v1

**Body:**
````md
## Goal
Bugs filed via tenant CRMs get triaged by a Sonnet 4.6 agent and result in 1–2 well-specified GitHub issues with acceptance criteria + test stub committed to the work item.

## Exit gate
File a test bug from the dev tenant. Within 60s, observe:
- Row in `mcp_feedback_tasks` with `state='planned'`
- 1–2 rows in `mcp_feedback_task_issues`
- 1–2 issues opened in `DAAITeam/CRMBackend` or `DAAITeam/CRMFrontEnd` with full acceptance criteria + reproducer + test stub
- Issues carry labels `agent-eligible`, `tenant:dev`, `area:<X>`, `type:<bug|feature>`, `priority:<P>`

## Deliverables
- [ ] Apply `migrations/001_self_repair_pipeline.sql` (**Chris-only**)
- [ ] `tools/github.mjs` exporting `ghSearchCode(repo, query)` and `ghGetFile(repo, path)`
- [ ] `triage.mjs` exporting `triageFeedbackTask(taskId)` (see §3.3 of v0.3.1 build plan)
- [ ] `setImmediate(() => triageFeedbackTask(rowId))` in `server.js` after `upsertFeedbackTask()`
- [ ] Safety poller: every 60s, claim `planner_status='pending' AND created_at < NOW() - 1min`
- [ ] At least one successful end-to-end run through the dev tenant

## Reference
- Build plan §3 (triage worker code shape) + §11 (Wedge 1 exit gate)
- Triage system prompt: [prompts/triage.system.md](./prompts/triage.system.md)
- Migration: [migrations/001_self_repair_pipeline.sql](./migrations/001_self_repair_pipeline.sql)

## Out of scope
Implementer; reviewer; PR opening; GitHub Actions wiring.
````

---

## Wedge 2 — Implementer Action + manual PR

**Title:** `[Wedge 2] Implementer GitHub Action + manual PR`
**Labels:** `wedge:2`, `agent-pipeline`, `assigned:adam`, `priority:high`
**Milestone:** Self-Repair v1

**Body:**
````md
## Goal
When an issue is labeled `agent-eligible`, a GitHub Action provisions a runner, invokes Claude Code to edit code until the pre-written test passes, and pushes the agent branch. PR is opened with a stub body (reviewer comes in Wedge 3).

## Exit gate
Manually label a known test-bug issue `agent-eligible`. Within 30 min: workflow runs end-to-end, agent branch pushed, PR opened against `dev` with a valid diff that makes the acceptance test pass. Chris reviews + merges.

## Deliverables
- [ ] `.github/workflows/agent-implement.yml` in CRMBackend and CRMFrontEnd
- [ ] `./bin/setup-ci.sh` in each repo — thin headless setup (Postgres + seed + servers)
- [ ] `AgentBoxDev/prompts/implementer.system.md`
- [ ] Pre-commit guard hook that pins the test file's hash (blocks modification)
- [ ] Branch protection configured on `main` + `dev` in both CRM repos (one-time GitHub Settings)
- [ ] Agent GitHub App or PAT with write access only to `agent/*` branches
- [ ] Workflow opens PR with `gh pr create --base dev` and a stub body

## Prerequisites (resolve before starting)
- [ ] Confirm `dev` branch exists in both CRM repos; create from `main` if not
- [ ] Decide: GitHub App vs fine-grained PAT for the agent (see decisions/0001 once filed)

## Reference
- Build plan §5 (GitHub Actions runner), §6 (implementer agent), §8 (branch strategy), §11 (Wedge 2 exit gate)

## Out of scope
Reviewer agent (Wedge 3); rework loop (Wedge 4); per-tenant config.
````

---

## Wedge 3 — Reviewer Action

**Title:** `[Wedge 3] Reviewer Action (security + feature-flag + regression)`
**Labels:** `wedge:3`, `agent-pipeline`, `assigned:adam`, `priority:high`
**Milestone:** Self-Repair v1

**Body:**
````md
## Goal
Replace Chris's manual PR review with an automated three-check reviewer. Output becomes the PR body. PR only opens if all three pass.

## Exit gate
Trigger on three known test bugs: (1) one with a security issue, (2) one missing a feature flag, (3) one clean. Confirm:
- Security and flag cases produce NO PR — issue gets `state:blocked-needs-human` label + failure comment
- Clean case opens PR with full structured report and a viewable Playwright video
- Chris reads the report and confirms: does it tell him what he needs to know?

## Deliverables
- [ ] `.github/workflows/agent-review.yml` in each repo
- [ ] `AgentBoxDev/prompts/reviewer.system.md`
- [ ] Per-repo `.claude/REVIEW_RULES.md` (lists company-specific areas, fragile areas, breaking-change rules)
- [ ] Check 1: `/security-review` skill invocation
- [ ] Check 2: feature-flag gating check (static first, Sonnet for ambiguous)
- [ ] Check 3: regression + adjacent flows + additive-only check
- [ ] Structured Markdown report → PR body (replaces Wedge 2's stub)
- [ ] Playwright videos uploaded via `actions/upload-artifact`; linked from PR body
- [ ] FAIL path: `gh issue comment` + add `state:blocked-needs-human` label

## Reference
- Build plan §7 (reviewer agent — the three checks), §11 (Wedge 3 exit gate)
- Reviewer rules template in build plan §9.5

## Out of scope
Rework loop (Wedge 4); per-tenant runs.
````

---

## Wedge 4 — Rework loop + polish

**Title:** `[Wedge 4] Rework loop + polish`
**Labels:** `wedge:4`, `agent-pipeline`, `assigned:adam`, `priority:high`
**Milestone:** Self-Repair v1

**Body:**
````md
## Goal
Human-requested changes on an agent PR (or `/rework` comment on the source issue) re-fire the implementer with the feedback as a hint. Cost telemetry surfaced. Loop runs unattended.

## Exit gate
Run unattended for 48 hours. File 10 test bugs from the dev tenant. Mix of outcomes (some pass, some BLOCKED, some need rework). Zero workflow crashes. Budget burndown visible in dashboard. Chris merges the good ones; the rest sit in `blocked` with clear reasons.

## Deliverables
- [ ] `.github/workflows/agent-rework.yml` — triggered by `pull_request_review` with `state: changes_requested` OR `/rework` comment on the source issue
- [ ] Rework flow: close existing agent PR, delete agent branch, re-fire `agent-implement.yml` with `attempt+1`, carry forward reviewer feedback as a hint
- [ ] Retry: workflow rerun on transient failures, up to 3 times with exponential backoff
- [ ] Adjacent-flow smoke on by default in reviewer
- [ ] Artifacts copied to GCS for long-term retention (Actions only keeps 90d)
- [ ] Cost tracking: workflow uploads token usage + cost to `agent_runs` row at end
- [ ] Sam's dashboard views (coordinated via §10 of build plan)

## Reference
- Build plan §11 (Wedge 4 exit gate), §10 (Sam coordination)

## Out of scope
Anything not in the deliverables above. Production-grade orchestrator daemon, per-tenant seeds, auto-merge — all v1.x or later.
````

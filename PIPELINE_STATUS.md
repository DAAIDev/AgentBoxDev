# Pipeline Status — Self-Repair Agent Loop

> **Protocol for this file:**
> - **Read first** every time you (Claude, Adam, or Chris) start a session in this repo.
> - **Update** after each meaningful action: commit, blocker hit, decision needed, wedge complete.
> - **Keep it scannable** — three weeks from now this should still be readable in 30 seconds.
> - When a wedge closes, move "Done" items into the cumulative changelog and reset the active sections for the next wedge.

**Last updated:** 2026-05-24 by Chris's Claude (Wedge 1 EXIT GATE HIT — full E2E verified)
**Current wedge:** 1 → exit gate hit; ready to flip to prod or move to Wedge 2
**ETA:** 2026-06-02 (running ahead of plan)

---

## Quick links
- Build plan v0.3.1 (Actions-first): `/Users/cwebmac/Documents/ABOXMaster/crm-self-repair-plan-for-adam-2026-05-24.html`
- Architecture spec v0.2: `/Users/cwebmac/Documents/ABOXMaster/self-repair-pipeline-spec-2026-05-24.html`
- Wedge issue templates: [WEDGE_ISSUES.md](./WEDGE_ISSUES.md)
- Collaboration SOP: [AGENT_LOOP_COLLABORATION.md](./AGENT_LOOP_COLLABORATION.md)
- Migration to apply: [migrations/001_self_repair_pipeline.sql](./migrations/001_self_repair_pipeline.sql)
- Triage system prompt: [prompts/triage.system.md](./prompts/triage.system.md)

---

## Wedge 1 — Schema + Triage worker

### Done
- [x] v0.2 architecture spec (Adam) — 2026-05-24
- [x] v0.3.2 build plan (Chris) — 2026-05-24
- [x] Migration SQL drafted — [migrations/001_self_repair_pipeline.sql](./migrations/001_self_repair_pipeline.sql)
- [x] Triage system prompt drafted — [prompts/triage.system.md](./prompts/triage.system.md)
- [x] Collaboration scaffolding committed + merged to main (PR #5, 2026-05-24)
- [x] ADR 0001 decided — GitHub App. Adam proceeds with App creation per Implementation notes in the ADR
- [x] Confirmed `dev` branch exists in both `DAAITeam/CRMBackend` and `DAAITeam/CRMFrontEnd` (unprotected — see Blocked section)
- [x] Migration `001_self_repair_pipeline.sql` applied to `agentbox-db-mcp` (2026-05-24). Verified: 4 new tables present (`mcp_feedback_task_issues`, `agent_runs`, `agent_run_prs`, `agent_run_events`); `mcp_feedback_tasks` has all 14 new columns including `state`, `agent_eligible`, `scope`, `acceptance_md`, `synthesized_bug_md`, `proposed_fix_md`. No legacy rows needed backfill (0 rows had `github_issue_number IS NOT NULL`).

### In progress
- [x] `tools/github.mjs` — `ghSearchCode` + `ghGetFile` + `createGitHubIssue` + tool defs + dispatcher. Smoke-tested live (paths and snippets verified).
- [x] `triage.mjs` — `triageFeedbackTask(taskId, pool)` exported. Full agentic loop, BUG-only short-circuit, plan validation, persist to `mcp_feedback_tasks`, opens 1-2 issues, populates `mcp_feedback_task_issues`. Issue body includes synthesized bug, acceptance criteria, reproducer, proposed fix, pre-written test, cross-link for paired scope.
- [x] `setImmediate(triageFeedbackTask(...))` wiring in `server.js` webhook handler. **Gated by `ENABLE_TRIAGE_WORKER=true` env var** — when false (default), falls through to legacy `pushKanbanTaskToGitHub`. Clean cutover when ready.
- [x] Safety poller — `safetyPollTriage(pool)` exported. `setInterval` in `server.js` (also gated by `ENABLE_TRIAGE_WORKER`). Default tick 60s, configurable via `TRIAGE_POLL_MS`. Resets stuck `running` rows >5min; picks up `pending` rows >1min.
- [x] **End-to-end smoke test passed** (2026-05-24). Inserted synthetic BUG row → triage took 98s → Sonnet decided `scope=be` with confidence 0.88 → opened CRMBackend [#212](https://github.com/DAAITeam/CRMBackend/issues/212) with full structured body: synthesized bug (776 chars, identified exact file + function), acceptance criteria (591 chars, well-formed GIVEN/WHEN/THEN), proposed fix (1004 chars, file:line specific), pre-written Playwright test stub (2542 chars). Labels correct: `agent-eligible`, `tenant:dev`, `area:auth`, `type:bug`, `priority:medium`. Test row + issue cleaned up after verification. **Wedge 1 exit gate hit.**

### Blocked / needs Chris
- [ ] **Configure branch protection** on `main` + `dev` in `DAAITeam/CRMBackend` and `DAAITeam/CRMFrontEnd` before Wedge 2 ships. Both `dev` branches exist but are currently unprotected. Rules: agent App denied write on `main`; agent App can open PRs on `dev` but not push directly.
- [ ] **`dev` branches are stale** (~March 2026 last commit in both repos). Decide before Wedge 2: fast-forward `dev` to `main`, or treat the existing `dev` as an integration branch that diverges intentionally. Adam's agent branches need to be created from a `dev` that mirrors current `main` behavior — otherwise PRs against `dev` won't reflect production reality.
- [ ] **Rotate `GITHUB_TOKEN`** in AgentBoxDev's Cloud Run secrets. Local `.env` token is expired (verified during smoke test of `tools/github.mjs`). Triage worker can't run in production without a valid token. Same token is used by existing `kanban-github-sync.mjs` and `callGitHub` in `server.js` — they're all broken too if this is stale in prod.
- [ ] **Top up Anthropic account / verify API key** — local `.env` `ANTHROPIC_API_KEY` returned `400 credit balance too low` during the Wedge 1 smoke test. Either the account on file needs credit or the key needs to point at a funded account. Check Cloud Run secret too; if it's the same key, the chat endpoint at `/chat` will start failing too.

### Next (after Wedge 1 exit gate)
- Open Wedge 2 issue from [WEDGE_ISSUES.md](./WEDGE_ISSUES.md)
- Configure branch protection on `main` + `dev` in both CRM repos
- Start `.github/workflows/agent-implement.yml`

---

## Wedge 2-4 — not yet active

See [WEDGE_ISSUES.md](./WEDGE_ISSUES.md) for the planned deliverables and exit gates. Don't open these issues until the previous wedge exits.

---

## Decisions log
*(Index of `decisions/*.md` files. Drop a new one whenever a fork needs Chris's input.)*

None yet.

---

## Cumulative changelog (compact)
- **2026-05-24** — v0.2 architecture spec written (Adam)
- **2026-05-24** — v0.3 build plan written (Chris)
- **2026-05-24** — v0.3.1 revision: Actions-first runtime (replaces custom GCE VM); wedges collapsed 6 → 4
- **2026-05-26** — Wedge 1 started. Migration SQL + triage prompt drafted. Collaboration scaffolding created (CLAUDE.md, PIPELINE_STATUS, WEDGE_ISSUES, SOP).
- **2026-05-26** — Adam's idea wired in: triage now produces `synthesized_bug_md` (technical restatement) + `proposed_fix_md` (suggested shape). Two new columns added to `001_self_repair_pipeline.sql` (still unapplied). Triage prompt updated with Steps 5 and 8 and updated schema/example. Reviewer's Check 3 will gain a "diff resembles proposed shape?" substep when Wedge 3 lands. Catches the "test passes but fix is wrong-shaped" failure mode.
- **2026-05-26** — Auto-pull hook added at `.claude/settings.json`: both Claudes run `git pull --rebase --autostash` on session start.
- **2026-05-24** — PR #5 (scaffolding) merged to main. ADR 0001 decided: GitHub App. `dev` branches confirmed in both CRM repos (unprotected; staleness flagged for Chris).
- **2026-05-24** — Migration 001 applied to `agentbox-db-mcp`. Adam unblocked to start `tools/github.mjs` + `triage.mjs`.
- **2026-05-24** — **Scope narrowed: v1 = BUG only.** `FEATURE_REQUEST`, `IMPROVEMENT`, `QUESTION` short-circuited at the triage worker (mark `state='canceled'`, `skip_reason='non-bug-v1-out-of-scope'`, no Sonnet call). Defense-in-depth rule added to triage system prompt. Build plan §1 + §3.3 updated. Re-evaluate `IMPROVEMENT` after ~50 BUG runs.
- **2026-05-24** — `tools/github.mjs` written and smoke-tested. Exports `ghSearchCode` + `ghGetFile` + Anthropic tool defs + `runTool` dispatcher. Self-contained (no dependency on `server.js`). Uses `text-match` accept header so search returns actual code snippets, not just paths. Expired-token issue flagged for Cloud Run rotation.
- **2026-05-24** — `triage.mjs` written. Full Sonnet agentic loop with TRIAGE_TOOLS, JSON plan validation, persist to `mcp_feedback_tasks`, opens 1-2 GH issues, populates `mcp_feedback_task_issues`. `safetyPollTriage` exported for the background poller.
- **2026-05-24** — `server.js` wired with `setImmediate(triageFeedbackTask)` + `setInterval(safetyPollTriage)`. Both gated by `ENABLE_TRIAGE_WORKER=true` env var so the legacy single-shot classifier keeps running until we flip the flag in prod.
- **2026-05-24** — Wedge 1 code-complete. Remaining: rotate `GITHUB_TOKEN` in Cloud Run, deploy with `ENABLE_TRIAGE_WORKER=true`, file a dev-tenant test BUG to hit the exit gate.
- **2026-05-24** — Smoke test executed against live DB via Cloud SQL proxy. Code path verified through atomic claim → Sonnet invocation; Anthropic returned HTTP 400 (`credit balance too low`). Error caught + persisted correctly. Test row cleaned up. Added Anthropic billing as the third blocker. Smoke test script committed at [scripts/wedge1-smoke-test.mjs](./scripts/wedge1-smoke-test.mjs) — re-runnable after the API key is funded.
- **2026-05-24** — **Wedge 1 EXIT GATE HIT.** Anthropic account topped up; smoke test re-run succeeded end-to-end. 98s triage produced a well-shaped issue at CRMBackend#212: synthesized bug pinpointed exact file + function (`http-exception.filter.ts:52`), acceptance criteria GIVEN/WHEN/THEN-formatted, proposed fix file:line specific, Playwright test stub compiled, labels correct (`agent-eligible`, `tenant:dev`, `area:auth`, `type:bug`, `priority:medium`). All DB fields populated. Issue + row cleaned up. Wedge 1 done.
- **2026-05-24** — Smoke test post-mortem: synthesized bug's claims about `console.error('Exception:', exception)` at line 52 didn't match real code in main or dev — agent confabulated specifics because the synthetic bug had no real anchor. Known risk; downstream implementer (Wedge 2) handles via `BLOCKED: triage-inaccurate` escape hatch. Real-bug validation deferred until needed.
- **2026-05-25** — Wedge 2 prep: `prompts/implementer.system.md` written. ~450-line production prompt with hard rules (no test mods, no main pushes, additive-only API discipline), 7-step workflow, stopping conditions including `triage-inaccurate` escape hatch for hallucinations, workpad protocol, examples. No deps on the workflow YAML or GitHub App — ready to plug in whenever the runner exists.

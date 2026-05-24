# Pipeline Status — Self-Repair Agent Loop

> **Protocol for this file:**
> - **Read first** every time you (Claude, Adam, or Chris) start a session in this repo.
> - **Update** after each meaningful action: commit, blocker hit, decision needed, wedge complete.
> - **Keep it scannable** — three weeks from now this should still be readable in 30 seconds.
> - When a wedge closes, move "Done" items into the cumulative changelog and reset the active sections for the next wedge.

**Last updated:** 2026-05-24 by Chris's Claude (scaffolding merged to main; ADR 0001 decided)
**Current wedge:** 1 — Schema + Triage worker (~1 week)
**ETA:** 2026-06-02

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

### In progress
*(Adam fills this as he starts work)*
- [ ] `tools/github.mjs` — `gh_search_code` + `gh_get_file` wrappers
- [ ] `triage.mjs` — the worker function (see §3.3 of build plan for shape)
- [ ] `setImmediate(triageFeedbackTask(...))` wiring in `server.js` webhook handler
- [ ] Safety poller (60s tick, claims pending rows older than 1 min)

### Blocked / needs Chris
- [ ] **Apply migration `001_self_repair_pipeline.sql`** — Chris-only per project policy. Command: `psql $DATABASE_URL -f migrations/001_self_repair_pipeline.sql`. Idempotent; safe to dry-run inside `BEGIN; ... ROLLBACK;` first if paranoid.
- [ ] **Configure branch protection** on `main` + `dev` in `DAAITeam/CRMBackend` and `DAAITeam/CRMFrontEnd` before Wedge 2 ships. Both `dev` branches exist but are currently unprotected. Rules: agent App denied write on `main`; agent App can open PRs on `dev` but not push directly.
- [ ] **`dev` branches are stale** (~March 2026 last commit in both repos). Decide before Wedge 2: fast-forward `dev` to `main`, or treat the existing `dev` as an integration branch that diverges intentionally. Adam's agent branches need to be created from a `dev` that mirrors current `main` behavior — otherwise PRs against `dev` won't reflect production reality.

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

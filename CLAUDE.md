# AgentBoxDev — Claude instructions

This file is auto-loaded by Claude Code into every session running in this repo. It applies to Adam's Claude and Chris's Claude equally.

## Read these at the start of every session

1. [PIPELINE_STATUS.md](./PIPELINE_STATUS.md) — live build state. Read this first, every time.
2. [AGENT_LOOP_COLLABORATION.md](./AGENT_LOOP_COLLABORATION.md) — the team SOP. Skim if you haven't seen it.

## What this repo is

`AgentBoxDev` is the MCP server + intake webhook + (soon) triage worker for the CRM self-repair pipeline. The pipeline takes tenant-reported bugs from `mcp_feedback_tasks`, triages them with an LLM, decomposes them into 1–2 GitHub issues, then (via GitHub Actions in CRMBackend/CRMFrontEnd) implements and reviews them, opening PRs against `dev`.

See the build plan: `/Users/cwebmac/Documents/ABOXMaster/crm-self-repair-plan-for-adam-2026-05-24.html` (v0.3.1, Actions-first).

## Protocol while working in this repo

1. **Before starting work**: read PIPELINE_STATUS.md to see the current wedge, what's in progress, what's blocked.
2. **After meaningful actions** (commits, blockers, decisions, wedge step completions): update PIPELINE_STATUS.md. One-liner is fine. The point is keeping the file truthful, not eloquent.
3. **When you hit a fork that needs a human decision**: don't guess. Drop a `decisions/NNNN-short-title.md` per the template in AGENT_LOOP_COLLABORATION.md, then comment the path on the active wedge issue in GitHub.
4. **End of session**: if anything happened that the other person should know about, comment on the active wedge issue.

## Hard rules for this repo

- **Never run migrations.** Chris-only per project policy. Write the migration file; ask Chris to apply.
- **Never push to `main` or `dev`** in any repo. Branch-and-PR only.
- **Never amend or force-push** without explicit ask.
- **Triage worker prompts**: edits to `prompts/triage.system.md` (or any prompt file) are config changes — call them out explicitly in PIPELINE_STATUS.md and the wedge issue.

## Where to find things

| What | Where |
|---|---|
| Live build state | [PIPELINE_STATUS.md](./PIPELINE_STATUS.md) |
| Team SOP | [AGENT_LOOP_COLLABORATION.md](./AGENT_LOOP_COLLABORATION.md) |
| Wedge issue templates | [WEDGE_ISSUES.md](./WEDGE_ISSUES.md) |
| Schema migrations | [migrations/](./migrations/) |
| Agent prompts | [prompts/](./prompts/) |
| ADR-style decisions | `decisions/` (created on first decision) |
| Architecture spec | `/Users/cwebmac/Documents/ABOXMaster/self-repair-pipeline-spec-2026-05-24.html` (v0.2, Adam) |
| Build plan | `/Users/cwebmac/Documents/ABOXMaster/crm-self-repair-plan-for-adam-2026-05-24.html` (v0.3.1, Chris) |

# Wedge 2-3 drafts (paste-ready into CRMBackend / CRMFrontEnd)

These files live in `AgentBoxDev` as drafts but ultimately belong inside the two CRM repos. They aren't active until:

1. ADR 0001's GitHub App (`boxai-self-repair-agent`) exists with `AGENT_GH_APP_ID` + `AGENT_GH_APP_PRIVATE_KEY` set as Actions secrets in each repo
2. `dev` branch protection is configured per the build plan §8.2
3. Each CRM repo has its own `bin/setup-ci.sh` (template here) and `.claude/REVIEW_RULES.md` (Wedge 3)

## What goes where

| Draft here | Target location in CRMBackend / CRMFrontEnd |
|---|---|
| `agent-implement.yml` | `.github/workflows/agent-implement.yml` |
| `agent-review.yml` | `.github/workflows/agent-review.yml` |
| `setup-ci.sh.template` | `bin/setup-ci.sh` (adapt per repo) |
| `agent-runner.mjs` | `scripts/agent-runner.mjs` (the actual orchestration logic) |

## Why drafts here instead of direct PRs to CRMBackend / CRMFrontEnd

- Until the GitHub App exists, the workflows would error on push (`AGENT_GH_APP_ID` undefined) and break CI for every other PR
- The setup-ci.sh template needs adaptation per repo (NestJS vs Next.js bring-up differ)
- Easier to iterate on the wiring here and copy once when everything's ready

## How Adam (or future-Chris) ships these

1. Knock out the three Wedge 2 prereqs (GitHub App, branch protection, dev branch decision)
2. Adapt `setup-ci.sh.template` for each repo
3. Copy the four files to each CRM repo as PR(s)
4. Update `prompts/triage.system.md` references — the triage prompt's reproducer field assumes `./bin/setup-ci.sh` exists
5. File a dev-tenant BUG and watch the loop fire

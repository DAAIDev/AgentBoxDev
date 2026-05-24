# 0001 — Agent GitHub identity

**Status:** Open
**Date opened:** 2026-05-26
**Decided by:** Chris
**Date decided:** *(filled in with Decision)*

## Context

The agent loop (Wedges 2–4) needs a GitHub identity to:
- Push to `agent/*` branches in `DAAITeam/CRMBackend` and `DAAITeam/CRMFrontEnd`
- Open PRs against `dev`
- Comment on issues and add/remove labels
- Be enforceable via branch protection (denied write access to `main` + `dev`)

Three plausible identities. Picking one before Wedge 2 starts so the workflow's auth secret is in place when `agent-implement.yml` lands.

The non-obvious wrinkle: when a workflow uses the default `GITHUB_TOKEN` to push a branch, that push **does not trigger** other workflows listening on `push` events. So if `agent-implement.yml` pushes the agent branch and we expect `agent-review.yml` to fire on that push, `GITHUB_TOKEN` won't cut it — we need an identity whose pushes do trigger downstream workflows.

## Options

### A) Dedicated GitHub App (org-installed)

- **Pros**
  - Tightest scoping: install on only the two repos, grant only the permissions needed
  - Tokens auto-expire (1 hour) — leaks have a short blast radius
  - Tied to the org, not a person; no orphan risk when team members leave
  - Native GitHub primitive; auditable in org settings
  - Pushes from app installations **do** trigger downstream workflows
- **Cons**
  - ~1–2 hours of one-time setup (create app, generate private key, install on org, store key as Actions secret, generate installation tokens at workflow runtime via JWT)
  - JWT-exchange dance is more code than `${{ secrets.PAT }}`

### B) Fine-grained PAT (on a service account or Chris's account)

- **Pros**
  - 5-minute setup: create PAT in GitHub UI, drop into Actions secrets as `AGENT_GH_TOKEN`
  - Direct use in workflows: `gh auth login --with-token < ${{ secrets.AGENT_GH_TOKEN }}` or pass to `GH_TOKEN` env
  - Fine-grained PATs scope per-repo + per-permission — almost as tight as an App
  - Pushes from PATs **do** trigger downstream workflows
- **Cons**
  - PATs expire (max 1 year for fine-grained); silent expiration breaks the loop with no warning
  - If on a personal account: tied to that person; risk when they leave
  - If on a service account: GitHub doesn't have first-class service accounts; you'd be sharing a "bot" user's password/2FA setup

### C) Default `GITHUB_TOKEN` (the workflow's built-in token)

- **Pros**
  - Zero setup; auto-injected into every workflow run
  - Auto-expires at end of run
- **Cons**
  - **Pushes from `GITHUB_TOKEN` do NOT trigger downstream workflows** — this kills the agent-implement → agent-review handoff design
  - Scoped to the workflow's repo only; can't cross-repo (a problem if we ever want the orchestrator centralized in AgentBoxDev)
  - Would force a workaround like `workflow_dispatch` from `agent-implement` to invoke `agent-review` directly, adding coupling

## Recommendation

**Option A — dedicated GitHub App.** Reasons:

1. **Cascade works**: app-installation pushes fire downstream workflows, which the agent-implement → agent-review handoff relies on. Option C is out for this reason alone.
2. **No expiration surprise**: PATs silently break at 90d/1y; the loop would stop and no one would notice until the next bug came in. Apps don't expire.
3. **Org-managed**: if Adam leaves, the App doesn't go with him. PATs on a personal account would need to be reissued.
4. **One-time cost**: 1–2 hours of setup vs years of operation. Worth it.

The 5-minute PAT setup is tempting for Wedge 2 specifically (we just want to ship). If Chris wants the velocity, **Option B is acceptable as a temporary stopgap** — write a sticky note to migrate to App before the PAT expires. But the cleanest call is to do App upfront.

## Decision

*(Chris fills this in: which option + one-sentence why)*

---

## Implementation notes (relevant after Decision is made)

**If Option A:**
- App name: `boxai-self-repair-agent`
- Permissions: Contents (read+write on `agent/*`), Pull requests (write), Issues (write), Metadata (read), Workflows (read)
- Repos: `DAAITeam/CRMBackend`, `DAAITeam/CRMFrontEnd`
- Private key stored as `AGENT_GH_APP_PRIVATE_KEY` secret in each repo's Actions secrets
- App ID stored as `AGENT_GH_APP_ID` secret
- Workflow uses [`actions/create-github-app-token`](https://github.com/actions/create-github-app-token) to mint an installation token per run

**If Option B:**
- Create fine-grained PAT on a dedicated bot user (`daai-agent-bot` or similar)
- Scope: `DAAITeam/CRMBackend` + `DAAITeam/CRMFrontEnd` only
- Permissions: Contents (read+write), Pull requests (write), Issues (write)
- Set expiration to max (1 year); add calendar reminder for rotation 60 days before expiry
- Store as `AGENT_GH_TOKEN` in each repo's Actions secrets

**Either way:**
- Branch protection on `main` denies the agent identity write access (belt-and-suspenders alongside in-workflow rules)
- Branch protection on `dev` allows the agent identity to *open* PRs but not push directly

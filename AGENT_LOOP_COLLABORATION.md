# Agent Loop — Team Collaboration SOP

How Chris, Adam, and Sam collaborate while building the CRM self-repair pipeline (Wedges 1–4, ~4 weeks). Bias toward async, lightweight, git-tracked communication. Avoid Slack-threading important decisions; everything that matters lives in the repo.

---

## People

| Role | Person | Owns |
|---|---|---|
| Architect / decider | Chris | Decisions, migration application, PR review (build phase), dev→main promotion, final picks on forks |
| Builder | Adam | All deliverables in Wedges 1–4. Drafts code, writes prompts, opens PRs. Surfaces blockers and forks to Chris. |
| UI integrator | Sam | Dashboard views in AgentBoxDashboard (parallel work, see build plan §10). Coordinates with Adam on data shape. |

---

## Daily flow

### Adam (or Adam's Claude)
1. **Start of session:** read [PIPELINE_STATUS.md](./PIPELINE_STATUS.md). Always.
2. Work the active wedge per the [build plan](/Users/cwebmac/Documents/ABOXMaster/crm-self-repair-plan-for-adam-2026-05-24.html).
3. **After each meaningful action** (commit, blocker, test pass, decision needed), update PIPELINE_STATUS.md. One-liner is fine.
4. **Hit a fork that needs Chris?** Drop a `decisions/NNNN-short-title.md` (see template below). Comment the file path on the wedge issue.
5. **End of session:** if there's anything Chris should see, comment on the active wedge issue.

### Chris
1. Check the active wedge issue + PIPELINE_STATUS.md once a day (or whenever).
2. Answer questions in issue comments. Pick decisions in the decision file's "Decision" section, then commit.
3. Apply migrations as Adam writes them.
4. **Build-phase PRs** (Adam's manual code): normal review.
5. **Agent-generated PRs** (post-Wedge 3): trust the reviewer report; spot-check the diff and video.

### Sam
1. Once Wedge 1 ships, the schema is stable — start building dashboard views (`agent_runs`, `mcp_feedback_task_issues`, etc.).
2. Coordinate with Adam in issue comments if data-shape questions come up.
3. Don't block on Adam; he doesn't block on you.

---

## PIPELINE_STATUS.md update protocol

Sections to keep current per wedge:

| Section | What goes here |
|---|---|
| **Done** | Completed items, check off as they ship |
| **In progress** | What's actively being worked right now |
| **Blocked / needs Chris** | Anything Adam can't move forward without input — Chris reads this first |
| **Next** | Preview of upcoming work in this wedge |

**When a wedge closes:** move "Done" items into the cumulative changelog at the bottom; reset the four active sections for the new wedge.

**Update frequency:** after meaningful actions, not every keystroke. A meaningful action is:
- A commit that pushes forward a deliverable
- A blocker hit
- A decision needed
- A wedge step completed

---

## Wedge issues (one per wedge)

- Open from [WEDGE_ISSUES.md](./WEDGE_ISSUES.md) templates as each wedge starts. **Don't open all four at once.**
- Adam comments progress. Chris comments feedback. Close at exit gate.
- Keep `PIPELINE_STATUS.md` in sync — the issue is for back-and-forth, the file is for live state.

---

## Decisions (ADR pattern)

When a fork needs a real decision (not a one-line answer), use the lightweight ADR pattern. Lives in `AgentBoxDev/decisions/`.

**Filename:** `NNNN-short-title.md` (4-digit serial, kebab-case title)
e.g. `0001-agent-github-identity.md`

**Template:**
```md
# 0001 — Short title

**Status:** Open | Decided | Superseded
**Date opened:** YYYY-MM-DD
**Decided by:** Chris
**Date decided:** *(filled in when Decision section is completed)*

## Context
One paragraph — why is this decision needed, what triggered it.

## Options
### A) <name>
- Pros:
- Cons:

### B) <name>
- Pros:
- Cons:

### C) <name> *(optional)*

## Recommendation
Adam's recommendation, one paragraph.

## Decision
*(Chris fills this in: which option + one-sentence why)*
```

**Flow:**
1. Adam writes the file, status = `Open`
2. Adam comments the path on the active wedge issue
3. Chris reads, fills "Decision" section, commits, status → `Decided`
4. PIPELINE_STATUS.md decision log gets a one-liner

---

## Claude on both sides

Both Adam's Claude (running locally for Adam) and Chris's Claude (running locally for Chris) auto-load [CLAUDE.md](./CLAUDE.md) from this repo's root. That file tells both:

- Read PIPELINE_STATUS.md at the start of every session
- Update PIPELINE_STATUS.md after meaningful actions
- Use wedge issues for back-and-forth
- Use the `decisions/` folder for forks

This means you can hand a fresh Claude session this repo and it'll pick up exactly where the last session left off — no re-briefing needed.

---

## What this isn't

- **Not a project-management tool replacement.** Sam's PM UI in AgentBoxDashboard does that. This is the engineering-side build journal.
- **Not for tracking customer-reported bugs.** Those live in `mcp_feedback_tasks`. This file is about *building the pipeline*, not about *what the pipeline processes*.
- **Not a substitute for code review.** PRs still get reviewed via the normal flow.

---

## When in doubt

- Smaller updates more often beats one giant end-of-day dump.
- If you're not sure whether to update PIPELINE_STATUS.md, update it. It's cheap.
- If you're not sure whether something rises to a "decision" worth a `decisions/` file: if you spent more than 10 minutes thinking about it, write it down.

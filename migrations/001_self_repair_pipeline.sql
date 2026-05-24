-- ============================================================================
-- Migration: 001_self_repair_pipeline.sql
-- Purpose:   Enable the CRM self-repair agent loop (Wedge 1).
--            Extends mcp_feedback_tasks with a state machine + planner output.
--            Adds projected-issues, agent-runs, run-prs, and run-events tables.
--
-- Reference: crm-self-repair-plan-for-adam-2026-05-24.html (Chris, v0.3.1)
--            self-repair-pipeline-spec-2026-05-24.html      (Adam, v0.2)
--
-- Author:    Adam
-- Applied by: Chris (per project policy — Adam does not run migrations)
-- Idempotent: yes (uses IF NOT EXISTS / DEFAULTs); safe to re-run
-- ============================================================================

BEGIN;

-- ============================================================
-- Part 1 — Extend mcp_feedback_tasks
--   State machine + planner output columns.
--   Existing columns (github_issue_*, classifier_*) are preserved
--   but treated as deprecated; new code should read from the new
--   columns and the mcp_feedback_task_issues child table.
-- ============================================================

ALTER TABLE mcp_feedback_tasks
  ADD COLUMN IF NOT EXISTS state                TEXT NOT NULL DEFAULT 'planning'
       CHECK (state IN ('planning', 'planned', 'running', 'retry_queued',
                        'in_review', 'rework', 'blocked', 'done', 'canceled')),
  ADD COLUMN IF NOT EXISTS agent_eligible       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS planner_status       TEXT NOT NULL DEFAULT 'pending'
       CHECK (planner_status IN ('pending', 'running', 'opened', 'skipped', 'failed')),
  ADD COLUMN IF NOT EXISTS planner_started_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS planner_finished_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS planner_error        TEXT,
  ADD COLUMN IF NOT EXISTS planner_decision     TEXT
       CHECK (planner_decision IS NULL OR planner_decision IN ('fe', 'be', 'both', 'skip')),
  ADD COLUMN IF NOT EXISTS planner_confidence   NUMERIC(3,2)
       CHECK (planner_confidence IS NULL OR (planner_confidence >= 0 AND planner_confidence <= 1)),
  ADD COLUMN IF NOT EXISTS planner_summary      TEXT,
  ADD COLUMN IF NOT EXISTS scope                TEXT
       CHECK (scope IS NULL OR scope IN ('fe', 'be', 'both')),
  ADD COLUMN IF NOT EXISTS acceptance_md        TEXT,
  ADD COLUMN IF NOT EXISTS reproducer_md        TEXT,
  ADD COLUMN IF NOT EXISTS test_stub_md         TEXT,
  ADD COLUMN IF NOT EXISTS synthesized_bug_md   TEXT,
  ADD COLUMN IF NOT EXISTS proposed_fix_md      TEXT,
  ADD COLUMN IF NOT EXISTS skip_reason          TEXT;

CREATE INDEX IF NOT EXISTS idx_mcp_feedback_tasks_state
  ON mcp_feedback_tasks(state);

-- Partial index — only rows the triage worker actually needs to scan.
CREATE INDEX IF NOT EXISTS idx_mcp_feedback_tasks_planner_pending
  ON mcp_feedback_tasks(created_at)
  WHERE planner_status IN ('pending', 'running');

CREATE INDEX IF NOT EXISTS idx_mcp_feedback_tasks_agent_eligible
  ON mcp_feedback_tasks(state, agent_eligible)
  WHERE agent_eligible = true;


-- ============================================================
-- Part 2 — mcp_feedback_task_issues
--   1..N rows per work item (1 for fe/be scope, 2 for both).
--   Replaces the singular github_issue_* columns on the parent
--   table (those are now deprecated but still populated with the
--   primary projection for backwards compat).
-- ============================================================

CREATE TABLE IF NOT EXISTS mcp_feedback_task_issues (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_task_id  UUID NOT NULL REFERENCES mcp_feedback_tasks(id) ON DELETE CASCADE,
  repo              TEXT NOT NULL CHECK (repo IN ('CRMBackend', 'CRMFrontEnd')),
  issue_number      INT  NOT NULL,
  issue_url         TEXT NOT NULL,
  sync_status       TEXT NOT NULL DEFAULT 'synced'
                     CHECK (sync_status IN ('pending', 'synced', 'failed', 'closed')),
  closed_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (feedback_task_id, repo),
  UNIQUE (repo, issue_number)
);

CREATE INDEX IF NOT EXISTS idx_mcp_feedback_task_issues_task
  ON mcp_feedback_task_issues(feedback_task_id);

CREATE INDEX IF NOT EXISTS idx_mcp_feedback_task_issues_repo_status
  ON mcp_feedback_task_issues(repo, sync_status);


-- ============================================================
-- Part 3 — agent_runs
--   One row per implementation attempt for a work item.
--   Attempts are numbered; (feedback_task_id, attempt) is unique.
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_runs (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_task_id       UUID NOT NULL REFERENCES mcp_feedback_tasks(id) ON DELETE CASCADE,
  attempt                INT  NOT NULL DEFAULT 1,
  tenant                 TEXT NOT NULL,
  scope                  TEXT NOT NULL CHECK (scope IN ('fe', 'be', 'both')),
  state                  TEXT NOT NULL DEFAULT 'queued'
                          CHECK (state IN ('queued', 'running', 'retry_queued', 'blocked',
                                           'in_review', 'rework', 'done', 'canceled')),

  -- GitHub Actions linkage (v0.3.1 Actions-first)
  github_run_id          BIGINT,                     -- GH Actions run id
  github_workflow        TEXT,                       -- 'agent-implement.yml' | 'agent-review.yml'
  artifact_root          TEXT,                       -- gs:// or actions/upload-artifact ref

  workpad_comment_ids    JSONB,                      -- { CRMBackend: 123, CRMFrontEnd: 456 }

  -- Timing
  implementer_started_at TIMESTAMPTZ,
  implementer_ended_at   TIMESTAMPTZ,
  implementer_verdict    TEXT
                          CHECK (implementer_verdict IS NULL OR
                                 implementer_verdict IN ('success', 'failed', 'blocked', 'timed_out')),
  reviewer_started_at    TIMESTAMPTZ,
  reviewer_ended_at      TIMESTAMPTZ,
  reviewer_verdict       TEXT
                          CHECK (reviewer_verdict IS NULL OR
                                 reviewer_verdict IN ('pass', 'fail')),

  -- Terminal state
  terminal_reason        TEXT,
  failure_summary        TEXT,

  -- Heartbeat / last event
  last_event             TEXT,
  last_event_at          TIMESTAMPTZ,

  -- Cost telemetry
  token_input            INT DEFAULT 0,
  token_output           INT DEFAULT 0,
  token_cached_read      INT DEFAULT 0,
  cost_estimate_usd      NUMERIC(10,4) DEFAULT 0,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (feedback_task_id, attempt)
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_state         ON agent_runs(state);
CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant_state  ON agent_runs(tenant, state);
CREATE INDEX IF NOT EXISTS idx_agent_runs_task          ON agent_runs(feedback_task_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_workflow      ON agent_runs(github_workflow, state);

-- Keep updated_at fresh on row updates.
CREATE OR REPLACE FUNCTION trigger_agent_runs_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_runs_updated_at ON agent_runs;
CREATE TRIGGER agent_runs_updated_at
  BEFORE UPDATE ON agent_runs
  FOR EACH ROW
  EXECUTE FUNCTION trigger_agent_runs_updated_at();


-- ============================================================
-- Part 4 — agent_run_prs
--   1..N PRs per attempt (one per in-scope repo).
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_run_prs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  repo         TEXT NOT NULL CHECK (repo IN ('CRMBackend', 'CRMFrontEnd')),
  branch       TEXT NOT NULL,
  pr_number    INT,
  pr_url       TEXT,
  pr_state     TEXT
                CHECK (pr_state IS NULL OR
                       pr_state IN ('open', 'merged', 'closed', 'draft')),
  opened_at    TIMESTAMPTZ,
  merged_at    TIMESTAMPTZ,
  closed_at    TIMESTAMPTZ,
  UNIQUE (run_id, repo),
  UNIQUE (repo, pr_number)
);

CREATE INDEX IF NOT EXISTS idx_agent_run_prs_state ON agent_run_prs(pr_state);
CREATE INDEX IF NOT EXISTS idx_agent_run_prs_run   ON agent_run_prs(run_id);


-- ============================================================
-- Part 5 — agent_run_events
--   Append-only event log. Sam's dashboard reads this for live
--   activity views; the orchestrator reads it for stall detection.
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_run_events (
  id           BIGSERIAL PRIMARY KEY,
  run_id       UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL,
  level        TEXT NOT NULL DEFAULT 'info'
                CHECK (level IN ('debug', 'info', 'warn', 'error')),
  message      TEXT NOT NULL,
  payload      JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_run_events_run
  ON agent_run_events(run_id, created_at);


-- ============================================================
-- Part 6 — Backfill state for legacy rows
--   Rows that pre-date the self-repair pipeline default to
--   state='planning'. Rows that already had a GH issue opened
--   by the old single-shot classifier are advanced to 'planned'
--   so the new triage worker does not re-process them.
--   agent_eligible stays false on legacy rows — they only get
--   agent-handled if a human explicitly re-labels.
-- ============================================================

UPDATE mcp_feedback_tasks
   SET state          = 'planned',
       planner_status = 'opened',
       agent_eligible = FALSE
 WHERE state = 'planning'
   AND github_issue_number IS NOT NULL;


-- ============================================================
-- Backfill the new child table from legacy singular columns.
-- Lets Sam's UI read uniformly from mcp_feedback_task_issues
-- without needing to fall back to the deprecated columns.
-- ============================================================

INSERT INTO mcp_feedback_task_issues
  (feedback_task_id, repo, issue_number, issue_url, sync_status, created_at)
SELECT
  t.id,
  t.github_issue_repo,
  t.github_issue_number,
  t.github_issue_url,
  COALESCE(t.github_sync_status, 'synced'),
  t.created_at
  FROM mcp_feedback_tasks t
 WHERE t.github_issue_number IS NOT NULL
   AND t.github_issue_repo IN ('CRMBackend', 'CRMFrontEnd')
   AND NOT EXISTS (
     SELECT 1 FROM mcp_feedback_task_issues ix
      WHERE ix.feedback_task_id = t.id
   )
ON CONFLICT DO NOTHING;


COMMIT;


-- ============================================================================
-- DOWN MIGRATION
--   Uncomment and run as a single transaction to roll back.
--   WARNING: drops all agent_runs / agent_run_prs / agent_run_events data.
--            mcp_feedback_task_issues data is dropped too.
--            mcp_feedback_tasks rows are preserved; only the new columns drop.
-- ============================================================================
--
-- BEGIN;
--
-- DROP TABLE IF EXISTS agent_run_events;
-- DROP TABLE IF EXISTS agent_run_prs;
-- DROP TRIGGER IF EXISTS agent_runs_updated_at ON agent_runs;
-- DROP FUNCTION IF EXISTS trigger_agent_runs_updated_at();
-- DROP TABLE IF EXISTS agent_runs;
-- DROP TABLE IF EXISTS mcp_feedback_task_issues;
--
-- ALTER TABLE mcp_feedback_tasks
--   DROP COLUMN IF EXISTS state,
--   DROP COLUMN IF EXISTS agent_eligible,
--   DROP COLUMN IF EXISTS planner_status,
--   DROP COLUMN IF EXISTS planner_started_at,
--   DROP COLUMN IF EXISTS planner_finished_at,
--   DROP COLUMN IF EXISTS planner_error,
--   DROP COLUMN IF EXISTS planner_decision,
--   DROP COLUMN IF EXISTS planner_confidence,
--   DROP COLUMN IF EXISTS planner_summary,
--   DROP COLUMN IF EXISTS scope,
--   DROP COLUMN IF EXISTS acceptance_md,
--   DROP COLUMN IF EXISTS reproducer_md,
--   DROP COLUMN IF EXISTS test_stub_md,
--   DROP COLUMN IF EXISTS skip_reason;
--
-- COMMIT;

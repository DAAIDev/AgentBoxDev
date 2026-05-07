-- ============================================
-- MCP Project Tracker Schema (Cloud SQL)
-- ============================================

-- Companies
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'discovery' CHECK (status IN ('discovery', 'active', 'pilot', 'deployed')),
  tools TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Contacts at each company
CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT,
  email TEXT,
  phone TEXT,
  is_primary BOOLEAN DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Milestones
CREATE TABLE IF NOT EXISTS milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'done', 'blocked')),
  order_index INT DEFAULT 0,
  due_date DATE,
  completed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Documents
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT,
  storage_path TEXT,
  url TEXT,
  file_url TEXT,
  bucket_path TEXT,
  file_type TEXT,
  category TEXT DEFAULT 'general',
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

-- Activity/Notes log
CREATE TABLE IF NOT EXISTS activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  type TEXT DEFAULT 'note' CHECK (type IN ('note', 'milestone', 'document', 'meeting', 'call', 'email')),
  content TEXT NOT NULL,
  author TEXT DEFAULT 'Chris',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Requirements (what we have / what we need)
CREATE TABLE IF NOT EXISTS requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  item TEXT NOT NULL,
  status TEXT DEFAULT 'needed' CHECK (status IN ('needed', 'requested', 'received')),
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Dev Tasks
CREATE TABLE IF NOT EXISTS dev_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  assigned_to TEXT,
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  status TEXT DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'blocked', 'done')),
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  steps JSONB DEFAULT '[]',
  acceptance_criteria TEXT,
  due_date DATE,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Deployments
CREATE TABLE IF NOT EXISTS deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'deploying', 'failed', 'stopped')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Deployment Components
CREATE TABLE IF NOT EXISTS deployment_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id UUID REFERENCES deployments(id) ON DELETE CASCADE,
  component_type TEXT NOT NULL,
  status TEXT DEFAULT 'unknown',
  url TEXT,
  last_checked TIMESTAMPTZ,
  error_message TEXT,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Admin Requests (Google Workspace & Website edit requests)
CREATE TABLE IF NOT EXISTS admin_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('workspace', 'website')),
  category TEXT NOT NULL,
  subject TEXT,
  description TEXT NOT NULL,
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  page_url TEXT,
  reference_url TEXT,
  submitted_by TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'resolved')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Build Agents (Layer 1)
-- ============================================

-- Build Runs — specs submitted for parallel agent building
CREATE TABLE IF NOT EXISTS build_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spec_title TEXT NOT NULL,
  spec_body TEXT NOT NULL,
  repo TEXT NOT NULL,
  branch TEXT DEFAULT 'main',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'success', 'failed', 'cancelled')),
  total_tasks INT DEFAULT 0,
  completed_tasks INT DEFAULT 0,
  failed_tasks INT DEFAULT 0,
  pr_url TEXT,
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Build Tasks — individual tasks within a build run (one per agent)
CREATE TABLE IF NOT EXISTS build_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  build_run_id UUID NOT NULL REFERENCES build_runs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  worktree_path TEXT,
  agent_pid INT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'success', 'failed', 'cancelled')),
  output_log TEXT,
  files_changed JSONB DEFAULT '[]',
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Production Monitoring (Layer 2)
-- ============================================

-- Error Events — errors detected from Cloud Logging
CREATE TABLE IF NOT EXISTS error_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('WARNING', 'ERROR', 'CRITICAL')),
  message TEXT NOT NULL,
  stack_trace TEXT,
  log_url TEXT,
  fingerprint TEXT UNIQUE NOT NULL,
  occurrence_count INT DEFAULT 1,
  acknowledged BOOLEAN DEFAULT FALSE,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW()
);

-- Error Triage — Claude triage results for detected errors
CREATE TABLE IF NOT EXISTS error_triage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  error_event_id UUID NOT NULL REFERENCES error_events(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('bug', 'config', 'transient', 'dependency', 'infra', 'unknown')),
  root_cause TEXT,
  suggested_fix TEXT,
  auto_fixable BOOLEAN DEFAULT FALSE,
  confidence REAL DEFAULT 0,
  github_issue_url TEXT,
  slack_notified BOOLEAN DEFAULT FALSE,
  autofix_run_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Auto-Fix Loop (Layer 3)
-- ============================================

-- Autofix Runs — auto-fix attempts
CREATE TABLE IF NOT EXISTS autofix_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  error_triage_id UUID REFERENCES error_triage(id) ON DELETE SET NULL,
  github_issue_url TEXT,
  repo TEXT NOT NULL,
  branch TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'testing', 'success', 'failed', 'cancelled')),
  fix_description TEXT,
  files_changed JSONB DEFAULT '[]',
  test_output TEXT,
  tests_passed BOOLEAN,
  pr_url TEXT,
  agent_pid INT,
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add FK from error_triage to autofix_runs (circular ref, added after both tables exist)
-- ALTER TABLE error_triage ADD CONSTRAINT fk_autofix_run FOREIGN KEY (autofix_run_id) REFERENCES autofix_runs(id) ON DELETE SET NULL;
-- Run manually if needed; CREATE TABLE IF NOT EXISTS won't re-add constraints.

-- ============================================
-- MCP Feedback-Task Mirror (synced from each tenant CRM)
-- ============================================
-- Each row mirrors a row in a tenant CRM's Task / TaskComment / TaskAttachment
-- table. Source of truth lives in the per-tenant CRM database; these tables
-- are an eventually-consistent read-side cache populated by webhooks from
-- CRMBackend (POST /api/feedback-tasks/webhook).
--
-- Identity:
--   - `id` is the mirror's own UUID, used for FK joins between mirror tables
--   - `crm_*_id` is the source-of-truth ID from the tenant CRM (cuid string)
--   - `(tenant, crm_*_id)` is unique so webhook upserts stay idempotent
--   - Cross-system traces: "is mirror row X in sync with CRM row Y?" lookup
--     uses (tenant, crm_*_id) — every row carries a visible breadcrumb back
--     to its CRM source.
CREATE TABLE IF NOT EXISTS mcp_feedback_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant TEXT NOT NULL,
  crm_task_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  priority TEXT NOT NULL DEFAULT 'medium',
  position INT NOT NULL DEFAULT 0,
  reporter_id TEXT,
  reporter_name TEXT,
  reporter_email TEXT,
  assignee_id TEXT,
  assignee_name TEXT,
  assignee_email TEXT,
  channel_id TEXT NOT NULL,
  channel_name TEXT,
  channel_feedback_type TEXT,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- GitHub Issues sync (auto-fired by chat-feedback → GH Issues pipeline).
  -- Issue is left open even after the kanban card moves to 'done'; a comment
  -- + 'status:done' label gets posted instead.
  github_issue_number  INT,
  github_issue_url     TEXT,
  github_issue_repo    TEXT,
  github_sync_status   TEXT NOT NULL DEFAULT 'pending'
                       CHECK (github_sync_status IN ('pending', 'synced', 'failed', 'skipped')),
  github_sync_error    TEXT,
  github_synced_at     TIMESTAMPTZ,
  github_done_commented_at TIMESTAMPTZ,
  classified_repo      TEXT,
  classifier_confidence REAL,
  classifier_reasoning TEXT,

  CONSTRAINT mcp_feedback_tasks_tenant_crm_task_unique UNIQUE (tenant, crm_task_id)
);

CREATE TABLE IF NOT EXISTS mcp_feedback_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant TEXT NOT NULL,
  crm_comment_id TEXT NOT NULL,
  mirror_task_id UUID NOT NULL REFERENCES mcp_feedback_tasks(id) ON DELETE CASCADE,
  crm_task_id TEXT NOT NULL,
  author_id TEXT,
  author_name TEXT,
  author_email TEXT,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mcp_feedback_comments_tenant_crm_comment_unique UNIQUE (tenant, crm_comment_id)
);

CREATE TABLE IF NOT EXISTS mcp_feedback_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant TEXT NOT NULL,
  crm_attachment_id TEXT NOT NULL,
  mirror_task_id UUID NOT NULL REFERENCES mcp_feedback_tasks(id) ON DELETE CASCADE,
  crm_task_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  mime_type TEXT,
  signed_url TEXT,
  signed_url_expires_at TIMESTAMPTZ,
  uploaded_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mcp_feedback_attachments_tenant_crm_att_unique UNIQUE (tenant, crm_attachment_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_admin_requests_type ON admin_requests(type);
CREATE INDEX IF NOT EXISTS idx_admin_requests_status ON admin_requests(status);
CREATE INDEX IF NOT EXISTS idx_admin_requests_created ON admin_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_milestones_company ON milestones(company_id);
CREATE INDEX IF NOT EXISTS idx_activity_company ON activity(company_id);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_requirements_company ON requirements(company_id);
CREATE INDEX IF NOT EXISTS idx_documents_company ON documents(company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_dev_tasks_status ON dev_tasks(status);
CREATE INDEX IF NOT EXISTS idx_dev_tasks_assigned ON dev_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_deployments_slug ON deployments(slug);
CREATE INDEX IF NOT EXISTS idx_deployment_components_deployment ON deployment_components(deployment_id);

-- Build Agents indexes
CREATE INDEX IF NOT EXISTS idx_build_runs_status ON build_runs(status);
CREATE INDEX IF NOT EXISTS idx_build_runs_repo ON build_runs(repo);
CREATE INDEX IF NOT EXISTS idx_build_runs_created ON build_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_build_tasks_run ON build_tasks(build_run_id);
CREATE INDEX IF NOT EXISTS idx_build_tasks_status ON build_tasks(status);

-- Monitoring indexes
CREATE INDEX IF NOT EXISTS idx_error_events_service ON error_events(service);
CREATE INDEX IF NOT EXISTS idx_error_events_severity ON error_events(severity);
CREATE INDEX IF NOT EXISTS idx_error_events_fingerprint ON error_events(fingerprint);
CREATE INDEX IF NOT EXISTS idx_error_events_last_seen ON error_events(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_triage_event ON error_triage(error_event_id);
CREATE INDEX IF NOT EXISTS idx_error_triage_category ON error_triage(category);
CREATE INDEX IF NOT EXISTS idx_error_triage_auto_fixable ON error_triage(auto_fixable) WHERE auto_fixable = TRUE;

-- Autofix indexes
CREATE INDEX IF NOT EXISTS idx_autofix_runs_status ON autofix_runs(status);
CREATE INDEX IF NOT EXISTS idx_autofix_runs_triage ON autofix_runs(error_triage_id);
CREATE INDEX IF NOT EXISTS idx_autofix_runs_created ON autofix_runs(created_at DESC);

-- ============================================
-- Infrastructure Registry (Tenant Configs)
-- ============================================

-- One row per service (not per company). E.g. PacketFabric has backend + frontend rows.
CREATE TABLE IF NOT EXISTS tenant_configs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant          TEXT NOT NULL,
  service_type    TEXT NOT NULL,

  -- Cloud Run / hosting details
  cloud_run_service   TEXT,
  cloud_run_url       TEXT,
  gcp_project         TEXT DEFAULT 'agentbox-485618',
  gcp_region          TEXT DEFAULT 'us-central1',

  -- Git
  github_repo         TEXT,
  git_branch          TEXT,

  -- Required env vars (names + descriptions, NOT values)
  env_vars_required   JSONB DEFAULT '[]',

  -- Secret references (names only — values stay in GCP Secret Manager)
  secrets             JSONB DEFAULT '[]',

  -- Deploy command template
  deploy_command      TEXT,

  -- Feature flags for this service
  feature_flags       JSONB DEFAULT '{}',

  -- Known issues / gotchas
  notes               TEXT,

  -- Metadata
  status              TEXT DEFAULT 'active',
  last_deployed_at    TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(tenant, service_type)
);

CREATE INDEX IF NOT EXISTS idx_tc_tenant ON tenant_configs(tenant);
CREATE INDEX IF NOT EXISTS idx_tc_service ON tenant_configs(service_type);
CREATE INDEX IF NOT EXISTS idx_tc_status ON tenant_configs(status);

-- ============================================
-- Project Context (Shared Team Knowledge)
-- ============================================

-- Stores feature status, architecture decisions, blockers, and context
-- so any dev's Claude agent can query it instead of re-scanning codebases.
CREATE TABLE IF NOT EXISTS project_context (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo        TEXT NOT NULL,
  area        TEXT NOT NULL,
  key         TEXT NOT NULL,
  status      TEXT DEFAULT 'unknown' CHECK (status IN ('done', 'in_progress', 'stub', 'not_started', 'blocked', 'deprecated', 'unknown')),
  summary     TEXT NOT NULL,
  details     JSONB DEFAULT '{}',
  key_files   JSONB DEFAULT '[]',
  blocked_by  TEXT,
  assigned_to TEXT,
  updated_by  TEXT DEFAULT 'system',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(repo, area, key)
);

CREATE INDEX IF NOT EXISTS idx_pc_repo ON project_context(repo);
CREATE INDEX IF NOT EXISTS idx_pc_area ON project_context(repo, area);
CREATE INDEX IF NOT EXISTS idx_pc_status ON project_context(status);

-- MCP Feedback-Task Mirror indexes
CREATE INDEX IF NOT EXISTS idx_mcp_feedback_tasks_tenant ON mcp_feedback_tasks(tenant);
CREATE INDEX IF NOT EXISTS idx_mcp_feedback_tasks_tenant_status_position ON mcp_feedback_tasks(tenant, status, position);
CREATE INDEX IF NOT EXISTS idx_mcp_feedback_comments_mirror_task ON mcp_feedback_comments(mirror_task_id);
CREATE INDEX IF NOT EXISTS idx_mcp_feedback_attachments_mirror_task ON mcp_feedback_attachments(mirror_task_id);

-- ============================================
-- Migrations for live DBs (additive, idempotent)
-- ============================================
-- Re-run schema.sql on existing deployments. Each ALTER is IF NOT EXISTS so
-- a fresh DB created from the CREATE TABLE blocks above is unaffected.

-- 2026-05-06 — chat-feedback → GitHub Issues sync columns
ALTER TABLE mcp_feedback_tasks ADD COLUMN IF NOT EXISTS github_issue_number  INT;
ALTER TABLE mcp_feedback_tasks ADD COLUMN IF NOT EXISTS github_issue_url     TEXT;
ALTER TABLE mcp_feedback_tasks ADD COLUMN IF NOT EXISTS github_issue_repo    TEXT;
ALTER TABLE mcp_feedback_tasks ADD COLUMN IF NOT EXISTS github_sync_status   TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE mcp_feedback_tasks ADD COLUMN IF NOT EXISTS github_sync_error    TEXT;
ALTER TABLE mcp_feedback_tasks ADD COLUMN IF NOT EXISTS github_synced_at     TIMESTAMPTZ;
ALTER TABLE mcp_feedback_tasks ADD COLUMN IF NOT EXISTS github_done_commented_at TIMESTAMPTZ;
ALTER TABLE mcp_feedback_tasks ADD COLUMN IF NOT EXISTS classified_repo      TEXT;
ALTER TABLE mcp_feedback_tasks ADD COLUMN IF NOT EXISTS classifier_confidence REAL;
ALTER TABLE mcp_feedback_tasks ADD COLUMN IF NOT EXISTS classifier_reasoning TEXT;

-- Mirror the CHECK constraint inline on the CREATE TABLE column definition
-- onto live DBs that took the ALTER path. DROP IF EXISTS keeps the block
-- re-runnable.
ALTER TABLE mcp_feedback_tasks DROP CONSTRAINT IF EXISTS mcp_feedback_tasks_github_sync_status_check;
ALTER TABLE mcp_feedback_tasks ADD CONSTRAINT mcp_feedback_tasks_github_sync_status_check
  CHECK (github_sync_status IN ('pending', 'synced', 'failed', 'skipped'));

-- Backfill query support: rows still needing a GH issue (not done, no issue yet).
CREATE INDEX IF NOT EXISTS idx_feedback_tasks_gh_pending
  ON mcp_feedback_tasks(tenant, github_sync_status)
  WHERE github_issue_number IS NULL AND status <> 'done';

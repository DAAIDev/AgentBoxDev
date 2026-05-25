// triage.mjs
//
// Triage worker for the CRM self-repair pipeline (Wedge 1).
//
// Flow:
//   1. Atomic claim — UPDATE mcp_feedback_tasks WHERE planner_status='pending'
//   2. BUG-only short-circuit (mark canceled if type != 'BUG')
//   3. Agentic loop: Sonnet 4.6 with TRIAGE_TOOLS (gh_search_code, gh_get_file)
//   4. Parse JSON output (scope, acceptance_md, proposed_fix_md, etc.)
//   5. If scope='skip': mark canceled with skip_reason
//   6. Otherwise: persist plan to mcp_feedback_tasks; open 1 or 2 GitHub
//      issues (one per repo in scope); insert rows in mcp_feedback_task_issues
//
// Entry point: triageFeedbackTask(taskId, pool)
// The pool is dependency-injected from server.js so connection lifecycle
// stays in one place.

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  TRIAGE_TOOLS,
  runTool,
  createGitHubIssue,
} from './tools/github.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TRIAGE_SYSTEM_PROMPT = readFileSync(
  path.join(__dirname, 'prompts', 'triage.system.md'),
  'utf-8',
);

const TRIAGE_MODEL = process.env.TRIAGE_MODEL || 'claude-sonnet-4-6';
const MAX_TURNS = 20;
const MAX_TOKENS = 8000;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Triage one feedback task. Idempotent at the claim boundary —
 * concurrent callers race on the UPDATE WHERE planner_status='pending'
 * and only one wins.
 *
 * @param {string} taskId - mcp_feedback_tasks.id (uuid)
 * @param {import('pg').Pool} pool - the AgentBoxDev pg pool
 * @returns {Promise<{ ok?: boolean, skipped?: boolean, reason?: string, scope?: string, issues?: Array }>}
 */
export async function triageFeedbackTask(taskId, pool) {
  // 1. Atomic claim.
  const claimed = await pool.query(
    `UPDATE mcp_feedback_tasks
        SET planner_status = 'running',
            planner_started_at = NOW()
      WHERE id = $1 AND planner_status = 'pending'
      RETURNING *`,
    [taskId],
  );
  if (claimed.rowCount === 0) {
    return { skipped: true, reason: 'not_pending' };
  }
  const task = claimed.rows[0];

  try {
    // 2. BUG-only short-circuit (v1 scope).
    if (task.type !== 'BUG') {
      await markCanceled(
        pool,
        taskId,
        'non-bug-v1-out-of-scope',
        `Skipped: type=${task.type}. v1 of the agent loop only handles BUG.`,
      );
      return { skipped: true, reason: 'non-bug-v1-out-of-scope', type: task.type };
    }

    // 3. Agentic loop with Claude.
    const userPrompt = renderTaskPrompt(task);
    let messages = [{ role: 'user', content: userPrompt }];
    let response;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      response = await anthropic.messages.create({
        model: TRIAGE_MODEL,
        max_tokens: MAX_TOKENS,
        system: TRIAGE_SYSTEM_PROMPT,
        tools: TRIAGE_TOOLS,
        messages,
      });
      messages.push({ role: 'assistant', content: response.content });

      if (response.stop_reason !== 'tool_use') break;

      // Execute every tool_use block in this turn, in parallel.
      const toolUses = response.content.filter((b) => b.type === 'tool_use');
      const toolResults = await Promise.all(
        toolUses.map(async (b) => ({
          type: 'tool_result',
          tool_use_id: b.id,
          content: await runTool(b.name, b.input),
        })),
      );
      messages.push({ role: 'user', content: toolResults });
    }

    if (response.stop_reason === 'tool_use') {
      throw new Error(`Triage exceeded MAX_TURNS=${MAX_TURNS} without completing`);
    }

    // 4. Parse JSON output.
    const plan = extractJsonOutput(response);

    // 5. Skip path.
    if (plan.scope === 'skip') {
      await markCanceled(
        pool,
        taskId,
        plan.skip_reason || 'planner-skip',
        plan.reasoning || '',
        plan,
      );
      return { skipped: true, reason: plan.skip_reason };
    }

    // 6. Persist plan + open issues.
    await persistPlan(pool, taskId, plan);
    const projections = await openProjectedIssues(pool, task, plan);
    return { ok: true, scope: plan.scope, issues: projections };
  } catch (err) {
    await pool.query(
      `UPDATE mcp_feedback_tasks
          SET planner_status = 'failed',
              planner_finished_at = NOW(),
              planner_error = $2
        WHERE id = $1`,
      [taskId, String(err.message || err).slice(0, 2000)],
    );
    throw err;
  }
}

// ============================================================
// Helpers
// ============================================================

function renderTaskPrompt(task) {
  const attachments = Array.isArray(task.attachments) && task.attachments.length > 0
    ? task.attachments.map((a, i) => `  ${i + 1}. ${a.name || a.url || JSON.stringify(a)}`).join('\n')
    : '  (none)';

  return [
    'Triage this feedback task. Output the JSON object only.',
    '',
    '## Task fields',
    `- tenant: ${task.tenant}`,
    `- crm_task_id: ${task.crm_task_id}`,
    `- title: ${task.title}`,
    `- type: ${task.type}`,
    `- priority: ${task.priority || 'medium'}`,
    `- channel: ${task.channel_name || task.channel_id || '(unknown)'}`,
    `- reporter: ${task.reporter_name || ''} <${task.reporter_email || ''}>`,
    '',
    '## Description (as written by the customer)',
    task.description || '(no description provided)',
    '',
    '## Attachments',
    attachments,
  ].join('\n');
}

/**
 * Extract the JSON output from the final assistant message.
 * The system prompt requires raw JSON with no prose or fences, but
 * be lenient: strip optional ```json fences, find the outermost { ... }.
 */
function extractJsonOutput(response) {
  const textBlocks = (response.content || []).filter((b) => b.type === 'text');
  if (textBlocks.length === 0) {
    throw new Error('Triage agent returned no text output');
  }
  const text = textBlocks.map((b) => b.text).join('\n').trim();

  // Try direct parse first (the well-behaved case).
  try {
    return JSON.parse(text);
  } catch (_) {
    /* fall through */
  }

  // Strip ```json fences if present.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch (_) {
      /* fall through */
    }
  }

  // Find the outermost {...}.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch (_) {
      /* fall through */
    }
  }

  throw new Error(`Triage agent output was not parseable JSON: ${text.slice(0, 300)}...`);
}

async function markCanceled(pool, taskId, skipReason, summary, plan = null) {
  await pool.query(
    `UPDATE mcp_feedback_tasks
        SET state = 'canceled',
            planner_status = 'skipped',
            planner_finished_at = NOW(),
            agent_eligible = FALSE,
            skip_reason = $2,
            planner_summary = $3,
            planner_decision = $4,
            planner_confidence = $5
      WHERE id = $1`,
    [
      taskId,
      skipReason,
      (summary || '').slice(0, 4000),
      plan?.scope || 'skip',
      plan?.confidence ?? null,
    ],
  );
}

async function persistPlan(pool, taskId, plan) {
  await pool.query(
    `UPDATE mcp_feedback_tasks
        SET state = 'planned',
            agent_eligible = TRUE,
            planner_status = 'opened',
            planner_finished_at = NOW(),
            planner_decision = $2,
            scope = $2,
            planner_confidence = $3,
            planner_summary = $4,
            synthesized_bug_md = $5,
            acceptance_md = $6,
            reproducer_md = $7,
            proposed_fix_md = $8,
            test_stub_md = $9
      WHERE id = $1`,
    [
      taskId,
      plan.scope,
      plan.confidence ?? null,
      (plan.reasoning || '').slice(0, 4000),
      plan.synthesized_bug_md || null,
      plan.acceptance_md || null,
      plan.reproducer_md || null,
      plan.proposed_fix_md || null,
      plan.test_stub_md || null,
    ],
  );
}

async function openProjectedIssues(pool, task, plan) {
  const reposInScope = scopeToRepos(plan.scope);
  const issuesOpened = [];

  // First pass: open all issues. We need both numbers before formatting
  // bodies for the paired case (cross-link), so two passes — open with
  // placeholder bodies, then patch-link via comments. Simpler: open
  // sequentially and reference the prior one in the second body.
  for (let i = 0; i < reposInScope.length; i++) {
    const repo = reposInScope[i];
    const counterpart = issuesOpened[0] || null; // null on first iteration
    const body = formatIssueBody({ task, plan, repo, counterpart });
    const labels = (plan.labels || []).filter(Boolean);
    const title = formatIssueTitle(task);

    const issue = await createGitHubIssue(repo, { title, body, labels });

    await pool.query(
      `INSERT INTO mcp_feedback_task_issues
         (feedback_task_id, repo, issue_number, issue_url, sync_status)
       VALUES ($1, $2, $3, $4, 'synced')
       ON CONFLICT (feedback_task_id, repo) DO UPDATE
         SET issue_number = EXCLUDED.issue_number,
             issue_url    = EXCLUDED.issue_url,
             sync_status  = 'synced'`,
      [task.id, repo, issue.number, issue.url],
    );

    issuesOpened.push({
      repo,
      number: issue.number,
      url: issue.url,
    });
  }

  // Backwards-compat: also populate the deprecated singular columns
  // with the primary projection (first repo in scope).
  if (issuesOpened.length > 0) {
    const primary = issuesOpened[0];
    await pool.query(
      `UPDATE mcp_feedback_tasks
          SET github_issue_number = $2,
              github_issue_url    = $3,
              github_issue_repo   = $4,
              github_sync_status  = 'synced',
              github_synced_at    = NOW()
        WHERE id = $1`,
      [task.id, primary.number, primary.url, primary.repo],
    );
  }

  return issuesOpened;
}

function scopeToRepos(scope) {
  if (scope === 'fe') return ['CRMFrontEnd'];
  if (scope === 'be') return ['CRMBackend'];
  if (scope === 'both') return ['CRMBackend', 'CRMFrontEnd'];
  throw new Error(`Invalid scope for projection: ${scope}`);
}

function formatIssueTitle(task) {
  const tenantUpper = String(task.tenant || 'unknown').toUpperCase();
  return `[${tenantUpper}][${task.crm_task_id}] ${task.title}`.slice(0, 250);
}

function formatIssueBody({ task, plan, repo, counterpart }) {
  const sections = [];

  sections.push(`## Reported by
${task.reporter_name || ''} <${task.reporter_email || ''}> — tenant **${(task.tenant || '').toUpperCase()}**
Work item: \`${task.crm_task_id}\``);

  if (task.description) {
    sections.push(`## Original feedback
${task.description}`);
  }

  if (plan.synthesized_bug_md) {
    sections.push(`## What the bug actually is (technical)
${plan.synthesized_bug_md}`);
  }

  if (plan.acceptance_md) {
    sections.push(`## Acceptance criteria
\`\`\`
${plan.acceptance_md}
\`\`\``);
  }

  if (plan.reproducer_md) {
    sections.push(`## Reproducer
${plan.reproducer_md}`);
  }

  if (plan.proposed_fix_md) {
    sections.push(`## Proposed fix shape (guidance, not mandate)
${plan.proposed_fix_md}`);
  }

  if (plan.test_stub_md) {
    sections.push(`## Pre-written test (commits to agent branch as-is)
${plan.test_stub_md}`);
  }

  // Files likely touched in THIS repo only.
  const filesForThisRepo = (plan.files_touched || []).filter((f) => f.repo === repo);
  if (filesForThisRepo.length > 0) {
    sections.push(`## Likely files (in this repo)
${filesForThisRepo.map((f) => `- \`${f.path}\` — ${f.reason}`).join('\n')}`);
  }

  if (counterpart) {
    sections.push(`## Paired with
- ${counterpart.repo} #${counterpart.number}: ${counterpart.url}

Both PRs will be opened additive-only — merge order doesn't matter.`);
  }

  sections.push(`## Triage metadata
- Scope: \`${plan.scope}\`
- Confidence: \`${plan.confidence ?? 'n/a'}\`
- Areas: ${(plan.areas || []).map((a) => `\`${a}\``).join(', ') || '(none)'}
- Source kanban task: \`${task.tenant}/${task.crm_task_id}\`

${plan.reasoning ? `**Triage reasoning:** ${plan.reasoning}` : ''}`);

  sections.push(`<!-- agentbox-sync: tenant=${task.tenant} crm_task_id=${task.crm_task_id} -->`);

  return sections.join('\n\n');
}

// Export helpers for tests + the safety poller.
export const _internals = {
  renderTaskPrompt,
  extractJsonOutput,
  formatIssueTitle,
  formatIssueBody,
  scopeToRepos,
};

/**
 * Safety poller — runs on a setInterval from server.js. Two jobs:
 *
 *   1. Reset stuck rows: rows that have been planner_status='running'
 *      for more than 5 minutes (worker crashed before finishing).
 *      Flip them back to 'pending' so the second pass below picks them up.
 *
 *   2. Backfill rows: rows that are planner_status='pending' but older
 *      than 1 minute — the webhook's setImmediate either crashed or
 *      never fired. Re-trigger triage on each.
 *
 * Idempotent: if multiple poller ticks overlap, the atomic claim in
 * triageFeedbackTask handles the race.
 */
export async function safetyPollTriage(pool) {
  if (!pool) throw new Error('pool is required');

  await pool.query(
    `UPDATE mcp_feedback_tasks
        SET planner_status = 'pending'
      WHERE planner_status = 'running'
        AND planner_started_at < NOW() - INTERVAL '5 minutes'`,
  );

  const stuck = await pool.query(
    `SELECT id FROM mcp_feedback_tasks
      WHERE planner_status = 'pending'
        AND created_at < NOW() - INTERVAL '1 minute'
      ORDER BY created_at ASC
      LIMIT 10`,
  );

  for (const row of stuck.rows) {
    try {
      await triageFeedbackTask(row.id, pool);
    } catch (_err) {
      // Per-row failures already write to planner_error in the DB.
      // Don't let one bad row stop the rest of the batch.
    }
  }
}

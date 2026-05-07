// Auto-fires GitHub Issues from chat-feedback kanban tasks.
//
// Flow:
//   tenant CRMBackend → /api/feedback-tasks/webhook → upsert mcp_feedback_tasks
//                     → setImmediate(pushKanbanTaskToGitHub) — fire-and-forget
//                     → Haiku 4.5 picks CRMBackend vs CRMFrontEnd
//                     → handlers.create_github_issue(...)
//                     → row updated with issue number + URL
//
// Idempotency: claim-pattern UPDATE. Only one concurrent invocation can move
// a row from `github_issue_number IS NULL` to a real number.
//
// Status sync: when a card moves to 'done' AND an issue exists, post a comment
// + apply `status:done` label. Issue is left OPEN (the agent may still work it).

const TRIAGE_MODEL = 'claude-haiku-4-5-20251001';
const REPO_OPTIONS = ['CRMBackend', 'CRMFrontEnd'];
const DEFAULT_REPO = 'CRMBackend';
const LOW_CONFIDENCE_THRESHOLD = 0.6;

const CLASSIFIER_SYSTEM = `You are a repository router for a feedback-task pipeline.

Decide whether a kanban-board task should be filed in CRMBackend or CRMFrontEnd:

- CRMBackend (NestJS, Prisma, server-side): REST APIs, database queries, auth, webhooks, background jobs, integrations (Zendesk, Salesforce, ServiceNow, Twilio, GCS, Firebase Admin), email/SMS sending, server-side validation, business logic.
- CRMFrontEnd (Next.js, React, TypeScript): page rendering, forms, buttons, layouts, styling, navigation, modals, client-side validation, browser-side state, anything visible in the UI.

Default to CRMBackend when uncertain — that is the operator's instruction.

You MUST respond by calling the classify_repo tool with your decision.`;

const CLASSIFY_TOOL = {
  name: 'classify_repo',
  description: 'Record the routing decision for this kanban task.',
  input_schema: {
    type: 'object',
    properties: {
      repo: { type: 'string', enum: REPO_OPTIONS, description: 'Target repository' },
      confidence: { type: 'number', minimum: 0, maximum: 1, description: '0..1 confidence in this routing' },
      reasoning: { type: 'string', description: 'One-sentence rationale, visible to humans in the GitHub issue body' },
    },
    required: ['repo', 'confidence', 'reasoning'],
  },
};

export function createKanbanGithubSync({ pool, anthropic, handlers, callGitHub, githubOrg, logger = console }) {

  // ---- Classifier ----------------------------------------------------------

  async function classifyRepo({ tenant, type, priority, channelName, channelFeedbackType, title, description }) {
    const userMsg = [
      `Tenant: ${tenant}`,
      `Type: ${type}`,
      `Priority: ${priority}`,
      channelName ? `Channel: ${channelName}` : null,
      channelFeedbackType ? `Channel feedback type: ${channelFeedbackType}` : null,
      '',
      `Title: ${title}`,
      '',
      'Description:',
      description || '(no description)',
    ].filter(line => line !== null).join('\n');

    try {
      const resp = await anthropic.messages.create({
        model: TRIAGE_MODEL,
        max_tokens: 512,
        system: CLASSIFIER_SYSTEM,
        tools: [CLASSIFY_TOOL],
        tool_choice: { type: 'tool', name: 'classify_repo' },
        messages: [{ role: 'user', content: userMsg }],
      });

      const toolUse = resp.content.find(b => b.type === 'tool_use');
      if (!toolUse?.input?.repo || !REPO_OPTIONS.includes(toolUse.input.repo)) {
        return {
          repo: DEFAULT_REPO,
          confidence: 0,
          reasoning: 'Classifier returned unparseable output — defaulted to CRMBackend.',
        };
      }

      const { repo, confidence, reasoning } = toolUse.input;
      if (confidence < LOW_CONFIDENCE_THRESHOLD) {
        return {
          repo: DEFAULT_REPO,
          confidence,
          reasoning: `${reasoning} (confidence ${confidence.toFixed(2)} below ${LOW_CONFIDENCE_THRESHOLD} — defaulted to CRMBackend)`,
        };
      }
      return { repo, confidence, reasoning };
    } catch (err) {
      logger.error(`[kanban-gh-sync] classifier failed: ${err.message}`);
      return {
        repo: DEFAULT_REPO,
        confidence: 0,
        reasoning: `Classifier error: ${err.message}. Defaulted to CRMBackend.`,
      };
    }
  }

  // ---- Issue body formatting ----------------------------------------------

  function formatIssue({ tenant, row, attachments, classified }) {
    const tenantTag = tenant.toUpperCase();
    const title = `[${tenantTag}] ${row.title}`;

    const reporterLine = row.reporter_name
      ? `${row.reporter_name}${row.reporter_email ? ` <${row.reporter_email}>` : ''}`
      : (row.reporter_email || '_unknown_');

    const lines = [
      `## Reported by`,
      `${reporterLine} — tenant **${tenantTag}**`,
      ``,
      `## Original feedback`,
      row.description ? row.description : '_(no description provided)_',
      ``,
      `## Metadata`,
      `- **Type:** ${row.type}`,
      `- **Priority:** ${row.priority}`,
      `- **Channel:** ${row.channel_name || row.channel_id}${row.channel_feedback_type ? ` (${row.channel_feedback_type})` : ''}`,
      `- **Created:** ${new Date(row.created_at).toISOString()}`,
      `- **Source kanban task:** ${tenant}/${row.crm_task_id}`,
    ];

    if (attachments && attachments.length > 0) {
      lines.push('', '## Attachments');
      for (const a of attachments) {
        const sizeKb = a.file_size ? ` (${Math.round(a.file_size / 1024)} KB)` : '';
        lines.push(`- ${a.file_name}${sizeKb} — view in CRM kanban`);
      }
    }

    lines.push(
      '',
      '## Auto-routing',
      `- **Repo:** \`${classified.repo}\``,
      `- **Confidence:** ${classified.confidence.toFixed(2)}`,
      `- **Reasoning:** ${classified.reasoning}`,
      '',
      `<!-- agentbox-sync: tenant=${tenant} crm_task_id=${row.crm_task_id} -->`,
    );

    const labels = [
      `tenant:${tenant}`,
      `type:${String(row.type).toLowerCase()}`,
      `priority:${String(row.priority).toLowerCase()}`,
      'auto-classified',
    ];

    return { title, body: lines.join('\n'), labels };
  }

  // ---- Push one task → GitHub ---------------------------------------------

  async function pushKanbanTaskToGitHub({ tenant, crmTaskId }) {
    // Claim: atomically reserve this row. Returns 0 rows if already issued,
    // already done, or row missing — short-circuits everything that follows.
    const claimed = await pool.query(
      `UPDATE mcp_feedback_tasks
          SET github_sync_status = 'pending',
              github_sync_error  = NULL
        WHERE tenant = $1
          AND crm_task_id = $2
          AND github_issue_number IS NULL
          AND status <> 'done'
        RETURNING *`,
      [tenant, crmTaskId],
    );

    if (claimed.rowCount === 0) {
      return { skipped: true, reason: 'already_issued_or_done_or_missing' };
    }

    const row = claimed.rows[0];

    try {
      const attResult = await pool.query(
        `SELECT file_name, file_size, mime_type
           FROM mcp_feedback_attachments
          WHERE tenant = $1 AND crm_task_id = $2
          ORDER BY created_at ASC`,
        [tenant, crmTaskId],
      );

      const classified = await classifyRepo({
        tenant,
        type: row.type,
        priority: row.priority,
        channelName: row.channel_name,
        channelFeedbackType: row.channel_feedback_type,
        title: row.title,
        description: row.description,
      });

      const { title, body, labels } = formatIssue({
        tenant,
        row,
        attachments: attResult.rows,
        classified,
      });

      const issue = await handlers.create_github_issue({
        repo: classified.repo,
        title,
        body,
        labels,
      });

      await pool.query(
        `UPDATE mcp_feedback_tasks
            SET github_issue_number    = $3,
                github_issue_url       = $4,
                github_issue_repo      = $5,
                github_sync_status     = 'synced',
                github_sync_error      = NULL,
                github_synced_at       = NOW(),
                classified_repo        = $5,
                classifier_confidence  = $6,
                classifier_reasoning   = $7
          WHERE tenant = $1 AND crm_task_id = $2`,
        [tenant, crmTaskId, issue.number, issue.url, classified.repo, classified.confidence, classified.reasoning],
      );

      logger.log(`[kanban-gh-sync] ${tenant}/${crmTaskId} → ${classified.repo}#${issue.number}`);
      return { synced: true, issueNumber: issue.number, issueUrl: issue.url, repo: classified.repo, confidence: classified.confidence };
    } catch (err) {
      const msg = String(err.message || err).slice(0, 1000);
      await pool.query(
        `UPDATE mcp_feedback_tasks
            SET github_sync_status = 'failed',
                github_sync_error  = $3
          WHERE tenant = $1 AND crm_task_id = $2`,
        [tenant, crmTaskId, msg],
      );
      logger.error(`[kanban-gh-sync] ${tenant}/${crmTaskId} failed: ${msg}`);
      return { failed: true, error: msg };
    }
  }

  // ---- Status-to-done sync (comment + label, do NOT close) ----------------

  async function commentDoneOnGitHub({ tenant, crmTaskId }) {
    const result = await pool.query(
      `SELECT github_issue_number, github_issue_repo, status, github_done_commented_at
         FROM mcp_feedback_tasks
        WHERE tenant = $1 AND crm_task_id = $2`,
      [tenant, crmTaskId],
    );
    if (result.rowCount === 0) return { skipped: true, reason: 'row_missing' };

    const {
      github_issue_number: issueNumber,
      github_issue_repo: repo,
      status,
      github_done_commented_at: alreadyCommented,
    } = result.rows[0];
    if (!issueNumber || !repo) return { skipped: true, reason: 'no_issue_yet' };
    if (status !== 'done') return { skipped: true, reason: 'not_done' };
    // Guard against re-comment if a card flips done → not_done → done. The
    // first done-comment stamps github_done_commented_at; subsequent flips
    // short-circuit here so we don't litter the issue.
    if (alreadyCommented) return { skipped: true, reason: 'already_commented_done' };

    try {
      await callGitHub(
        `/repos/${githubOrg}/${repo}/issues/${issueNumber}/comments`,
        {},
        {
          method: 'POST',
          body: { body: `🟢 Marked **done** in the ${tenant.toUpperCase()} kanban on ${new Date().toISOString().slice(0, 10)}. Issue left open for follow-up; close manually when fully resolved.` },
        },
      );
      await callGitHub(
        `/repos/${githubOrg}/${repo}/issues/${issueNumber}/labels`,
        {},
        { method: 'POST', body: { labels: ['status:done'] } },
      );
      await pool.query(
        `UPDATE mcp_feedback_tasks
            SET github_done_commented_at = NOW()
          WHERE tenant = $1 AND crm_task_id = $2`,
        [tenant, crmTaskId],
      );
      logger.log(`[kanban-gh-sync] ${tenant}/${crmTaskId} → commented done on ${repo}#${issueNumber}`);
      return { commented: true, issueNumber, repo };
    } catch (err) {
      logger.error(`[kanban-gh-sync] commentDone ${tenant}/${crmTaskId} failed: ${err.message}`);
      return { failed: true, error: err.message };
    }
  }

  // ---- Backfill -----------------------------------------------------------

  async function backfillTenant({ tenant, retryFailed = false, dryRun = false, limit = 200 }) {
    const statusFilter = retryFailed
      ? `(github_sync_status = 'pending' OR github_sync_status = 'failed')`
      : `github_sync_status = 'pending'`;

    const candidates = await pool.query(
      `SELECT crm_task_id, title, type, status, github_sync_status, github_sync_error
         FROM mcp_feedback_tasks
        WHERE tenant = $1
          AND status <> 'done'
          AND github_issue_number IS NULL
          AND ${statusFilter}
        ORDER BY created_at ASC
        LIMIT $2`,
      [tenant, limit],
    );

    if (dryRun) {
      return {
        tenant,
        dryRun: true,
        count: candidates.rowCount,
        candidates: candidates.rows,
      };
    }

    const summary = { tenant, attempted: 0, synced: 0, failed: 0, skipped: 0, results: [] };
    for (const cand of candidates.rows) {
      summary.attempted++;
      const result = await pushKanbanTaskToGitHub({ tenant, crmTaskId: cand.crm_task_id });
      if (result.synced) summary.synced++;
      else if (result.failed) summary.failed++;
      else summary.skipped++;
      summary.results.push({ crm_task_id: cand.crm_task_id, ...result });
    }
    return summary;
  }

  return {
    classifyRepo,
    pushKanbanTaskToGitHub,
    commentDoneOnGitHub,
    backfillTenant,
  };
}

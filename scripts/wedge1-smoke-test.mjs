// scripts/wedge1-smoke-test.mjs
//
// End-to-end smoke test of the Wedge 1 triage worker against the live
// agentbox-db-mcp database. Inserts a synthetic BUG row and runs
// triageFeedbackTask against it. Opens 1-2 real GitHub issues in
// DAAITeam/CRMBackend and/or DAAITeam/CRMFrontEnd — clean up after.
//
// Run with:
//   GITHUB_TOKEN=$(gh auth token) node scripts/wedge1-smoke-test.mjs
//
// Prereqs:
//   - Cloud SQL proxy running on port 15433 (or DATABASE_URL pointed
//     wherever your AgentBoxDev DB is)
//   - ANTHROPIC_API_KEY in .env (or env)
//   - GITHUB_TOKEN env (use `gh auth token` to substitute the expired
//     .env value)

import 'dotenv/config';
import pg from 'pg';
import { triageFeedbackTask } from '../triage.mjs';

const SMOKE_TASK_ID = `wedge1-smoke-${Date.now()}`;
const TENANT = 'dev';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

console.log(`\n=== Wedge 1 smoke test ===`);
console.log(`crm_task_id: ${SMOKE_TASK_ID}`);
console.log(`tenant: ${TENANT}\n`);

console.log('1. Inserting synthetic BUG row...');
const inserted = await pool.query(
  `INSERT INTO mcp_feedback_tasks (
     tenant, crm_task_id, channel_id, channel_name, title, description,
     type, status, priority,
     reporter_name, reporter_email, planner_status,
     created_at, updated_at
   ) VALUES ($1, $2, $3, $4, $5, $6, 'BUG', 'todo', 'medium', $7, $8, 'pending', NOW(), NOW())
   RETURNING id`,
  [
    TENANT,
    SMOKE_TASK_ID,
    'wedge1-smoke-channel',
    'wedge1-smoke',
    '[wedge1-smoke] Tenant middleware logs PII in error path',
    'When the TenantMiddleware is invoked without a tenant header on a /portal route, the error path logs the entire request body — including any auth headers if they were present. This appears to happen in CRMBackend. Should redact sensitive headers and avoid logging the raw body. Reported during a security review of dev logs.',
    'wedge1-smoke',
    'smoke@dev.test',
  ],
);
const taskId = inserted.rows[0].id;
console.log(`   Row id: ${taskId}`);

console.log('\n2. Running triageFeedbackTask...');
const start = Date.now();
let result;
try {
  result = await triageFeedbackTask(taskId, pool);
} catch (err) {
  console.error('   FAILED:', err.message);
  console.error('\nDebug — final row state:');
  const failRow = await pool.query(
    `SELECT planner_status, planner_error, state
       FROM mcp_feedback_tasks WHERE id = $1`,
    [taskId],
  );
  console.error(JSON.stringify(failRow.rows[0], null, 2));
  await pool.end();
  process.exit(1);
}
const elapsed = ((Date.now() - start) / 1000).toFixed(1);
console.log(`   Done in ${elapsed}s. Result:`);
console.log(`   ${JSON.stringify(result, null, 2).replace(/\n/g, '\n   ')}`);

console.log('\n3. Final row state:');
const final = await pool.query(
  `SELECT state, planner_status, planner_decision, scope, planner_confidence,
          LENGTH(synthesized_bug_md) AS bug_len,
          LENGTH(acceptance_md)      AS accept_len,
          LENGTH(proposed_fix_md)    AS fix_len,
          LENGTH(test_stub_md)       AS test_len,
          skip_reason, planner_error
     FROM mcp_feedback_tasks WHERE id = $1`,
  [taskId],
);
console.log(`   ${JSON.stringify(final.rows[0], null, 2).replace(/\n/g, '\n   ')}`);

console.log('\n4. Projected GitHub issues:');
const issues = await pool.query(
  `SELECT repo, issue_number, issue_url, sync_status
     FROM mcp_feedback_task_issues
    WHERE feedback_task_id = $1
    ORDER BY repo`,
  [taskId],
);
if (issues.rowCount === 0) {
  console.log('   (none — was scope=skip?)');
} else {
  for (const r of issues.rows) {
    console.log(`   - ${r.repo} #${r.issue_number} — ${r.issue_url} (${r.sync_status})`);
  }
}

console.log('\n=== Smoke test complete ===');
console.log(`Cleanup:`);
console.log(`  DELETE FROM mcp_feedback_task_issues WHERE feedback_task_id = '${taskId}';`);
console.log(`  DELETE FROM mcp_feedback_tasks      WHERE id              = '${taskId}';`);
console.log(`Plus close the GitHub issues listed above.\n`);

await pool.end();

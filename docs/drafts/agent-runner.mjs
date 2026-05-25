#!/usr/bin/env node
// scripts/agent-runner.mjs
//
// Wedge 2 + 3 orchestrator. Called from the two GitHub Actions
// workflows (agent-implement.yml, agent-review.yml) as
// `node scripts/agent-runner.mjs <subcommand>`.
//
// Subcommands:
//   parse              - read issue body (from env), emit GH outputs
//                        CRM_TASK_ID, TENANT, SCOPE, ATTEMPT, AGENT_BRANCH
//   parse-from-branch  - same but starting from AGENT_BRANCH (review path)
//   commit-test        - extract pre-written test from issue, commit to branch
//   run-implementer    - invoke Claude Code with implementer prompt
//   run-reviewer       - invoke Claude Code with reviewer prompt, write report
//   open-pr            - on PASS: gh pr create against dev with report body
//   mark-blocked       - on FAIL: comment + label issue
//
// Inputs come from env vars (set by the workflow) and stdin where applicable.
// Outputs go to $GITHUB_OUTPUT and stdout.
//
// !!! BEFORE SHIPPING:
//   - Verify the `claude-code` CLI flags below against the installed
//     version. The CLI interface is evolving; flags like
//     --allowed-tools and --system-prompt-file may need adjustment.
//   - Confirm the issue-body parsing regex matches what triage.mjs
//     emits (renderIssueBody in AgentBoxDev/triage.mjs).

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';

// =====================================================================
// Helpers
// =====================================================================

const env = process.env;
const ARTIFACTS_DIR = 'artifacts';

if (!existsSync(ARTIFACTS_DIR)) mkdirSync(ARTIFACTS_DIR, { recursive: true });

function setOutput(key, value) {
  const file = env.GITHUB_OUTPUT;
  if (!file) {
    console.log(`(no GITHUB_OUTPUT) ${key}=${value}`);
    return;
  }
  // Multi-line safe via heredoc syntax
  const delim = `EOF_${Math.random().toString(36).slice(2, 10)}`;
  const line = `${key}<<${delim}\n${value}\n${delim}\n`;
  writeFileSync(file, line, { flag: 'a' });
}

function exportEnv(key, value) {
  const file = env.GITHUB_ENV;
  if (!file) {
    console.log(`(no GITHUB_ENV) ${key}=${value}`);
    return;
  }
  const delim = `EOF_${Math.random().toString(36).slice(2, 10)}`;
  writeFileSync(file, `${key}<<${delim}\n${value}\n${delim}\n`, { flag: 'a' });
}

function sh(cmd, { check = true, captureStderr = true } = {}) {
  try {
    return execSync(cmd, {
      encoding: 'utf-8',
      stdio: captureStderr ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'inherit'],
    });
  } catch (err) {
    if (!check) return '';
    throw err;
  }
}

function gh(args, body = null) {
  const result = spawnSync('gh', args, {
    encoding: 'utf-8',
    input: body || undefined,
    env: { ...env, GH_TOKEN: env.GH_TOKEN },
  });
  if (result.status !== 0) {
    throw new Error(`gh ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout;
}

// =====================================================================
// Issue body parsing
// =====================================================================

/**
 * Parse the trailer comment that triage.mjs (renderIssueBody) emits:
 *   <!-- agentbox-sync: tenant=<slug> crm_task_id=<id> -->
 */
function parseTrailer(body) {
  const m = body.match(/<!--\s*agentbox-sync:\s*tenant=(\S+)\s+crm_task_id=(\S+)\s*-->/);
  if (!m) throw new Error('agentbox-sync trailer not found in issue body');
  return { tenant: m[1], crmTaskId: m[2] };
}

/**
 * Extract the pre-written test code from issue body. Triage's
 * renderIssueBody puts test_stub_md under "## Pre-written test"
 * wrapped in a ```ts code fence.
 */
function extractTestStub(body) {
  const section = body.match(/##\s+Pre-written test[\s\S]*?```ts\n([\s\S]*?)```/);
  if (!section) throw new Error('Pre-written test section not found');
  return section[1];
}

/**
 * Read the issue's labels to determine scope.
 */
function scopeFromLabels(labels) {
  // Labels look like: agent-eligible, tenant:dev, area:auth, type:bug, priority:medium, paired
  const arr = Array.isArray(labels) ? labels : JSON.parse(labels);
  const names = arr.map((l) => (typeof l === 'string' ? l : l.name));
  if (names.includes('paired')) return 'both';
  // Single-repo scope is inferred from which repo this workflow runs in.
  // Workflows know their own repo via GITHUB_REPOSITORY env.
  const repo = (env.GITHUB_REPOSITORY || '').split('/')[1];
  if (repo === 'CRMFrontEnd') return 'fe';
  if (repo === 'CRMBackend') return 'be';
  throw new Error(`Cannot infer scope from repo: ${repo}`);
}

/**
 * Determine the next attempt number by counting existing
 * agent/<crmTaskId>-attempt-N branches on origin.
 */
function nextAttempt(crmTaskId) {
  const branches = sh(
    `git ls-remote --heads origin "agent/${crmTaskId}-attempt-*"`,
    { check: false },
  );
  const nums = (branches.match(/agent\/[^-]+-attempt-(\d+)/g) || [])
    .map((s) => parseInt(s.match(/attempt-(\d+)/)[1], 10));
  return (nums.length === 0 ? 0 : Math.max(...nums)) + 1;
}

// =====================================================================
// Subcommands
// =====================================================================

function cmdParse() {
  const body = env.WORK_ITEM_ISSUE_BODY;
  if (!body) throw new Error('WORK_ITEM_ISSUE_BODY env var is required');

  const { tenant, crmTaskId } = parseTrailer(body);
  const scope = scopeFromLabels(env.WORK_ITEM_LABELS);
  const attempt = nextAttempt(crmTaskId);
  const branch = `agent/${crmTaskId}-attempt-${attempt}`;

  setOutput('CRM_TASK_ID', crmTaskId);
  setOutput('TENANT', tenant);
  setOutput('SCOPE', scope);
  setOutput('ATTEMPT', String(attempt));
  setOutput('AGENT_BRANCH', branch);

  console.log(`parse: tenant=${tenant} crm_task_id=${crmTaskId} scope=${scope} attempt=${attempt}`);
}

function cmdParseFromBranch() {
  const branch = env.AGENT_BRANCH;
  if (!branch) throw new Error('AGENT_BRANCH env var is required');

  // agent/<crm_task_id>-attempt-<N>
  const m = branch.match(/^agent\/(.+)-attempt-(\d+)$/);
  if (!m) throw new Error(`Invalid agent branch: ${branch}`);
  const [, crmTaskId, attempt] = m;

  // Find the source issue: title prefix `[TENANT][crm_task_id]`
  const issueListJson = gh([
    'issue', 'list',
    '--repo', env.GITHUB_REPOSITORY,
    '--state', 'open',
    '--search', `in:title "[${crmTaskId}]"`,
    '--json', 'number,url,body,labels',
    '--limit', '5',
  ]);
  const issues = JSON.parse(issueListJson);
  if (issues.length === 0) {
    throw new Error(`No open issue found for crm_task_id=${crmTaskId}`);
  }
  const issue = issues[0];

  const { tenant } = parseTrailer(issue.body);
  const scope = scopeFromLabels(issue.labels);

  setOutput('CRM_TASK_ID', crmTaskId);
  setOutput('TENANT', tenant);
  setOutput('SCOPE', scope);
  setOutput('ATTEMPT', attempt);
  setOutput('ISSUE_NUMBER', String(issue.number));
  setOutput('ISSUE_URL', issue.url);

  // Persist the issue body to a file so subsequent steps can read it
  // without an extra gh call.
  writeFileSync(join(ARTIFACTS_DIR, 'source-issue.json'), JSON.stringify(issue, null, 2));

  console.log(`parse-from-branch: tenant=${tenant} crm_task_id=${crmTaskId} scope=${scope} attempt=${attempt} issue=#${issue.number}`);
}

function cmdCommitTest() {
  const body = env.WORK_ITEM_ISSUE_BODY;
  const crmTaskId = env.CRM_TASK_ID;
  if (!body || !crmTaskId) {
    throw new Error('WORK_ITEM_ISSUE_BODY + CRM_TASK_ID required');
  }

  const testCode = extractTestStub(body);

  // Convention from build plan §3.4 and triage.system.md:
  //   FE: tests/e2e/feedback-<crm_task_id>.spec.ts
  //   BE: test/e2e/feedback-<crm_task_id>.e2e-spec.ts
  // Decide based on repo. Workflow is per-repo so GITHUB_REPOSITORY is reliable.
  const repo = (env.GITHUB_REPOSITORY || '').split('/')[1];
  const isFE = repo === 'CRMFrontEnd';
  const testPath = isFE
    ? `tests/e2e/feedback-${crmTaskId}.spec.ts`
    : `test/e2e/feedback-${crmTaskId}.e2e-spec.ts`;

  // Make sure the directory exists
  const dir = testPath.substring(0, testPath.lastIndexOf('/'));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  writeFileSync(testPath, testCode);

  // Lock the file: write a pre-commit hook that hashes it and refuses
  // commits that modify it. (The implementer prompt has the rule;
  // this is belt-and-suspenders enforcement.)
  const hash = sh(`git hash-object "${testPath}"`).trim();
  const hookDir = '.git/hooks';
  if (!existsSync(hookDir)) mkdirSync(hookDir, { recursive: true });
  const hookPath = join(hookDir, 'pre-commit');
  writeFileSync(
    hookPath,
    `#!/bin/sh\n` +
    `# Auto-installed by agent-runner.mjs — pins the pre-written test file.\n` +
    `PINNED_FILE="${testPath}"\n` +
    `PINNED_HASH="${hash}"\n` +
    `if git diff --cached --name-only | grep -qx "$PINNED_FILE"; then\n` +
    `  CURRENT_HASH=$(git hash-object "$PINNED_FILE" 2>/dev/null || echo "")\n` +
    `  if [ "$CURRENT_HASH" != "$PINNED_HASH" ]; then\n` +
    `    echo "ERROR: agent cannot modify the pre-written test ($PINNED_FILE)" >&2\n` +
    `    exit 1\n` +
    `  fi\n` +
    `fi\n`,
    { mode: 0o755 },
  );

  // Commit the test (under the App identity, set by the workflow git config)
  sh(`git add "${testPath}"`);
  sh(`git commit -m "test(${crmTaskId}): commit pre-written acceptance test from triage"`);

  console.log(`commit-test: wrote ${testPath} (sha=${hash.slice(0, 8)}) and committed.`);
}

// ---------------------------------------------------------------------
// Claude Code invocation
// ---------------------------------------------------------------------
// !!! VERIFY THESE FLAGS against the installed @anthropic-ai/claude-code
// version. The CLI is evolving; these are the v0 placeholders.
// ---------------------------------------------------------------------

function cmdRunImplementer() {
  const { CRM_TASK_ID, TENANT, SCOPE, ATTEMPT, AGENT_BRANCH, ISSUE_URL } = env;
  if (!CRM_TASK_ID) throw new Error('CRM_TASK_ID required');

  const promptPath = '.claude/agent-prompts/implementer.system.md';
  if (!existsSync(promptPath)) {
    throw new Error(`Implementer prompt not vendored at ${promptPath}. Run scripts/sync-agent-prompts.mjs.`);
  }

  // Build the user-turn message with all the context the prompt expects.
  const userMessage = [
    '# Work item context',
    '',
    `work_item_id: (look up from mcp_feedback_tasks via crm_task_id)`,
    `crm_task_id: ${CRM_TASK_ID}`,
    `tenant: ${TENANT}`,
    `scope: ${SCOPE}`,
    `attempt: ${ATTEMPT}`,
    `agent_branch: ${AGENT_BRANCH}`,
    `issue_url: ${ISSUE_URL}`,
    '',
    '# Issue body (the spec)',
    '',
    env.WORK_ITEM_ISSUE_BODY || '(issue body not passed via env; gh issue view fallback)',
  ].join('\n');

  const messageFile = join(ARTIFACTS_DIR, 'implementer-input.md');
  writeFileSync(messageFile, userMessage);

  // Invoke. The CLI runs in the current workspace; --output-format text
  // for now so we get readable logs. Tool permissions broad enough to
  // edit code + run tests but no general network egress.
  const result = spawnSync(
    'claude-code',
    [
      '--system-prompt-file', promptPath,
      '--allowed-tools', 'Read,Edit,Write,Bash,Grep,Glob,WebFetch',
      '--max-turns', '40',
      '--output-format', 'text',
      '--input-file', messageFile,
    ],
    { stdio: 'inherit', env },
  );

  if (result.status !== 0) {
    throw new Error(`Implementer agent exited with code ${result.status}`);
  }
}

function cmdRunReviewer() {
  const { CRM_TASK_ID, TENANT, SCOPE, ATTEMPT, AGENT_BRANCH, ISSUE_URL } = env;
  if (!CRM_TASK_ID) throw new Error('CRM_TASK_ID required');

  const promptPath = '.claude/agent-prompts/reviewer.system.md';
  if (!existsSync(promptPath)) {
    throw new Error(`Reviewer prompt not vendored at ${promptPath}. Run scripts/sync-agent-prompts.mjs.`);
  }

  const sourceIssue = JSON.parse(readFileSync(join(ARTIFACTS_DIR, 'source-issue.json'), 'utf-8'));

  const userMessage = [
    '# Work item context',
    '',
    `crm_task_id: ${CRM_TASK_ID}`,
    `tenant: ${TENANT}`,
    `scope: ${SCOPE}`,
    `attempt: ${ATTEMPT}`,
    `agent_branch: ${AGENT_BRANCH}`,
    `issue_url: ${ISSUE_URL}`,
    '',
    '# Issue body (the spec)',
    '',
    sourceIssue.body,
    '',
    '# Your task',
    '',
    'Run the three checks. Write the structured report to artifacts/reviewer-report.md.',
    'On the last line of stdout, emit exactly one of:',
    '  REVIEWER_VERDICT=pass',
    '  REVIEWER_VERDICT=fail',
  ].join('\n');

  const messageFile = join(ARTIFACTS_DIR, 'reviewer-input.md');
  writeFileSync(messageFile, userMessage);

  const result = spawnSync(
    'claude-code',
    [
      '--system-prompt-file', promptPath,
      '--allowed-tools', 'Read,Bash,Grep,Glob',
      '--max-turns', '30',
      '--output-format', 'text',
      '--input-file', messageFile,
    ],
    { encoding: 'utf-8', env },
  );
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');

  if (result.status !== 0) {
    throw new Error(`Reviewer agent exited with code ${result.status}`);
  }

  // Parse the verdict from the last meaningful line of stdout
  const lines = (result.stdout || '').trim().split('\n');
  const verdictLine = [...lines].reverse().find((l) => /^REVIEWER_VERDICT=/.test(l.trim()));
  if (!verdictLine) {
    throw new Error('Reviewer did not emit REVIEWER_VERDICT line');
  }
  const verdict = verdictLine.split('=')[1].trim();

  exportEnv('REVIEWER_VERDICT', verdict);
  exportEnv('REVIEWER_REPORT_FILE', 'artifacts/reviewer-report.md');
  console.log(`reviewer verdict: ${verdict}`);
}

function cmdOpenPr() {
  const reportPath = 'artifacts/reviewer-report.md';
  if (!existsSync(reportPath)) {
    throw new Error(`Reviewer report not found at ${reportPath}`);
  }
  const body = readFileSync(reportPath, 'utf-8');

  const { CRM_TASK_ID, TENANT, ATTEMPT, AGENT_BRANCH } = env;
  const title = `[agent][${TENANT}][${CRM_TASK_ID}] (attempt ${ATTEMPT}) → dev`;

  gh([
    'pr', 'create',
    '--base', 'dev',
    '--head', AGENT_BRANCH,
    '--title', title,
    '--body-file', reportPath,
  ]);

  console.log(`open-pr: created PR for ${AGENT_BRANCH} against dev`);
}

function cmdMarkBlocked() {
  const { CRM_TASK_ID, ATTEMPT } = env;
  // Find the source issue from the branch name
  const branch = env.AGENT_BRANCH || env.GITHUB_REF_NAME || '';
  const m = branch.match(/^agent\/(.+)-attempt-(\d+)$/);
  const crmTaskId = (m && m[1]) || CRM_TASK_ID;
  if (!crmTaskId) throw new Error('Cannot determine crm_task_id to mark blocked');

  const issueListJson = gh([
    'issue', 'list',
    '--repo', env.GITHUB_REPOSITORY,
    '--state', 'open',
    '--search', `in:title "[${crmTaskId}]"`,
    '--json', 'number',
    '--limit', '5',
  ]);
  const issues = JSON.parse(issueListJson);
  if (issues.length === 0) {
    console.warn(`No open issue for crm_task_id=${crmTaskId} — nothing to label.`);
    return;
  }

  const runUrl =
    env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
      ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
      : '(run url unavailable)';

  const body = [
    `## Agent attempt ${ATTEMPT || '?'} — BLOCKED`,
    '',
    `The reviewer agent could not approve the implementer's changes, or the implementer hit a hard blocker.`,
    '',
    `**Run:** ${runUrl}`,
    `**Branch:** \`${branch}\``,
    '',
    `A human picks up from here. To re-trigger, comment \`/rework\` on this issue (Wedge 4).`,
  ].join('\n');

  for (const issue of issues) {
    gh([
      'issue', 'comment', String(issue.number),
      '--repo', env.GITHUB_REPOSITORY,
      '--body', body,
    ]);
    gh([
      'issue', 'edit', String(issue.number),
      '--repo', env.GITHUB_REPOSITORY,
      '--add-label', 'state:blocked-needs-human',
    ]);
  }

  console.log(`mark-blocked: labeled issue(s) ${issues.map((i) => '#' + i.number).join(', ')}`);
}

// =====================================================================
// Dispatch
// =====================================================================

const subcommand = process.argv[2];
const commands = {
  'parse':             cmdParse,
  'parse-from-branch': cmdParseFromBranch,
  'commit-test':       cmdCommitTest,
  'run-implementer':   cmdRunImplementer,
  'run-reviewer':      cmdRunReviewer,
  'open-pr':           cmdOpenPr,
  'mark-blocked':      cmdMarkBlocked,
};

if (!commands[subcommand]) {
  console.error(`Unknown subcommand: ${subcommand}`);
  console.error(`Available: ${Object.keys(commands).join(', ')}`);
  process.exit(2);
}

try {
  await commands[subcommand]();
} catch (err) {
  console.error(`agent-runner ${subcommand} failed: ${err.message}`);
  if (err.stack) console.error(err.stack);
  process.exit(1);
}

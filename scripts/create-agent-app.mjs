#!/usr/bin/env node
// scripts/create-agent-app.mjs
//
// One-shot helper that creates the `boxai-self-repair-agent` GitHub App
// for DAAITeam via the App Manifest flow, then stashes the resulting
// credentials in:
//   - GCP Secret Manager (project: agentbox-485618)
//   - GitHub Actions secrets in DAAITeam/CRMBackend + DAAITeam/CRMFrontEnd
//
// Flow:
//   1. Start a localhost server on PORT (default 8765)
//   2. Open http://localhost:PORT in your browser
//   3. Page auto-submits a pre-filled manifest to github.com
//   4. You click "Create GitHub App for boxai-self-repair-agent" once
//   5. GitHub redirects back to /callback with a temporary code
//   6. Script exchanges code -> App ID + private PEM + secrets
//   7. Script writes credentials to GCP + Actions secrets
//   8. Script prints the install URL — you click it to install on the
//      two CRM repos
//
// Usage:
//   node scripts/create-agent-app.mjs
//
// Prerequisites:
//   - `gh` CLI authenticated (gh auth status)
//   - `gcloud` CLI authenticated (gcloud auth list) with access to
//     project agentbox-485618
//   - You're logged into github.com as a DAAITeam org owner in the
//     browser this script opens

import express from 'express';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
// (no fs/os/path imports needed)

// ─── Config ─────────────────────────────────────────────────────────────
const ORG = 'DAAITeam';
const APP_NAME = 'boxai-self-repair-agent';
const PORT = Number(process.env.PORT || 8765);
const REDIRECT_URL = `http://localhost:${PORT}/callback`;
const GCP_PROJECT = 'agentbox-485618';
const CRM_REPOS = [`${ORG}/CRMBackend`, `${ORG}/CRMFrontEnd`];

// Webhook URL: AgentBoxDev Cloud Run (where triage / agent intake live)
const WEBHOOK_URL = 'https://mcp-server-aj37mp5t6a-uc.a.run.app/webhooks/github';

// Per ADR 0001
const MANIFEST = {
  name: APP_NAME,
  url: `https://github.com/${ORG}`,
  description:
    'Self-repair pipeline agent. Triages tenant-reported bugs, opens issues, ' +
    'and opens PRs against `dev` after implementer + reviewer agents run in ' +
    'GitHub Actions.',
  public: false,
  redirect_url: REDIRECT_URL,
  callback_urls: [REDIRECT_URL],
  hook_attributes: {
    url: WEBHOOK_URL,
    active: true,
  },
  default_permissions: {
    contents: 'write',
    pull_requests: 'write',
    issues: 'write',
    metadata: 'read',
    actions: 'read',
  },
  default_events: ['issues', 'pull_request', 'push'],
};

const STATE = crypto.randomBytes(16).toString('hex');

// ─── Helpers ────────────────────────────────────────────────────────────

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...opts,
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function shWithInput(cmd, args, input) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf-8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function logStep(msg) {
  console.log(`\n→ ${msg}`);
}

function logOk(msg) {
  console.log(`  ✓ ${msg}`);
}

function logFail(msg) {
  console.log(`  ✗ ${msg}`);
}

// Write (or update) a GCP secret. Returns true on success.
function writeGcpSecret(name, value) {
  // Try add a new version; if the secret doesn't exist yet, create it.
  let r = shWithInput(
    'gcloud',
    [
      'secrets', 'versions', 'add', name,
      '--data-file=-',
      '--project', GCP_PROJECT,
    ],
    value,
  );
  if (r.code === 0) return true;

  // Not-found → create
  if (/NOT_FOUND|does not exist/i.test(r.err)) {
    r = shWithInput(
      'gcloud',
      [
        'secrets', 'create', name,
        '--data-file=-',
        '--replication-policy', 'automatic',
        '--project', GCP_PROJECT,
      ],
      value,
    );
    if (r.code === 0) return true;
  }

  logFail(`gcloud secret ${name}: ${r.err.trim().split('\n').slice(-3).join(' | ')}`);
  return false;
}

// Write a GitHub Actions secret to a repo via gh CLI (handles encryption).
// `gh secret set NAME --repo R` with no --body flag reads value from stdin.
function writeActionsSecret(repo, name, value) {
  const r = shWithInput(
    'gh',
    ['secret', 'set', name, '--repo', repo],
    value,
  );
  if (r.code === 0) return true;
  logFail(`gh secret ${repo}:${name}: ${r.err.trim().split('\n').slice(-3).join(' | ')}`);
  return false;
}

function openBrowser(url) {
  // macOS
  spawnSync('open', [url], { stdio: 'ignore' });
}

// ─── HTTP server ────────────────────────────────────────────────────────

const app = express();

// Step 1: serve the auto-submitting form
app.get('/', (req, res) => {
  const manifestJson = JSON.stringify(MANIFEST);
  const manifestEscaped = manifestJson
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const formAction = `https://github.com/organizations/${ORG}/settings/apps/new?state=${STATE}`;

  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Create ${APP_NAME}</title>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 640px; margin: 80px auto; padding: 0 24px; color: #1f2328; }
    h1 { font-weight: 600; margin-bottom: 16px; }
    pre { background: #f6f8fa; padding: 16px; border-radius: 6px; overflow-x: auto; font-size: 12px; }
    .perms { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; margin: 12px 0; }
    .perms div { font-size: 13px; }
    button { background: #1f883d; color: white; border: 0; padding: 10px 16px; border-radius: 6px; cursor: pointer; font-size: 14px; }
    .muted { color: #656d76; font-size: 13px; }
  </style>
</head>
<body>
  <h1>Submitting manifest to GitHub…</h1>
  <p class="muted">If this doesn't redirect automatically, click the button.</p>
  <p>App: <code>${APP_NAME}</code> in <code>${ORG}</code></p>
  <p>Permissions:</p>
  <div class="perms">
    ${Object.entries(MANIFEST.default_permissions)
      .map(([k, v]) => `<div>${k}: <strong>${v}</strong></div>`)
      .join('')}
  </div>
  <p>Webhook: <code>${WEBHOOK_URL}</code></p>
  <form id="f" method="post" action="${formAction}">
    <input type="hidden" name="manifest" value="${manifestEscaped}">
    <button type="submit">Send manifest to GitHub →</button>
  </form>
  <script>setTimeout(() => document.getElementById('f').submit(), 400);</script>
</body>
</html>`);
});

// Step 2: receive the callback after Chris clicks "Create"
app.get('/callback', async (req, res) => {
  const { code, state } = req.query;

  if (!code || state !== STATE) {
    res.status(400).send('Invalid state or missing code. Restart the helper and try again.');
    logFail('Callback state mismatch — aborting.');
    setTimeout(() => process.exit(1), 100);
    return;
  }

  logStep('Exchanging manifest code for App credentials…');

  let conv;
  try {
    const resp = await fetch(
      `https://api.github.com/app-manifests/${code}/conversions`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'agentbox-self-repair-bootstrap',
        },
      },
    );
    if (!resp.ok) {
      throw new Error(`${resp.status} ${resp.statusText}: ${await resp.text()}`);
    }
    conv = await resp.json();
  } catch (err) {
    logFail(`Conversion failed: ${err.message}`);
    res.status(500).send(`Conversion failed: ${err.message}. Check the helper's terminal.`);
    setTimeout(() => process.exit(1), 100);
    return;
  }

  logOk(`Created App #${conv.id} (${conv.slug}) → ${conv.html_url}`);

  // ── Stash credentials ─────────────────────────────────────────────────
  logStep('Writing credentials to GCP Secret Manager…');
  const gcpResults = {
    'mcp-github-app-id': writeGcpSecret('mcp-github-app-id', String(conv.id)),
    'mcp-github-app-private-key': writeGcpSecret('mcp-github-app-private-key', conv.pem),
    'mcp-github-app-client-id': writeGcpSecret('mcp-github-app-client-id', conv.client_id),
    'mcp-github-app-client-secret': writeGcpSecret('mcp-github-app-client-secret', conv.client_secret),
    'mcp-github-app-webhook-secret': writeGcpSecret('mcp-github-app-webhook-secret', conv.webhook_secret || ''),
  };
  for (const [k, ok] of Object.entries(gcpResults)) {
    if (ok) logOk(`GCP: ${k}`);
  }

  logStep('Writing AGENT_GH_APP_ID + AGENT_GH_APP_PRIVATE_KEY to Actions secrets…');
  for (const repo of CRM_REPOS) {
    const ok1 = writeActionsSecret(repo, 'AGENT_GH_APP_ID', String(conv.id));
    const ok2 = writeActionsSecret(repo, 'AGENT_GH_APP_PRIVATE_KEY', conv.pem);
    if (ok1) logOk(`${repo}: AGENT_GH_APP_ID`);
    if (ok2) logOk(`${repo}: AGENT_GH_APP_PRIVATE_KEY`);
  }

  // ── Done page ─────────────────────────────────────────────────────────
  const installUrl = `${conv.html_url}/installations/new`;
  res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>App created</title>
<style>body { font-family: -apple-system, sans-serif; max-width: 640px; margin: 80px auto; padding: 0 24px; }
a.btn { display: inline-block; background: #1f883d; color: white; padding: 10px 16px; border-radius: 6px; text-decoration: none; }
code { background: #f6f8fa; padding: 2px 6px; border-radius: 4px; }</style></head>
<body>
<h1>✓ GitHub App created</h1>
<p>App: <code>${conv.slug}</code> (id <code>${conv.id}</code>)</p>
<p>Credentials written to GCP Secret Manager + Actions secrets on CRMBackend &amp; CRMFrontEnd.</p>
<p><strong>Last step:</strong> install it on the two repos.</p>
<p><a class="btn" href="${installUrl}" target="_blank">Install on CRMBackend + CRMFrontEnd →</a></p>
<p>Pick "Only select repositories" and tick both <code>CRMBackend</code> and <code>CRMFrontEnd</code>.</p>
<p>You can close this tab once the install finishes.</p>
</body></html>`);

  logStep('Done. Visit this URL to install on the two CRM repos:');
  console.log(`  ${installUrl}\n`);
  console.log('After installation, fetch the installation IDs (one per repo):');
  console.log(`  gh api /repos/${ORG}/CRMBackend/installation --jq .id`);
  console.log(`  gh api /repos/${ORG}/CRMFrontEnd/installation --jq .id`);
  console.log(`  # then: echo -n "<id>" | gcloud secrets versions add mcp-github-app-installation-id-crmbackend --data-file=- --project=${GCP_PROJECT}`);
  console.log('');

  setTimeout(() => process.exit(0), 200);
});

// ─── Start ──────────────────────────────────────────────────────────────

const server = app.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n${APP_NAME} bootstrap helper`);
  console.log('─'.repeat(50));
  console.log(`Listening on ${url}`);
  console.log(`Opening browser… (if it doesn't open, paste the URL manually)\n`);
  openBrowser(url);
});

// Safety: auto-shutdown after 10 minutes
setTimeout(() => {
  console.log('\nTimed out after 10 minutes. Re-run if needed.');
  server.close();
  process.exit(1);
}, 10 * 60 * 1000);

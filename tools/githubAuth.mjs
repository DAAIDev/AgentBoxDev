// tools/githubAuth.mjs
//
// GitHub auth helper. Resolves a bearer token for GitHub API calls,
// preferring App-installation tokens when configured.
//
// Auth modes (in priority order):
//   1. GitHub App: GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY + GITHUB_APP_INSTALLATION_ID
//      → mint a JWT, exchange for an installation token, cache until ~1m before expiry
//   2. PAT: GITHUB_TOKEN
//      → returned as-is (no caching needed)
//
// Used by tools/github.mjs (triage worker) and server.js callGitHub (kanban sync,
// dashboard endpoints). One source of truth for "how do we hit the GitHub API."

import crypto from 'node:crypto';

let cached = null; // { token, expiresAtMs }

function nowMs() { return Date.now(); }

function makeAppJwt(appId, pem) {
  const now = Math.floor(nowMs() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const signing = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({
    iat: now - 60,
    exp: now + 540,
    iss: appId,
  });
  const sig = crypto.sign('RSA-SHA256', Buffer.from(signing), pem).toString('base64url');
  return signing + '.' + sig;
}

async function mintInstallationToken(appId, pem, installationId) {
  const jwt = makeAppJwt(appId, pem);
  const resp = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'agentbox-dev',
      },
    },
  );
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Failed to mint installation token: ${resp.status} ${body.slice(0, 200)}`);
  }
  const json = await resp.json();
  return {
    token: json.token,
    expiresAtMs: new Date(json.expires_at).getTime(),
  };
}

/**
 * Resolve a bearer token for GitHub API calls.
 * Throws if neither App credentials nor a PAT are configured.
 *
 * @returns {Promise<string>}
 */
export async function getGitHubToken() {
  const appId = process.env.GITHUB_APP_ID;
  const pem = process.env.GITHUB_APP_PRIVATE_KEY;
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID;

  if (appId && pem && installationId) {
    // Refresh ~60s before expiry to avoid clock-skew races.
    if (cached && cached.expiresAtMs - nowMs() > 60_000) {
      return cached.token;
    }
    cached = await mintInstallationToken(appId, pem, installationId);
    return cached.token;
  }

  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }

  throw new Error(
    'GitHub auth not configured: set GITHUB_APP_{ID,PRIVATE_KEY,INSTALLATION_ID} ' +
    'or GITHUB_TOKEN',
  );
}

/**
 * For tests / diagnostics: force the next getGitHubToken() to re-mint.
 */
export function clearGitHubTokenCache() {
  cached = null;
}

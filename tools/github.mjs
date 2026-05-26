// tools/github.mjs
//
// GitHub tool wrappers for the triage worker.
//   - ghSearchCode(repo, query) — code search in a DAAITeam repo
//   - ghGetFile(repo, path, ref?) — fetch file content (truncated for huge files)
//   - GH_SEARCH_CODE_TOOL / GH_GET_FILE_TOOL — Anthropic tool definitions
//   - runTool(name, input) — dispatcher (returns JSON string for tool_result)
//
// Auth resolved via tools/githubAuth.getGitHubToken() — supports either a
// GitHub App installation token (preferred) or a PAT fallback.
//
// Repos allow-listed to CRMBackend and CRMFrontEnd. Org pinned to DAAITeam.

import { getGitHubToken } from './githubAuth.mjs';

const GITHUB_API = 'https://api.github.com';
const GITHUB_ORG = 'DAAITeam';
const ALLOWED_REPOS = ['CRMBackend', 'CRMFrontEnd'];
const REQUEST_TIMEOUT_MS = 15000;
const MAX_FILE_LINES = 800; // truncate huge files to keep Claude's context manageable
const SEARCH_PAGE_SIZE = 30;

async function callGitHub(path, params = {}, { method = 'GET', body, accept = 'application/vnd.github+json' } = {}) {
  const token = await getGitHubToken();

  const url = new URL(`${GITHUB_API}${path}`);
  if (method === 'GET') {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const resp = await fetch(url.toString(), {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': accept,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.message || `GitHub API returned HTTP ${resp.status}`);
    }
    if (resp.status === 204) return null;
    return resp.json();
  } finally {
    clearTimeout(timeout);
  }
}

function validateRepo(repo) {
  if (!ALLOWED_REPOS.includes(repo)) {
    throw new Error(`Invalid repo: ${repo}. Allowed: ${ALLOWED_REPOS.join(', ')}`);
  }
}

/**
 * Search code in a DAAITeam repo. Returns up to 30 matches with file
 * paths and short text snippets. Used by the triage agent to locate
 * files relevant to a reported bug.
 *
 * NOTE: GitHub code search only matches the default branch (typically
 * main). For files only on `dev`, follow up with ghGetFile.
 *
 * @param {string} repo - 'CRMBackend' | 'CRMFrontEnd'
 * @param {string} query - GitHub code-search query
 * @returns {Promise<{ total_count, truncated, items: Array<{path, score, snippets}> }>}
 */
export async function ghSearchCode(repo, query) {
  validateRepo(repo);
  if (typeof query !== 'string' || query.trim().length === 0) {
    throw new Error('query is required and must be non-empty');
  }

  const fullQuery = `${query} repo:${GITHUB_ORG}/${repo}`;

  const result = await callGitHub(
    '/search/code',
    { q: fullQuery, per_page: SEARCH_PAGE_SIZE },
    // text-match accept enables text_matches in the response (the snippets).
    { accept: 'application/vnd.github.text-match+json' },
  );

  return {
    total_count: result.total_count ?? 0,
    truncated: (result.total_count ?? 0) > SEARCH_PAGE_SIZE,
    items: (result.items || []).map((item) => ({
      path: item.path,
      score: item.score,
      snippets: (item.text_matches || [])
        .map((m) => m.fragment)
        .slice(0, 3),
    })),
  };
}

/**
 * Fetch a file's content from a DAAITeam repo at the given ref.
 * Defaults to 'dev' (the agent's working branch base per v0.3.1).
 * Files over MAX_FILE_LINES are truncated with a footer note.
 *
 * @param {string} repo - 'CRMBackend' | 'CRMFrontEnd'
 * @param {string} path - file path from repo root
 * @param {string} [ref='dev'] - branch or commit ref
 * @returns {Promise<{path, ref, sha, size, line_count, truncated, content}>}
 */
export async function ghGetFile(repo, path, ref = 'dev') {
  validateRepo(repo);
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error('path is required');
  }

  // The contents endpoint accepts the path as a URL segment.
  // encodeURIComponent on the whole path would over-escape slashes;
  // split + encode each segment instead.
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');

  const result = await callGitHub(
    `/repos/${GITHUB_ORG}/${repo}/contents/${encodedPath}`,
    { ref },
  );

  if (Array.isArray(result)) {
    throw new Error(`Path is a directory, not a file: ${path}`);
  }

  if (result.encoding !== 'base64' || !result.content) {
    throw new Error(`Unexpected file response shape for ${path}`);
  }

  const decoded = Buffer.from(result.content, 'base64').toString('utf-8');
  const lines = decoded.split('\n');
  const truncated = lines.length > MAX_FILE_LINES;
  const content = truncated
    ? `${lines.slice(0, MAX_FILE_LINES).join('\n')}\n\n... (truncated; file has ${lines.length} lines, showing first ${MAX_FILE_LINES}) ...`
    : decoded;

  return {
    path,
    ref,
    sha: result.sha,
    size: result.size,
    line_count: lines.length,
    truncated,
    content,
  };
}

/**
 * Open a new GitHub issue in a DAAITeam repo.
 * Used by the triage worker AFTER it has decided scope and built the
 * issue body — NOT exposed as a tool to Claude (the agent decides
 * what to write; the worker is what actually opens the issue).
 *
 * @param {string} repo - 'CRMBackend' | 'CRMFrontEnd'
 * @param {{ title: string, body?: string, labels?: string[], assignees?: string[] }} payload
 * @returns {Promise<{ number, url, api_url, state, title, labels, repo, created_at }>}
 */
export async function createGitHubIssue(repo, { title, body, labels, assignees } = {}) {
  validateRepo(repo);
  if (typeof title !== 'string' || title.trim().length === 0) {
    throw new Error('title is required');
  }

  const payload = { title };
  if (body !== undefined && body !== null) payload.body = body;
  if (Array.isArray(labels) && labels.length > 0) payload.labels = labels;
  if (Array.isArray(assignees) && assignees.length > 0) payload.assignees = assignees;

  const issue = await callGitHub(
    `/repos/${GITHUB_ORG}/${repo}/issues`,
    {},
    { method: 'POST', body: payload },
  );

  return {
    number: issue.number,
    url: issue.html_url,
    api_url: issue.url,
    state: issue.state,
    title: issue.title,
    labels: (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name)),
    repo,
    created_at: issue.created_at,
  };
}

/**
 * Anthropic tool definition for gh_search_code.
 * Include in messages.create({ tools }).
 */
export const GH_SEARCH_CODE_TOOL = {
  name: 'gh_search_code',
  description:
    'Search code in a DAAITeam repo (CRMBackend or CRMFrontEnd). Returns up to 30 matching files with paths and short snippets. Use to locate files relevant to a reported bug. Note: GitHub code search only matches the default branch.',
  input_schema: {
    type: 'object',
    properties: {
      repo: {
        type: 'string',
        enum: ALLOWED_REPOS,
        description: 'Which DAAITeam repo to search.',
      },
      query: {
        type: 'string',
        description:
          "Code search query. Supports GitHub code-search syntax (e.g. \"Controller('portal') extension:ts\", \"AccountAccessGuard path:src\").",
      },
    },
    required: ['repo', 'query'],
  },
};

/**
 * Anthropic tool definition for gh_get_file.
 */
export const GH_GET_FILE_TOOL = {
  name: 'gh_get_file',
  description:
    "Fetch the full content of a file from a DAAITeam repo. Defaults to the 'dev' branch. Files over 800 lines are truncated with a footer note. Returns path, sha, line_count, truncated flag, and content.",
  input_schema: {
    type: 'object',
    properties: {
      repo: {
        type: 'string',
        enum: ALLOWED_REPOS,
        description: 'Which DAAITeam repo to fetch from.',
      },
      path: {
        type: 'string',
        description:
          'Relative path from repo root (e.g. "src/portal/billing.controller.ts").',
      },
      ref: {
        type: 'string',
        description: "Branch or commit ref. Defaults to 'dev'.",
      },
    },
    required: ['repo', 'path'],
  },
};

/**
 * Dispatch a tool call from Claude's tool_use block. Returns a string
 * suitable for the tool_result content block. Errors are caught and
 * returned as JSON so the agent can recover instead of crashing.
 *
 * @param {string} name - tool name
 * @param {object} input - tool input from Claude
 * @returns {Promise<string>}
 */
export async function runTool(name, input) {
  try {
    let result;
    if (name === 'gh_search_code') {
      result = await ghSearchCode(input.repo, input.query);
    } else if (name === 'gh_get_file') {
      result = await ghGetFile(input.repo, input.path, input.ref);
    } else {
      throw new Error(`Unknown tool: ${name}`);
    }
    return JSON.stringify(result, null, 2);
  } catch (err) {
    return JSON.stringify({ error: String(err.message || err) });
  }
}

export const TRIAGE_TOOLS = [GH_SEARCH_CODE_TOOL, GH_GET_FILE_TOOL];

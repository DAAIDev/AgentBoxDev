import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import pg from 'pg';
import { Storage } from '@google-cloud/storage';
import nodemailer from 'nodemailer';
import Anthropic from '@anthropic-ai/sdk';
import { google } from 'googleapis';
import admin from 'firebase-admin';

// Firebase Admin SDK for AgentBox Dashboard user management
if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
} else {
  console.warn('[Firebase Admin] Missing credentials — dashboard user management endpoints disabled');
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// PostgreSQL connection pool
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

// GCS client for document storage
const gcs = new Storage();
const GCS_BUCKET = process.env.GCS_BUCKET || 'mcp-documents-agentbox';

// Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Email transporter (Gmail - for sending)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

// Google OAuth client (for Calendar & Gmail API)
function getGoogleAuth() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
  });
  return oauth2Client;
}

// ============ GCP MONITORING AUTH ============
const GCP_PROJECT_ID = 'agentbox-485618';
const GCP_REGION = 'us-central1';

// Cloud Run service name mapping
const TENANT_SERVICE_MAP = {
  dtiq: 'crm-backend-dtiq',
  packetfabric: 'crm-backend-packetfabric',
  element8: 'crm-backend-element8',
  qwilt: 'crm-backend-qwilt',
  welink: 'crm-backend-welink',
  dev: 'crm-backend-dev',
};

let gcpAuth = null;

function getGcpAuth() {
  if (gcpAuth) return gcpAuth;
  const encoded = process.env.GCP_SERVICE_ACCOUNT_JSON;
  if (!encoded) return null;
  try {
    const credentials = JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'));
    gcpAuth = new google.auth.GoogleAuth({
      credentials,
      scopes: [
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/logging.read',
      ],
    });
    return gcpAuth;
  } catch (err) {
    console.error('Failed to initialize GCP auth:', err.message);
    return null;
  }
}

function requireGcpAuth() {
  const auth = getGcpAuth();
  if (!auth) throw new Error('GCP credentials not configured. Set GCP_SERVICE_ACCOUNT_JSON env var.');
  return auth;
}

function getServiceName(tenant) {
  const service = TENANT_SERVICE_MAP[tenant];
  if (!service) throw new Error(`Unknown tenant: ${tenant}. Valid: ${Object.keys(TENANT_SERVICE_MAP).join(', ')}`);
  return service;
}

function extractLogMessage(entry) {
  let message = entry.textPayload || '';
  if (!message && entry.jsonPayload) {
    message = entry.jsonPayload.message
      || entry.jsonPayload.fields?.message?.stringValue
      || entry.jsonPayload.msg
      || JSON.stringify(entry.jsonPayload);
  }
  if (!message && entry.httpRequest) {
    const r = entry.httpRequest;
    message = `${r.requestMethod || 'GET'} ${r.requestUrl || ''} ${r.status || ''}`;
  }
  if (!message && entry.protoPayload) {
    message = entry.protoPayload.methodName || JSON.stringify(entry.protoPayload);
  }
  return message || '(no message)';
}

// ============ CRM INSTANCE CONFIG ============
const CRM_COMPANIES = (process.env.CRM_INSTANCES || 'dtiq,packetfabric,element8,qwilt,welink,dev').split(',');

function getCRMConfig(company) {
  const key = company.toUpperCase().replace(/-/g, '_');
  return {
    url: process.env[`CRM_URL_${key}`],
    apiKey: process.env[`CRM_KEY_${key}`],
    tenantId: company
  };
}

async function callCRM(company, method, path, body) {
  const config = getCRMConfig(company);
  if (!config.url) throw new Error(`No CRM URL configured for ${company}`);
  if (!config.apiKey) throw new Error(`No CRM API key configured for ${company}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const resp = await fetch(`${config.url}/api${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-ID': config.tenantId,
        'X-API-Key': config.apiKey,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.message || `CRM ${company} returned HTTP ${resp.status}`);
    }
    return resp.json();
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error(`CRM ${company} request timed out`);
    throw err;
  }
}

// ============ GITHUB API HELPER ============
const GITHUB_ORG = process.env.GITHUB_ORG || 'DAAITeam';

async function callGitHub(path, params = {}) {
  if (!process.env.GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN not configured');
  }

  const url = new URL(`https://api.github.com${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const resp = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.message || `GitHub API returned HTTP ${resp.status}`);
    }
    return resp.json();
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error('GitHub API request timed out');
    throw err;
  }
}

// ============ DB HELPER ============
async function query(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}

async function queryOne(text, params) {
  const { rows } = await pool.query(text, params);
  return rows[0] || null;
}

async function getCompanyId(slug) {
  const row = await queryOne('SELECT id FROM companies WHERE slug = $1', [slug]);
  if (!row) throw new Error(`Company not found: ${slug}`);
  return row.id;
}

// ============ SYSTEM PROMPT FOR CHAT ============
const SYSTEM_PROMPT = `You are the AI-in-a-Box Dev Dashboard assistant. You help the Digital Alpha team manage AI implementations across their portfolio companies.

You have access to tools that let you:
- View and update company status, milestones, and requirements
- Track dev tasks and assignments
- Manage documents and files (upload, list, read content, delete)
- Track deployments and their components (GitHub, Frontend, MCP Server, Database) with health checks
- Read Gmail inbox and search emails
- View Google Calendar events and meetings
- Send emails and project updates
- View activity logs

Current portfolio companies:
- DTIQ (video surveillance, loss prevention) - Zendesk, Salesforce, ChurnZero
- Element 8 / ATLINK (ISP, wireless broadband) - Powercode, PowerNOC, WISDM, etc
- QWILT (CDN, edge computing) - Slack-based support
- PacketFabric (network connectivity) - ServiceNow
- Welink (ISP, similar to Element 8) - Discovery phase

EMAIL & CALENDAR:
- Use list_emails to search/filter emails, can filter by company contacts
- Use get_email to read full email content
- Use list_calendar_events to see meetings, can filter by company [slug] prefix
- Use create_calendar_event to schedule new meetings
- Calendar events prefixed with [dtiq], [qwilt], etc. are auto-categorized

DOCUMENT HANDLING:
- Use list_all_documents to see what docs exist
- Use get_document_content to read text files (md, txt, json, csv, html, etc)
- For PDFs and images, provide the URL for the user to view
- When asked to summarize a document, first get its content, then summarize

DEPLOYMENT HANDLING:
- Use list_deployments to see all deployments
- Use get_deployment to see a deployment with all its components
- Use check_deployment_health to ping URLs and update status

CRM INSTANCE MANAGEMENT:
- Use list_crm_instances to see all company CRM instances and their config status
- Use get_crm_instance_status to get detailed stats for a specific instance (user count, health)
- Use check_crm_instance_health to health check all instances at once
- Use list_crm_users to search/browse users on any instance
- Use create_crm_user to create a new user account on any instance
- Use update_crm_user_role to change a user's role (admin, manager, agent, customer)
- Use delete_crm_user to remove a user from an instance
- Use reset_crm_user_password to reset a user's password
- Available companies: dtiq, packetfabric, element8, qwilt, welink, dev
- For bulk operations across all instances, call the tool once per company

GITHUB MONITORING:
- Use github_list_repos to see all org repos with stats
- Use github_list_commits to view recent commits (all repos or specific repo)
- Use github_list_prs to see pull requests (open, closed, or all)
- Use github_org_activity for an org-wide activity summary (commits, PRs, top contributors)

Be concise and direct. Use tools to get real data - don't guess.
When you complete an action, confirm what you did.
For sending emails, confirm the recipient and content first.`;

// ============ TOOL DEFINITIONS ============
const tools = [
  {
    name: "list_companies",
    description: "List all portfolio companies with their status and progress",
    inputSchema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "get_company",
    description: "Get full details for a company including milestones, requirements, contacts, and recent activity",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Company slug (dtiq, element8, qwilt, packetfabric, welink)" }
      },
      required: ["slug"]
    }
  },
  {
    name: "update_company_status",
    description: "Update a company's overall status",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Company slug" },
        status: { type: "string", enum: ["discovery", "active", "pilot", "deployed"], description: "New status" }
      },
      required: ["slug", "status"]
    }
  },
  {
    name: "list_milestones",
    description: "List all milestones for a company",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Company slug" }
      },
      required: ["slug"]
    }
  },
  {
    name: "update_milestone",
    description: "Update a milestone's status (mark as done, in progress, blocked, etc.)",
    inputSchema: {
      type: "object",
      properties: {
        milestone_id: { type: "string", description: "Milestone UUID" },
        status: { type: "string", enum: ["pending", "in_progress", "done", "blocked"], description: "New status" },
        notes: { type: "string", description: "Optional notes about the update" }
      },
      required: ["milestone_id", "status"]
    }
  },
  {
    name: "add_milestone",
    description: "Add a new milestone to a company",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Company slug" },
        title: { type: "string", description: "Milestone title" },
        due_date: { type: "string", description: "Optional due date (YYYY-MM-DD)" }
      },
      required: ["slug", "title"]
    }
  },
  {
    name: "add_note",
    description: "Add a note or activity entry for a company (meetings, updates, etc.)",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Company slug" },
        content: { type: "string", description: "Note content" },
        type: { type: "string", enum: ["note", "meeting", "milestone", "document"], description: "Type of activity" }
      },
      required: ["slug", "content"]
    }
  },
  {
    name: "get_recent_activity",
    description: "Get recent activity/notes across all companies or for a specific company",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Optional company slug to filter by" },
        limit: { type: "number", description: "Number of entries to return (default 20)" }
      },
      required: []
    }
  },
  {
    name: "update_requirement",
    description: "Update status of a requirement (what we need from a company)",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Company slug" },
        item: { type: "string", description: "Requirement item name" },
        status: { type: "string", enum: ["needed", "requested", "received"], description: "New status" }
      },
      required: ["slug", "item", "status"]
    }
  },
  {
    name: "add_requirement",
    description: "Add a new requirement for a company",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Company slug" },
        item: { type: "string", description: "Requirement item name" },
        status: { type: "string", enum: ["needed", "requested", "received"], description: "Initial status" }
      },
      required: ["slug", "item"]
    }
  },
  {
    name: "list_documents",
    description: "List all documents for a company",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Company slug" }
      },
      required: ["slug"]
    }
  },
  {
    name: "add_document",
    description: "Register a document for a company (metadata only, no file upload)",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Company slug" },
        name: { type: "string", description: "Document name" },
        type: { type: "string", description: "Document type (handbook, api_docs, ticket_export, guide, etc.)" },
        url: { type: "string", description: "URL or path to document" },
        notes: { type: "string", description: "Optional notes" }
      },
      required: ["slug", "name", "type"]
    }
  },
  {
    name: "add_contact",
    description: "Add a contact person for a company",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Company slug" },
        name: { type: "string", description: "Contact name" },
        role: { type: "string", description: "Role/title" },
        email: { type: "string", description: "Email address" },
        phone: { type: "string", description: "Phone number" }
      },
      required: ["slug", "name"]
    }
  },
  {
    name: "list_contacts",
    description: "List all contacts for a company",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Company slug" }
      },
      required: ["slug"]
    }
  },
  {
    name: "get_portfolio_summary",
    description: "Get high-level summary of all companies with progress percentages",
    inputSchema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "send_email",
    description: "Send an email",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Email subject line" },
        body: { type: "string", description: "Email body (HTML supported)" }
      },
      required: ["to", "subject", "body"]
    }
  },
  {
    name: "send_project_update",
    description: "Generate and send a portfolio status update email. Automatically pulls current data and formats it nicely.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Email subject (optional, will generate default)" },
        include_details: { type: "boolean", description: "Include detailed milestones and requirements (default: false)" }
      },
      required: ["to"]
    }
  },
  // ============ DEV TASKS TOOLS ============
  {
    name: "list_dev_tasks",
    description: "List dev tasks, optionally filtered by status, assignee, or priority",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["todo", "in_progress", "blocked", "done"], description: "Filter by status" },
        assigned_to: { type: "string", description: "Filter by assignee name" },
        priority: { type: "string", enum: ["high", "medium", "low"], description: "Filter by priority" }
      },
      required: []
    }
  },
  {
    name: "add_dev_task",
    description: "Add a new dev task with optional step-by-step instructions",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Task title" },
        description: { type: "string", description: "Task description" },
        assigned_to: { type: "string", description: "Who is responsible" },
        priority: { type: "string", enum: ["high", "medium", "low"], description: "Priority level" },
        steps: { type: "array", items: { type: "string" }, description: "Step-by-step instructions" },
        due_date: { type: "string", description: "Due date (YYYY-MM-DD)" }
      },
      required: ["title"]
    }
  },
  {
    name: "update_dev_task",
    description: "Update a dev task's status, assignee, or priority",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "Task UUID" },
        status: { type: "string", enum: ["todo", "in_progress", "blocked", "done"], description: "New status" },
        assigned_to: { type: "string", description: "New assignee" },
        priority: { type: "string", enum: ["high", "medium", "low"], description: "New priority" }
      },
      required: ["task_id"]
    }
  },
  {
    name: "delete_dev_task",
    description: "Delete a dev task",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "Task UUID" }
      },
      required: ["task_id"]
    }
  },
  // ============ DOCUMENT STORAGE TOOLS ============
  {
    name: "upload_document",
    description: "Upload a document to storage. Accepts base64 encoded file data.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Company slug (dtiq, element8, etc) or 'platform' for shared docs" },
        filename: { type: "string", description: "Filename with extension (e.g., 'architecture.png')" },
        content_base64: { type: "string", description: "Base64 encoded file content" },
        content_type: { type: "string", description: "MIME type (e.g., 'image/png', 'application/pdf', 'text/markdown')" },
        category: { type: "string", enum: ["architecture", "notes", "analysis", "screenshot", "sop", "training", "general"], description: "Document category" },
        description: { type: "string", description: "Optional description" }
      },
      required: ["slug", "filename", "content_base64", "content_type"]
    }
  },
  {
    name: "get_document_content",
    description: "Get the content of a text-based document (md, txt, json, csv, html). For summarizing or reading docs.",
    inputSchema: {
      type: "object",
      properties: {
        document_id: { type: "string", description: "Document UUID" }
      },
      required: ["document_id"]
    }
  },
  {
    name: "list_all_documents",
    description: "List all documents across all companies or for a specific company",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Optional: filter by company slug, or 'platform' for shared docs" },
        category: { type: "string", description: "Optional: filter by category" }
      }
    }
  },
  {
    name: "delete_document",
    description: "Delete a document from storage and database",
    inputSchema: {
      type: "object",
      properties: {
        document_id: { type: "string", description: "Document UUID" }
      },
      required: ["document_id"]
    }
  },
  // ============ DEPLOYMENT TOOLS ============
  {
    name: "list_deployments",
    description: "List all deployments with their status",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["active", "deploying", "failed", "stopped"], description: "Optional filter by status" }
      },
      required: []
    }
  },
  {
    name: "get_deployment",
    description: "Get a deployment with all its components (github, frontend, mcp_server, database)",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Deployment slug" },
        deployment_id: { type: "string", description: "Or deployment UUID" }
      },
      required: []
    }
  },
  {
    name: "add_deployment",
    description: "Create a new deployment with optional component URLs",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Deployment name" },
        description: { type: "string", description: "Optional description" },
        github_url: { type: "string", description: "GitHub repo URL" },
        frontend_url: { type: "string", description: "Frontend URL" },
        mcp_server_url: { type: "string", description: "MCP server URL" },
        database_type: { type: "string", description: "Database type (PostgreSQL, MySQL, etc.)" },
        database_provider: { type: "string", description: "Database provider (Supabase, PlanetScale, etc.)" }
      },
      required: ["name"]
    }
  },
  {
    name: "update_deployment",
    description: "Update deployment name, description, or status",
    inputSchema: {
      type: "object",
      properties: {
        deployment_id: { type: "string", description: "Deployment UUID" },
        name: { type: "string", description: "New name" },
        description: { type: "string", description: "New description" },
        status: { type: "string", enum: ["active", "deploying", "failed", "stopped"], description: "New status" }
      },
      required: ["deployment_id"]
    }
  },
  {
    name: "update_deployment_component",
    description: "Update a specific component (github, frontend, mcp_server, database) of a deployment",
    inputSchema: {
      type: "object",
      properties: {
        deployment_id: { type: "string", description: "Deployment UUID" },
        component: { type: "string", enum: ["github", "frontend", "mcp_server", "database"], description: "Component type" },
        status: { type: "string", enum: ["healthy", "degraded", "down", "unknown", "not_configured"], description: "Component status" },
        url: { type: "string", description: "Component URL" },
        config: { type: "object", description: "Component-specific config (repo_url, branch, framework, version, etc.)" }
      },
      required: ["deployment_id", "component"]
    }
  },
  {
    name: "delete_deployment",
    description: "Delete a deployment and all its components",
    inputSchema: {
      type: "object",
      properties: {
        deployment_id: { type: "string", description: "Deployment UUID" }
      },
      required: ["deployment_id"]
    }
  },
  {
    name: "check_deployment_health",
    description: "Check health of all components in a deployment by pinging their URLs",
    inputSchema: {
      type: "object",
      properties: {
        deployment_id: { type: "string", description: "Deployment UUID" }
      },
      required: ["deployment_id"]
    }
  },
  // ============ GMAIL TOOLS ============
  {
    name: "list_emails",
    description: "List emails from Gmail. Can filter by company (matches against stored contacts).",
    inputSchema: {
      type: "object",
      properties: {
        folder: { type: "string", enum: ["inbox", "sent", "drafts", "all"], description: "Folder (default: inbox)" },
        company_slug: { type: "string", description: "Filter by company (matches contact emails)" },
        query: { type: "string", description: "Gmail search query" },
        max_results: { type: "number", description: "Max results (default: 50)" }
      },
      required: []
    }
  },
  {
    name: "get_email",
    description: "Get full email content including body",
    inputSchema: {
      type: "object",
      properties: {
        email_id: { type: "string", description: "Email ID" }
      },
      required: ["email_id"]
    }
  },
  // ============ CALENDAR TOOLS ============
  {
    name: "list_calendar_events",
    description: "List Google Calendar events. Events with [company-slug] prefix in title are auto-categorized (e.g., '[dtiq] Weekly Standup').",
    inputSchema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "Start date ISO format (default: today)" },
        end_date: { type: "string", description: "End date ISO format (default: 2 weeks out)" },
        company_slug: { type: "string", description: "Filter by company (matches [slug] prefix in title)" },
        max_results: { type: "number", description: "Max events (default: 50)" }
      },
      required: []
    }
  },
  {
    name: "create_calendar_event",
    description: "Create a Google Calendar event. Use [company-slug] prefix in title to categorize (e.g., '[dtiq] Demo Call').",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Event title (use [slug] prefix for company events)" },
        start_time: { type: "string", description: "Start time ISO format (e.g., 2026-01-30T10:00:00)" },
        end_time: { type: "string", description: "End time ISO format (e.g., 2026-01-30T11:00:00)" },
        description: { type: "string", description: "Event description" },
        location: { type: "string", description: "Location or video call link" },
        attendees: { type: "array", items: { type: "string" }, description: "List of attendee email addresses" }
      },
      required: ["title", "start_time", "end_time"]
    }
  },
  // ============ CRM INSTANCE MANAGEMENT TOOLS ============
  {
    name: "list_crm_instances",
    description: "List all CRM company instances with their configuration status",
    inputSchema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "get_crm_instance_status",
    description: "Get detailed status for a company's CRM instance including user count, health, and stats",
    inputSchema: {
      type: "object",
      properties: {
        company: { type: "string", enum: ["dtiq", "packetfabric", "element8", "qwilt", "welink", "dev"], description: "Company slug" }
      },
      required: ["company"]
    }
  },
  {
    name: "check_crm_instance_health",
    description: "Health check all CRM instances at once",
    inputSchema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "list_crm_users",
    description: "List users on a company's CRM instance with optional search, role filter, and pagination",
    inputSchema: {
      type: "object",
      properties: {
        company: { type: "string", enum: ["dtiq", "packetfabric", "element8", "qwilt", "welink", "dev"], description: "Company slug" },
        search: { type: "string", description: "Search by email or name" },
        role: { type: "string", enum: ["admin", "manager", "agent", "customer"], description: "Filter by role" },
        page: { type: "number", description: "Page number (default 1)" },
        limit: { type: "number", description: "Results per page (default 25)" }
      },
      required: ["company"]
    }
  },
  {
    name: "create_crm_user",
    description: "Create a new user account on a company's CRM instance (creates in Firebase Auth + database)",
    inputSchema: {
      type: "object",
      properties: {
        company: { type: "string", enum: ["dtiq", "packetfabric", "element8", "qwilt", "welink", "dev"], description: "Company slug" },
        email: { type: "string", description: "User email address" },
        password: { type: "string", description: "Password (min 8 characters)" },
        displayName: { type: "string", description: "User's display name" },
        role: { type: "string", enum: ["admin", "manager", "agent", "customer"], description: "User role (default: agent)" }
      },
      required: ["company", "email", "password", "displayName"]
    }
  },
  {
    name: "update_crm_user_role",
    description: "Update a user's role on a company's CRM instance",
    inputSchema: {
      type: "object",
      properties: {
        company: { type: "string", enum: ["dtiq", "packetfabric", "element8", "qwilt", "welink", "dev"], description: "Company slug" },
        user_id: { type: "string", description: "User UID" },
        role: { type: "string", enum: ["admin", "manager", "agent", "customer"], description: "New role" }
      },
      required: ["company", "user_id", "role"]
    }
  },
  {
    name: "delete_crm_user",
    description: "Delete a user from a company's CRM instance",
    inputSchema: {
      type: "object",
      properties: {
        company: { type: "string", enum: ["dtiq", "packetfabric", "element8", "qwilt", "welink", "dev"], description: "Company slug" },
        user_id: { type: "string", description: "User UID to delete" }
      },
      required: ["company", "user_id"]
    }
  },
  {
    name: "reset_crm_user_password",
    description: "Reset a user's password on a company's CRM instance",
    inputSchema: {
      type: "object",
      properties: {
        company: { type: "string", enum: ["dtiq", "packetfabric", "element8", "qwilt", "welink", "dev"], description: "Company slug" },
        user_id: { type: "string", description: "User UID" },
        new_password: { type: "string", description: "New password (min 8 characters)" }
      },
      required: ["company", "user_id", "new_password"]
    }
  },
  {
    name: "submit_admin_request",
    description: "Submit an internal admin request (Google Workspace issue or website edit request)",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["workspace", "website"], description: "Request type" },
        category: { type: "string", description: "Category (e.g. google-drive, gmail, content-update, bug-fix)" },
        subject: { type: "string", description: "Brief subject (for workspace requests)" },
        description: { type: "string", description: "Detailed description of the request" },
        priority: { type: "string", enum: ["low", "medium", "high"], description: "Priority level" },
        pageUrl: { type: "string", description: "Page URL or section (for website requests)" },
        referenceUrl: { type: "string", description: "Optional reference link" },
        submitted_by: { type: "string", description: "Email or name of submitter" }
      },
      required: ["type", "category", "description"]
    }
  },
  // ============ GITHUB TOOLS ============
  {
    name: "github_list_repos",
    description: "List all repositories in the DAAITeam GitHub organization with basic stats",
    inputSchema: {
      type: "object",
      properties: {
        sort: { type: "string", enum: ["pushed", "updated", "created", "full_name"], description: "Sort field (default: pushed)" },
        per_page: { type: "number", description: "Results per page (default: 30, max: 100)" }
      },
      required: []
    }
  },
  // ============ GCP CLOUD RUN MONITORING TOOLS ============
  {
    name: "get_cloudrun_service_info",
    description: "Get Cloud Run service configuration for a tenant (revision, image, CPU/memory, scaling, last deploy time)",
    inputSchema: {
      type: "object",
      properties: {
        tenant: { type: "string", enum: ["dtiq", "packetfabric", "element8", "qwilt", "welink", "dev"], description: "Tenant slug" }
      },
      required: ["tenant"]
    }
  },
  {
    name: "get_cloudrun_metrics",
    description: "Get aggregate metrics for a tenant's Cloud Run service (request count, latency, error rate, CPU, memory)",
    inputSchema: {
      type: "object",
      properties: {
        tenant: { type: "string", enum: ["dtiq", "packetfabric", "element8", "qwilt", "welink", "dev"], description: "Tenant slug" },
        period: { type: "string", enum: ["1h", "6h", "24h", "7d", "30d"], description: "Time period (default: 24h)" }
      },
      required: ["tenant"]
    }
  },
  {
    name: "get_cloudrun_metrics_timeseries",
    description: "Get time-series data points for charting a specific metric",
    inputSchema: {
      type: "object",
      properties: {
        tenant: { type: "string", enum: ["dtiq", "packetfabric", "element8", "qwilt", "welink", "dev"], description: "Tenant slug" },
        metric: { type: "string", enum: ["request_count", "request_latencies", "instance_count", "cpu_utilization", "memory_utilization", "error_count"], description: "Metric to fetch" },
        period: { type: "string", enum: ["1h", "6h", "24h", "7d", "30d"], description: "Time period (default: 24h)" }
      },
      required: ["tenant", "metric"]
    }
  },
  {
    name: "get_all_deployments_metrics",
    description: "Get summary metrics for ALL tenants in one call (for the deployments list page)",
    inputSchema: {
      type: "object",
      properties: {
        period: { type: "string", enum: ["1h", "6h", "24h", "7d", "30d"], description: "Time period (default: 1h)" }
      },
      required: []
    }
  },
  {
    name: "github_list_commits",
    description: "List recent commits for a specific repo, or across all org repos if no repo specified",
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository name (e.g., 'CRMBackend'). If omitted, fetches from all repos." },
        author: { type: "string", description: "Filter by commit author GitHub username" },
        since: { type: "string", description: "ISO 8601 date — only commits after this date (default: 7 days ago)" },
        per_page: { type: "number", description: "Commits per repo (default: 10, max: 100)" }
      },
      required: []
    }
  },
  {
    name: "github_list_prs",
    description: "List pull requests across the org or for a specific repo",
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository name. If omitted, fetches PRs from all repos." },
        state: { type: "string", enum: ["open", "closed", "all"], description: "PR state filter (default: open)" },
        per_page: { type: "number", description: "PRs per repo (default: 10, max: 100)" }
      },
      required: []
    }
  },
  {
    name: "github_org_activity",
    description: "Get a summary of recent GitHub org activity: repo count, recent commits, open PRs, top contributors",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Look-back window in days (default: 7, max: 30)" }
      },
      required: []
    }
  },
  {
    name: "get_cloudrun_revisions",
    description: "Get recent deployment revisions for a tenant's Cloud Run service",
    inputSchema: {
      type: "object",
      properties: {
        tenant: { type: "string", enum: ["dtiq", "packetfabric", "element8", "qwilt", "welink", "dev"], description: "Tenant slug" },
        limit: { type: "number", description: "Max revisions to return (default: 10)" }
      },
      required: ["tenant"]
    }
  },
  {
    name: "get_deployment_logs",
    description: "Get real log entries from Cloud Logging for a tenant's Cloud Run service",
    inputSchema: {
      type: "object",
      properties: {
        tenant: { type: "string", enum: ["dtiq", "packetfabric", "element8", "qwilt", "welink", "dev"], description: "Tenant slug" },
        severity: { type: "string", enum: ["DEFAULT", "DEBUG", "INFO", "NOTICE", "WARNING", "ERROR", "CRITICAL"], description: "Minimum severity filter" },
        limit: { type: "number", description: "Max entries to return (default: 50)" },
        hours_back: { type: "number", description: "How many hours back to search (default: 1)" },
        search: { type: "string", description: "Text search within log messages" }
      },
      required: ["tenant"]
    }
  },
  {
    name: "get_deployment_log_summary",
    description: "Get aggregated log counts by severity for a tenant",
    inputSchema: {
      type: "object",
      properties: {
        tenant: { type: "string", enum: ["dtiq", "packetfabric", "element8", "qwilt", "welink", "dev"], description: "Tenant slug" },
        hours_back: { type: "number", description: "How many hours to summarize (default: 24)" }
      },
      required: ["tenant"]
    }
  },
  {
    name: "get_firebase_users",
    description: "Get Firebase Auth user stats for a tenant",
    inputSchema: {
      type: "object",
      properties: {
        tenant: { type: "string", enum: ["dtiq", "packetfabric", "element8", "qwilt", "welink", "dev"], description: "Tenant slug" },
        include_list: { type: "boolean", description: "Include list of individual users (default: false)" }
      },
      required: ["tenant"]
    }
  },

  // ============ BUILD AGENTS (Layer 1) ============
  {
    name: "list_build_runs",
    description: "List build runs, optionally filter by status or repo",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["pending", "running", "success", "failed", "cancelled"], description: "Filter by status" },
        repo: { type: "string", description: "Filter by repo name" },
        limit: { type: "number", description: "Max results (default 20)" }
      },
      required: []
    }
  },
  {
    name: "get_build_run",
    description: "Get full details for a build run including all tasks",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Build run UUID" }
      },
      required: ["id"]
    }
  },
  {
    name: "create_build_run",
    description: "Submit a new build spec for parallel agent execution",
    inputSchema: {
      type: "object",
      properties: {
        spec_title: { type: "string", description: "Short title for the build" },
        spec_body: { type: "string", description: "Full spec/requirements for agents to implement" },
        repo: { type: "string", description: "GitHub repo (e.g. CRMBackend, AgentBoxDashboard)" },
        branch: { type: "string", description: "Base branch (default: main)" }
      },
      required: ["spec_title", "spec_body", "repo"]
    }
  },
  {
    name: "cancel_build_run",
    description: "Cancel a running or pending build run",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Build run UUID" }
      },
      required: ["id"]
    }
  },
  {
    name: "get_build_task_log",
    description: "Get the output log for a specific build task",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "Build task UUID" }
      },
      required: ["task_id"]
    }
  },

  // ============ MONITORING (Layer 2) ============
  {
    name: "list_error_events",
    description: "List error events detected from Cloud Logging, optionally filter by service or severity",
    inputSchema: {
      type: "object",
      properties: {
        service: { type: "string", description: "Filter by service name (e.g. crm-backend-dtiq)" },
        severity: { type: "string", enum: ["WARNING", "ERROR", "CRITICAL"], description: "Filter by severity" },
        acknowledged: { type: "boolean", description: "Filter by acknowledged status" },
        limit: { type: "number", description: "Max results (default 50)" }
      },
      required: []
    }
  },
  {
    name: "get_error_event",
    description: "Get full details for an error event including triage information",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Error event UUID" }
      },
      required: ["id"]
    }
  },
  {
    name: "list_error_triage",
    description: "List triaged errors, optionally filter by category or auto-fixable status",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["bug", "config", "transient", "dependency", "infra", "unknown"], description: "Filter by triage category" },
        auto_fixable: { type: "boolean", description: "Filter by auto-fixable status" },
        limit: { type: "number", description: "Max results (default 50)" }
      },
      required: []
    }
  },
  {
    name: "get_monitoring_stats",
    description: "Get aggregate monitoring stats: errors in last 24h, by service, by severity",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "acknowledge_error",
    description: "Mark an error event as acknowledged",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Error event UUID" }
      },
      required: ["id"]
    }
  },

  // ============ AUTO-FIX (Layer 3) ============
  {
    name: "list_autofix_runs",
    description: "List auto-fix runs, optionally filter by status or repo",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["pending", "running", "testing", "success", "failed", "cancelled"], description: "Filter by status" },
        repo: { type: "string", description: "Filter by repo name" },
        limit: { type: "number", description: "Max results (default 20)" }
      },
      required: []
    }
  },
  {
    name: "get_autofix_run",
    description: "Get full details for an auto-fix run",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Autofix run UUID" }
      },
      required: ["id"]
    }
  },
  {
    name: "trigger_autofix",
    description: "Manually trigger an auto-fix for a triaged error",
    inputSchema: {
      type: "object",
      properties: {
        error_triage_id: { type: "string", description: "Error triage UUID to fix" },
        repo: { type: "string", description: "Target repo for the fix" }
      },
      required: ["error_triage_id", "repo"]
    }
  },
  {
    name: "cancel_autofix",
    description: "Cancel a running or pending auto-fix run",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Autofix run UUID" }
      },
      required: ["id"]
    }
  }
];

// ============ TOOL HANDLERS ============
const handlers = {
  async list_companies() {
    return await query('SELECT id, slug, name, description, status, tools, created_at FROM companies');
  },

  async get_company({ slug }) {
    const company = await queryOne('SELECT * FROM companies WHERE slug = $1', [slug]);
    if (!company) throw new Error(`Company not found: ${slug}`);

    const [contacts, milestones, documents, requirements, activity] = await Promise.all([
      query('SELECT * FROM contacts WHERE company_id = $1', [company.id]),
      query('SELECT * FROM milestones WHERE company_id = $1 ORDER BY order_index', [company.id]),
      query('SELECT * FROM documents WHERE company_id = $1', [company.id]),
      query('SELECT * FROM requirements WHERE company_id = $1', [company.id]),
      query('SELECT * FROM activity WHERE company_id = $1 ORDER BY created_at DESC', [company.id]),
    ]);

    return { ...company, contacts, milestones, documents, requirements, activity };
  },

  async update_company_status({ slug, status }) {
    const rows = await query(
      'UPDATE companies SET status = $1, updated_at = NOW() WHERE slug = $2 RETURNING *',
      [status, slug]
    );
    return { success: true, company: rows[0] };
  },

  async list_milestones({ slug }) {
    const companyId = await getCompanyId(slug);
    return await query('SELECT * FROM milestones WHERE company_id = $1 ORDER BY order_index', [companyId]);
  },

  async update_milestone({ milestone_id, status, notes }) {
    const sets = ['status = $1', 'updated_at = NOW()'];
    const params = [status];
    let idx = 2;

    if (status === 'done') {
      sets.push(`completed_at = NOW()`);
    }
    if (notes) {
      sets.push(`notes = $${idx}`);
      params.push(notes);
      idx++;
    }
    params.push(milestone_id);

    const rows = await query(
      `UPDATE milestones SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    return { success: true, milestone: rows[0] };
  },

  async add_milestone({ slug, title, due_date }) {
    const companyId = await getCompanyId(slug);
    const existing = await queryOne(
      'SELECT order_index FROM milestones WHERE company_id = $1 ORDER BY order_index DESC LIMIT 1',
      [companyId]
    );
    const order_index = existing ? existing.order_index + 1 : 0;

    const rows = await query(
      'INSERT INTO milestones (company_id, title, due_date, order_index) VALUES ($1, $2, $3, $4) RETURNING *',
      [companyId, title, due_date || null, order_index]
    );
    return { success: true, milestone: rows[0] };
  },

  async add_note({ slug, content, type = 'note' }) {
    const companyId = await getCompanyId(slug);
    const rows = await query(
      'INSERT INTO activity (company_id, content, type) VALUES ($1, $2, $3) RETURNING *',
      [companyId, content, type]
    );
    return { success: true, activity: rows[0] };
  },

  async get_recent_activity({ slug, limit = 20 }) {
    if (slug) {
      const companyId = await getCompanyId(slug);
      return await query(
        `SELECT a.*, json_build_object('name', c.name, 'slug', c.slug) AS companies
         FROM activity a LEFT JOIN companies c ON a.company_id = c.id
         WHERE a.company_id = $1 ORDER BY a.created_at DESC LIMIT $2`,
        [companyId, limit]
      );
    }
    return await query(
      `SELECT a.*, json_build_object('name', c.name, 'slug', c.slug) AS companies
       FROM activity a LEFT JOIN companies c ON a.company_id = c.id
       ORDER BY a.created_at DESC LIMIT $1`,
      [limit]
    );
  },

  async update_requirement({ slug, item, status }) {
    const companyId = await getCompanyId(slug);
    const rows = await query(
      `UPDATE requirements SET status = $1, updated_at = NOW()
       WHERE company_id = $2 AND item ILIKE $3 RETURNING *`,
      [status, companyId, `%${item}%`]
    );
    return { success: true, requirement: rows[0] };
  },

  async add_requirement({ slug, item, status = 'needed' }) {
    const companyId = await getCompanyId(slug);
    const rows = await query(
      'INSERT INTO requirements (company_id, item, status) VALUES ($1, $2, $3) RETURNING *',
      [companyId, item, status]
    );
    return { success: true, requirement: rows[0] };
  },

  async list_documents({ slug }) {
    const companyId = await getCompanyId(slug);
    return await query(
      'SELECT * FROM documents WHERE company_id = $1 ORDER BY uploaded_at DESC',
      [companyId]
    );
  },

  async add_document({ slug, name, type, url, notes }) {
    const companyId = await getCompanyId(slug);
    const rows = await query(
      'INSERT INTO documents (company_id, name, type, url, notes) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [companyId, name, type, url || null, notes || null]
    );
    return { success: true, document: rows[0] };
  },

  async add_contact({ slug, name, role, email, phone }) {
    const companyId = await getCompanyId(slug);
    const rows = await query(
      'INSERT INTO contacts (company_id, name, role, email, phone) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [companyId, name, role || null, email || null, phone || null]
    );
    return { success: true, contact: rows[0] };
  },

  async list_contacts({ slug }) {
    const companyId = await getCompanyId(slug);
    return await query('SELECT * FROM contacts WHERE company_id = $1', [companyId]);
  },

  async get_portfolio_summary() {
    const companies = await query(`
      SELECT c.slug, c.name, c.status,
        COUNT(m.id) AS total_milestones,
        COUNT(m.id) FILTER (WHERE m.status = 'done') AS done_milestones
      FROM companies c
      LEFT JOIN milestones m ON m.company_id = c.id
      GROUP BY c.id, c.slug, c.name, c.status
    `);
    return companies.map(c => ({
      name: c.name,
      slug: c.slug,
      status: c.status,
      progress: c.total_milestones > 0 ? Math.round((c.done_milestones / c.total_milestones) * 100) : 0,
      milestones: `${c.done_milestones}/${c.total_milestones}`
    }));
  },

  async send_email({ to, subject, body }) {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
      throw new Error('Email not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD environment variables.');
    }
    await transporter.sendMail({ from: process.env.GMAIL_USER, to, subject, html: body });
    return { success: true, message: `Email sent to ${to}` };
  },

  async send_project_update({ to, subject, include_details = false }) {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
      throw new Error('Email not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD environment variables.');
    }

    const companies = await query(`
      SELECT c.*, json_agg(DISTINCT jsonb_build_object('title', m.title, 'status', m.status, 'order_index', m.order_index)) FILTER (WHERE m.id IS NOT NULL) AS milestones,
        json_agg(DISTINCT jsonb_build_object('item', r.item, 'status', r.status)) FILTER (WHERE r.id IS NOT NULL) AS requirements
      FROM companies c
      LEFT JOIN milestones m ON m.company_id = c.id
      LEFT JOIN requirements r ON r.company_id = c.id
      GROUP BY c.id
    `);

    const date = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    let html = `
      <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto;">
        <h1 style="color: #1a365d; border-bottom: 2px solid #1a365d; padding-bottom: 10px;">AI-in-a-Box Portfolio Update</h1>
        <p style="color: #666; font-size: 14px;">${date}</p>
        <h2 style="color: #1a365d; margin-top: 30px;">Portfolio Summary</h2>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px;">
          <tr style="background: #f0f4f8;">
            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #ddd;">Company</th>
            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #ddd;">Status</th>
            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #ddd;">Progress</th>
          </tr>`;

    for (const c of companies) {
      const ms = c.milestones || [];
      const total = ms.length;
      const done = ms.filter(m => m.status === 'done').length;
      const progress = total ? Math.round((done / total) * 100) : 0;
      const statusColor = { active: '#28a745', discovery: '#ffc107', pilot: '#17a2b8', deployed: '#007bff' }[c.status] || '#6c757d';

      html += `<tr>
        <td style="padding: 12px; border-bottom: 1px solid #ddd;"><strong>${c.name}</strong></td>
        <td style="padding: 12px; border-bottom: 1px solid #ddd;"><span style="background: ${statusColor}; color: white; padding: 4px 10px; border-radius: 12px; font-size: 12px;">${c.status}</span></td>
        <td style="padding: 12px; border-bottom: 1px solid #ddd;">
          <div style="background: #e9ecef; border-radius: 10px; height: 20px; width: 150px; overflow: hidden;">
            <div style="background: linear-gradient(90deg, #28a745, #20c997); height: 100%; width: ${progress}%;"></div>
          </div>
          <span style="font-size: 12px; color: #666;">${done}/${total} milestones (${progress}%)</span>
        </td></tr>`;
    }
    html += '</table>';

    if (include_details) {
      for (const c of companies) {
        html += `<div style="margin-bottom: 30px; padding: 20px; background: #f8f9fa; border-radius: 8px;">
          <h3 style="color: #1a365d; margin-top: 0;">${c.name}</h3>
          <p style="color: #666; font-size: 14px;">${c.description || ''}</p>`;

        const sortedMilestones = (c.milestones || []).filter(m => !m.title.startsWith('[FUTURE]')).sort((a, b) => a.order_index - b.order_index);
        if (sortedMilestones.length > 0) {
          html += '<p style="margin-bottom: 5px;"><strong>Milestones:</strong></p><ul style="margin-top: 5px;">';
          for (const m of sortedMilestones) {
            const icon = m.status === 'done' ? '&#10003;' : '&#9675;';
            const style = m.status === 'done' ? 'color: #28a745;' : 'color: #666;';
            html += `<li style="${style}">${icon} ${m.title}</li>`;
          }
          html += '</ul>';
        }

        const needed = (c.requirements || []).filter(r => r.status === 'needed');
        if (needed.length > 0) {
          html += '<p style="margin-bottom: 5px;"><strong>Still Need:</strong></p><ul style="margin-top: 5px;">';
          for (const r of needed) html += `<li style="color: #856404;">${r.item}</li>`;
          html += '</ul>';
        }
        html += '</div>';
      }
    }

    html += `<hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
      <p style="color: #888; font-size: 12px;">Sent from AI-in-a-Box Project Tracker</p></div>`;

    const emailSubject = subject || `AI-in-a-Box Portfolio Update \u2014 ${date}`;
    await transporter.sendMail({ from: process.env.GMAIL_USER, to, subject: emailSubject, html });

    await query(
      "INSERT INTO activity (company_id, type, content) VALUES (NULL, 'email', $1)",
      [`Sent portfolio update to ${to}`]
    );

    return { success: true, message: `Portfolio update sent to ${to}` };
  },

  // ============ DEV TASKS HANDLERS ============
  async list_dev_tasks({ status, assigned_to, priority }) {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (status) { conditions.push(`dt.status = $${idx++}`); params.push(status); }
    if (assigned_to) { conditions.push(`dt.assigned_to = $${idx++}`); params.push(assigned_to); }
    if (priority) { conditions.push(`dt.priority = $${idx++}`); params.push(priority); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    return await query(
      `SELECT dt.*, json_build_object('name', c.name, 'slug', c.slug) AS companies
       FROM dev_tasks dt LEFT JOIN companies c ON dt.company_id = c.id
       ${where} ORDER BY dt.priority, dt.due_date`,
      params
    );
  },

  async add_dev_task({ title, description, assigned_to, priority, steps, due_date }) {
    const rows = await query(
      `INSERT INTO dev_tasks (title, description, assigned_to, priority, steps, due_date)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [title, description || null, assigned_to || null, priority || 'medium', JSON.stringify(steps || []), due_date || null]
    );
    return { success: true, task: rows[0] };
  },

  async update_dev_task({ task_id, status, assigned_to, priority }) {
    const sets = ['updated_at = NOW()'];
    const params = [];
    let idx = 1;

    if (status) { sets.push(`status = $${idx++}`); params.push(status); if (status === 'done') sets.push('completed_at = NOW()'); }
    if (assigned_to) { sets.push(`assigned_to = $${idx++}`); params.push(assigned_to); }
    if (priority) { sets.push(`priority = $${idx++}`); params.push(priority); }

    params.push(task_id);
    const rows = await query(
      `UPDATE dev_tasks SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    return { success: true, task: rows[0] };
  },

  async delete_dev_task({ task_id }) {
    await query('DELETE FROM dev_tasks WHERE id = $1', [task_id]);
    return { success: true, deleted: task_id };
  },

  // ============ DOCUMENT STORAGE HANDLERS ============
  async upload_document({ slug, filename, content_base64, content_type, category, description }) {
    let company_id = null;
    if (slug !== 'platform' && slug !== 'dev') {
      company_id = await getCompanyId(slug);
    }

    const buffer = Buffer.from(content_base64, 'base64');
    const bucket_path = `${slug}/${filename}`;

    // Upload to GCS
    const bucket = gcs.bucket(GCS_BUCKET);
    const file = bucket.file(bucket_path);
    await file.save(buffer, { contentType: content_type, resumable: false });
    await file.makePublic();
    const publicUrl = `https://storage.googleapis.com/${GCS_BUCKET}/${bucket_path}`;

    const ext = filename.split('.').pop().toLowerCase();

    const rows = await query(
      `INSERT INTO documents (company_id, name, type, url, file_url, bucket_path, file_type, category, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [company_id, filename, category || 'general', publicUrl, publicUrl, bucket_path, ext, category || 'general', description || null]
    );

    return { success: true, document: rows[0], url: publicUrl };
  },

  async get_document_content({ document_id }) {
    const doc = await queryOne(
      `SELECT d.*, json_build_object('name', c.name, 'slug', c.slug) AS companies
       FROM documents d LEFT JOIN companies c ON d.company_id = c.id WHERE d.id = $1`,
      [document_id]
    );
    if (!doc) throw new Error('Document not found');

    const textFormats = ['md', 'txt', 'json', 'csv', 'html', 'xml', 'js', 'ts', 'py', 'sql'];
    const ext = doc.file_type?.toLowerCase();

    if (!textFormats.includes(ext)) {
      return { document: doc, content: null, message: `Cannot read content of .${ext} files directly. Use the URL to view: ${doc.file_url}` };
    }

    try {
      const response = await fetch(doc.file_url);
      if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`);
      let content = await response.text();
      const truncated = content.length > 50000;
      if (truncated) content = content.substring(0, 50000) + '\n\n... [truncated]';
      return { document: doc, content, truncated };
    } catch (fetchError) {
      return { document: doc, content: null, error: fetchError.message };
    }
  },

  async list_all_documents({ slug, category }) {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (slug) {
      if (slug === 'platform' || slug === 'dev') {
        conditions.push('d.company_id IS NULL');
      } else {
        const companyId = await getCompanyId(slug);
        conditions.push(`d.company_id = $${idx++}`);
        params.push(companyId);
      }
    }
    if (category) {
      conditions.push(`d.category = $${idx++}`);
      params.push(category);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    return await query(
      `SELECT d.*, json_build_object('name', c.name, 'slug', c.slug) AS companies
       FROM documents d LEFT JOIN companies c ON d.company_id = c.id
       ${where} ORDER BY d.uploaded_at DESC`,
      params
    );
  },

  async delete_document({ document_id }) {
    const doc = await queryOne('SELECT bucket_path FROM documents WHERE id = $1', [document_id]);

    if (doc?.bucket_path) {
      try {
        await gcs.bucket(GCS_BUCKET).file(doc.bucket_path).delete();
      } catch (e) {
        console.warn('GCS delete failed (may not exist):', e.message);
      }
    }

    await query('DELETE FROM documents WHERE id = $1', [document_id]);
    return { success: true, deleted: document_id };
  },

  // ============ DEPLOYMENT HANDLERS ============
  async list_deployments({ status }) {
    if (status) {
      return await query('SELECT * FROM deployments WHERE status = $1 ORDER BY created_at DESC', [status]);
    }
    return await query('SELECT * FROM deployments ORDER BY created_at DESC');
  },

  async get_deployment({ slug, deployment_id }) {
    let deployment;
    if (deployment_id) {
      deployment = await queryOne('SELECT * FROM deployments WHERE id = $1', [deployment_id]);
    } else if (slug) {
      deployment = await queryOne('SELECT * FROM deployments WHERE slug = $1', [slug]);
    } else {
      throw new Error('Must provide slug or deployment_id');
    }
    if (!deployment) throw new Error('Deployment not found');

    const components = await query('SELECT * FROM deployment_components WHERE deployment_id = $1', [deployment.id]);
    const result = { ...deployment };
    for (const comp of components) {
      result[comp.component_type] = {
        status: comp.status,
        url: comp.url,
        last_checked: comp.last_checked,
        error_message: comp.error_message,
        ...(comp.config || {})
      };
    }
    return result;
  },

  async add_deployment({ name, description, github_url, frontend_url, mcp_server_url, database_type, database_provider }) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    const existing = await queryOne('SELECT id FROM deployments WHERE slug = $1', [slug]);
    if (existing) throw new Error(`Deployment with slug "${slug}" already exists`);

    const rows = await query(
      'INSERT INTO deployments (name, slug, description, status) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, slug, description || null, 'active']
    );
    const deployment = rows[0];

    const components = [
      { deployment_id: deployment.id, component_type: 'github', status: github_url ? 'unknown' : 'not_configured', url: github_url || null, config: github_url ? JSON.stringify({ repo_url: github_url, branch: 'main' }) : '{}' },
      { deployment_id: deployment.id, component_type: 'frontend', status: frontend_url ? 'unknown' : 'not_configured', url: frontend_url || null, config: '{}' },
      { deployment_id: deployment.id, component_type: 'mcp_server', status: mcp_server_url ? 'unknown' : 'not_configured', url: mcp_server_url || null, config: '{}' },
      { deployment_id: deployment.id, component_type: 'database', status: database_type ? 'unknown' : 'not_configured', url: null, config: JSON.stringify({ type: database_type || null, provider: database_provider || null }) },
    ];

    for (const comp of components) {
      await query(
        'INSERT INTO deployment_components (deployment_id, component_type, status, url, config) VALUES ($1, $2, $3, $4, $5)',
        [comp.deployment_id, comp.component_type, comp.status, comp.url, comp.config]
      );
    }

    return await handlers.get_deployment({ deployment_id: deployment.id });
  },

  async update_deployment({ deployment_id, name, description, status }) {
    const sets = ['updated_at = NOW()'];
    const params = [];
    let idx = 1;

    if (name) { sets.push(`name = $${idx++}`); params.push(name); }
    if (description !== undefined) { sets.push(`description = $${idx++}`); params.push(description); }
    if (status) { sets.push(`status = $${idx++}`); params.push(status); }

    params.push(deployment_id);
    const rows = await query(
      `UPDATE deployments SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    return { success: true, deployment: rows[0] };
  },

  async update_deployment_component({ deployment_id, component, status, url, config }) {
    const sets = ['updated_at = NOW()'];
    const params = [];
    let idx = 1;

    if (status) { sets.push(`status = $${idx++}`); params.push(status); }
    if (url !== undefined) { sets.push(`url = $${idx++}`); params.push(url); }
    if (config) {
      const existing = await queryOne(
        'SELECT config FROM deployment_components WHERE deployment_id = $1 AND component_type = $2',
        [deployment_id, component]
      );
      const merged = { ...(existing?.config || {}), ...config };
      sets.push(`config = $${idx++}`);
      params.push(JSON.stringify(merged));
    }

    params.push(deployment_id, component);
    const rows = await query(
      `UPDATE deployment_components SET ${sets.join(', ')} WHERE deployment_id = $${idx} AND component_type = $${idx + 1} RETURNING *`,
      params
    );
    return { success: true, component: rows[0] };
  },

  async delete_deployment({ deployment_id }) {
    await query('DELETE FROM deployment_components WHERE deployment_id = $1', [deployment_id]);
    await query('DELETE FROM deployments WHERE id = $1', [deployment_id]);
    return { success: true, deleted: deployment_id };
  },

  async check_deployment_health({ deployment_id }) {
    const components = await query('SELECT * FROM deployment_components WHERE deployment_id = $1', [deployment_id]);
    const results = {};

    for (const comp of components) {
      if (!comp.url) {
        results[comp.component_type] = { status: 'not_configured', checked: false };
        continue;
      }

      try {
        const startTime = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        let checkUrl = comp.url;
        if (comp.component_type === 'mcp_server') checkUrl = comp.url.replace(/\/$/, '') + '/health';

        const response = await fetch(checkUrl, { method: 'GET', signal: controller.signal });
        clearTimeout(timeout);
        const latency = Date.now() - startTime;

        let newStatus;
        let errorMessage = null;
        if (response.ok) {
          newStatus = latency > 5000 ? 'degraded' : 'healthy';
        } else {
          newStatus = 'degraded';
          errorMessage = `HTTP ${response.status}`;
        }

        await query(
          'UPDATE deployment_components SET status = $1, last_checked = NOW(), error_message = $2, updated_at = NOW() WHERE id = $3',
          [newStatus, errorMessage, comp.id]
        );
        results[comp.component_type] = { status: newStatus, latency, checked: true };
      } catch (err) {
        await query(
          'UPDATE deployment_components SET status = $1, last_checked = NOW(), error_message = $2, updated_at = NOW() WHERE id = $3',
          ['down', err.message, comp.id]
        );
        results[comp.component_type] = { status: 'down', error: err.message, checked: true };
      }
    }

    return { deployment_id, health_check: results };
  },

  // ============ GMAIL HANDLERS ============
  async list_emails({ folder = 'inbox', company_slug, query: searchQuery, max_results = 50 }) {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_REFRESH_TOKEN) {
      throw new Error('Google API not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN.');
    }

    const auth = getGoogleAuth();
    const gmail = google.gmail({ version: 'v1', auth });

    let contactEmails = [];
    if (company_slug) {
      const companyId = await getCompanyId(company_slug).catch(() => null);
      if (companyId) {
        const contacts = await query('SELECT email FROM contacts WHERE company_id = $1', [companyId]);
        contactEmails = contacts.map(c => c.email).filter(Boolean);
      }
    }

    let q = searchQuery || '';
    if (folder === 'inbox') q = `in:inbox ${q}`.trim();
    else if (folder === 'sent') q = `in:sent ${q}`.trim();
    else if (folder === 'drafts') q = `in:drafts ${q}`.trim();

    const listResponse = await gmail.users.messages.list({ userId: 'me', maxResults: max_results, q: q || undefined });
    const messages = listResponse.data.messages || [];

    const emails = await Promise.all(
      messages.slice(0, 20).map(async (msg) => {
        const detail = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'metadata', metadataHeaders: ['From', 'To', 'Subject', 'Date'] });
        const headers = detail.data.payload.headers;
        const getHeader = (name) => headers.find(h => h.name === name)?.value || '';
        return {
          id: msg.id, threadId: msg.threadId, from: getHeader('From'), to: getHeader('To'),
          subject: getHeader('Subject'), preview: detail.data.snippet || '', date: getHeader('Date'),
          read: !detail.data.labelIds?.includes('UNREAD'), starred: detail.data.labelIds?.includes('STARRED') || false,
        };
      })
    );

    let filteredEmails = emails;
    if (company_slug && contactEmails.length > 0) {
      filteredEmails = emails.filter(email =>
        contactEmails.some(contact =>
          email.from.toLowerCase().includes(contact.toLowerCase()) ||
          email.to.toLowerCase().includes(contact.toLowerCase())
        )
      );
    }
    return filteredEmails;
  },

  async get_email({ email_id }) {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_REFRESH_TOKEN) {
      throw new Error('Google API not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN.');
    }

    const auth = getGoogleAuth();
    const gmail = google.gmail({ version: 'v1', auth });
    const detail = await gmail.users.messages.get({ userId: 'me', id: email_id, format: 'full' });
    const headers = detail.data.payload.headers;
    const getHeader = (name) => headers.find(h => h.name === name)?.value || '';

    const getBody = (payload) => {
      if (payload.body?.data) return Buffer.from(payload.body.data, 'base64').toString('utf-8');
      if (payload.parts) {
        for (const part of payload.parts) {
          if (part.mimeType === 'text/plain' && part.body?.data) return Buffer.from(part.body.data, 'base64').toString('utf-8');
        }
        for (const part of payload.parts) {
          if (part.mimeType === 'text/html' && part.body?.data) return Buffer.from(part.body.data, 'base64').toString('utf-8');
          if (part.parts) { const nested = getBody(part); if (nested) return nested; }
        }
      }
      return '';
    };

    return {
      id: email_id, threadId: detail.data.threadId, from: getHeader('From'), to: getHeader('To'),
      subject: getHeader('Subject'), body: getBody(detail.data.payload), preview: detail.data.snippet || '',
      date: getHeader('Date'), read: !detail.data.labelIds?.includes('UNREAD'), starred: detail.data.labelIds?.includes('STARRED') || false,
    };
  },

  // ============ CALENDAR HANDLERS ============
  async list_calendar_events({ start_date, end_date, company_slug, max_results = 50 }) {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_REFRESH_TOKEN) {
      throw new Error('Google API not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN.');
    }

    const auth = getGoogleAuth();
    const calendar = google.calendar({ version: 'v3', auth });
    const timeMin = start_date ? new Date(start_date).toISOString() : new Date().toISOString();
    const defaultEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const timeMax = end_date ? new Date(end_date).toISOString() : defaultEnd.toISOString();

    const response = await calendar.events.list({ calendarId: 'primary', timeMin, timeMax, maxResults: max_results, singleEvents: true, orderBy: 'startTime' });

    let events = response.data.items.map(event => {
      const titleMatch = event.summary?.match(/^\[([a-z0-9-]+)\]\s*/i);
      const companySlug = titleMatch ? titleMatch[1].toLowerCase() : null;
      const cleanTitle = titleMatch ? event.summary.replace(titleMatch[0], '') : event.summary;
      return {
        id: event.id, title: event.summary || 'Untitled', cleanTitle, description: event.description,
        start: event.start.dateTime || event.start.date, end: event.end.dateTime || event.end.date,
        location: event.location, meetLink: event.hangoutLink || event.conferenceData?.entryPoints?.[0]?.uri,
        attendees: event.attendees?.map(a => a.email) || [], companySlug
      };
    });

    if (company_slug) events = events.filter(e => e.companySlug === company_slug.toLowerCase());
    return events;
  },

  async create_calendar_event({ title, start_time, end_time, description, location, attendees }) {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_REFRESH_TOKEN) {
      throw new Error('Google API not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN.');
    }

    const auth = getGoogleAuth();
    const calendar = google.calendar({ version: 'v3', auth });
    const event = {
      summary: title, description, location,
      start: { dateTime: new Date(start_time).toISOString(), timeZone: 'America/New_York' },
      end: { dateTime: new Date(end_time).toISOString(), timeZone: 'America/New_York' }
    };
    if (attendees?.length > 0) event.attendees = attendees.map(email => ({ email }));

    const response = await calendar.events.insert({ calendarId: 'primary', resource: event, sendUpdates: attendees ? 'all' : 'none' });
    return {
      success: true,
      event: { id: response.data.id, title: response.data.summary, start: response.data.start.dateTime, end: response.data.end.dateTime, link: response.data.htmlLink }
    };
  },

  // ============ CRM INSTANCE MANAGEMENT HANDLERS ============
  async list_crm_instances() {
    return CRM_COMPANIES.map(company => {
      const config = getCRMConfig(company);
      return { company, configured: !!(config.url && config.apiKey), url: config.url || 'not configured' };
    });
  },

  async get_crm_instance_status({ company }) {
    const config = getCRMConfig(company);
    if (!config.url) return { company, status: 'not_configured', error: 'No CRM URL configured' };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const startTime = Date.now();
      const healthResp = await fetch(`${config.url}/api/health`, { signal: controller.signal });
      clearTimeout(timeout);
      const latency = Date.now() - startTime;
      const healthy = healthResp.ok;

      let users = null;
      try { const result = await callCRM(company, 'GET', '/admin/users?limit=1'); users = result.meta; } catch (e) { users = { error: e.message }; }

      let adminStatus = null;
      try { const result = await callCRM(company, 'GET', '/admin/status'); adminStatus = result.data; } catch (e) { adminStatus = { error: e.message }; }


      return { company, status: healthy ? (latency > 5000 ? 'degraded' : 'healthy') : 'unhealthy', latency_ms: latency, users, adminStatus };
    } catch (err) {
      return { company, status: 'down', error: err.message };
    }
  },

  async check_crm_instance_health() {
    const results = {};
    await Promise.all(CRM_COMPANIES.map(async (company) => {
      const config = getCRMConfig(company);
      if (!config.url) { results[company] = { status: 'not_configured' }; return; }
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const startTime = Date.now();
        const resp = await fetch(`${config.url}/api/health`, { signal: controller.signal });
        clearTimeout(timeout);
        const latency = Date.now() - startTime;
        results[company] = { status: resp.ok ? (latency > 5000 ? 'degraded' : 'healthy') : 'unhealthy', latency_ms: latency };
      } catch (err) { results[company] = { status: 'down', error: err.message }; }
    }));
    return results;
  },

  async list_crm_users({ company, search, role, page, limit }) {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (role) params.set('role', role);
    if (page) params.set('page', String(page));
    if (limit) params.set('limit', String(limit));
    const qs = params.toString();
    const result = await callCRM(company, 'GET', `/admin/users${qs ? '?' + qs : ''}`);
    return { company, users: result.data, meta: result.meta };
  },

  async create_crm_user({ company, email, password, displayName, role }) {
    const result = await callCRM(company, 'POST', '/admin/users', { email, password, displayName, role: role || 'agent' });
    return { company, user: result.data, success: true };
  },

  async update_crm_user_role({ company, user_id, role }) {
    const result = await callCRM(company, 'PATCH', `/admin/users/${user_id}/role`, { role });
    return { company, user: result.data, success: true };
  },

  async delete_crm_user({ company, user_id }) {
    await callCRM(company, 'DELETE', `/admin/users/${user_id}`);
    return { company, deleted: user_id, success: true };
  },

  async reset_crm_user_password({ company, user_id, new_password }) {
    await callCRM(company, 'POST', '/admin/change-password', { userId: user_id, newPassword: new_password });
    return { company, user_id, success: true, message: 'Password reset successfully' };
  },

  async submit_admin_request({ type, category, subject, description, priority, pageUrl, referenceUrl, submitted_by }) {
    const row = await queryOne(
      `INSERT INTO admin_requests (type, category, subject, description, priority, page_url, reference_url, submitted_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, type, category, subject, description, priority, status, created_at`,
      [type, category, subject || null, description, priority || 'medium', pageUrl || null, referenceUrl || null, submitted_by || null]
    );
    return { id: row.id, ...row };
  },

  // ============ GITHUB HANDLERS ============

  async github_list_repos({ sort = 'pushed', per_page = 30 }) {
    const repos = await callGitHub(`/orgs/${GITHUB_ORG}/repos`, {
      sort,
      per_page: Math.min(per_page, 100),
      type: 'all',
    });
    return repos.map(r => ({
      name: r.name,
      full_name: r.full_name,
      description: r.description,
      private: r.private,
      html_url: r.html_url,
      language: r.language,
      default_branch: r.default_branch,
      open_issues_count: r.open_issues_count,
      stargazers_count: r.stargazers_count,
      pushed_at: r.pushed_at,
      updated_at: r.updated_at,
      created_at: r.created_at,
    }));
  },

  async github_list_commits({ repo, author, since, per_page = 10 }) {
    const sinceDate = since || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const limit = Math.min(per_page, 100);

    if (repo) {
      const commits = await callGitHub(`/repos/${GITHUB_ORG}/${repo}/commits`, {
        since: sinceDate,
        per_page: limit,
        ...(author && { author }),
      });
      return commits.map(c => ({
        sha: c.sha,
        message: c.commit.message.split('\n')[0],
        full_message: c.commit.message,
        author: c.commit.author.name,
        author_login: c.author?.login || null,
        author_avatar: c.author?.avatar_url || null,
        date: c.commit.author.date,
        url: c.html_url,
        repo,
      }));
    }

    // All repos — fetch repos then commits in parallel
    const repos = await callGitHub(`/orgs/${GITHUB_ORG}/repos`, { sort: 'pushed', per_page: 20 });
    const allCommits = [];

    await Promise.all(repos.map(async (r) => {
      try {
        const commits = await callGitHub(`/repos/${GITHUB_ORG}/${r.name}/commits`, {
          since: sinceDate,
          per_page: Math.min(limit, 5),
          ...(author && { author }),
        });
        for (const c of commits) {
          allCommits.push({
            sha: c.sha,
            message: c.commit.message.split('\n')[0],
            author: c.commit.author.name,
            author_login: c.author?.login || null,
            author_avatar: c.author?.avatar_url || null,
            date: c.commit.author.date,
            url: c.html_url,
            repo: r.name,
          });
        }
      } catch (err) {
        // Skip repos with errors (empty repos, etc.)
      }
    }));

    allCommits.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return allCommits.slice(0, 50);
  },

  async github_list_prs({ repo, state = 'open', per_page = 10 }) {
    const limit = Math.min(per_page, 100);

    if (repo) {
      const prs = await callGitHub(`/repos/${GITHUB_ORG}/${repo}/pulls`, {
        state,
        per_page: limit,
        sort: 'updated',
        direction: 'desc',
      });
      return prs.map(pr => ({
        number: pr.number,
        title: pr.title,
        state: pr.state,
        author: pr.user.login,
        author_avatar: pr.user.avatar_url,
        created_at: pr.created_at,
        updated_at: pr.updated_at,
        merged_at: pr.merged_at,
        closed_at: pr.closed_at,
        url: pr.html_url,
        draft: pr.draft,
        labels: pr.labels.map(l => l.name),
        repo,
      }));
    }

    // All repos
    const repos = await callGitHub(`/orgs/${GITHUB_ORG}/repos`, { sort: 'pushed', per_page: 20 });
    const allPRs = [];

    await Promise.all(repos.map(async (r) => {
      try {
        const prs = await callGitHub(`/repos/${GITHUB_ORG}/${r.name}/pulls`, {
          state,
          per_page: Math.min(limit, 5),
          sort: 'updated',
          direction: 'desc',
        });
        for (const pr of prs) {
          allPRs.push({
            number: pr.number,
            title: pr.title,
            state: pr.state,
            author: pr.user.login,
            author_avatar: pr.user.avatar_url,
            created_at: pr.created_at,
            updated_at: pr.updated_at,
            merged_at: pr.merged_at,
            url: pr.html_url,
            draft: pr.draft,
            labels: pr.labels.map(l => l.name),
            repo: r.name,
          });
        }
      } catch (err) {
        // Skip repos with errors
      }
    }));

    allPRs.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    return allPRs.slice(0, 50);
  },

  async github_org_activity({ days = 7 }) {
    const since = new Date(Date.now() - Math.min(days, 30) * 24 * 60 * 60 * 1000).toISOString();

    const repos = await callGitHub(`/orgs/${GITHUB_ORG}/repos`, { sort: 'pushed', per_page: 50 });

    let totalCommits = 0;
    let totalOpenPRs = 0;
    const contributorMap = {};
    const repoActivity = [];

    await Promise.all(repos.map(async (r) => {
      let repoCommits = 0;
      let repoPRs = 0;
      try {
        const [commits, prs] = await Promise.all([
          callGitHub(`/repos/${GITHUB_ORG}/${r.name}/commits`, { since, per_page: 100 }),
          callGitHub(`/repos/${GITHUB_ORG}/${r.name}/pulls`, { state: 'open', per_page: 100 }),
        ]);
        repoCommits = commits.length;
        repoPRs = prs.length;
        totalCommits += commits.length;
        totalOpenPRs += prs.length;

        for (const c of commits) {
          const login = c.author?.login || c.commit.author.name;
          if (!contributorMap[login]) {
            contributorMap[login] = { login, avatar: c.author?.avatar_url || null, commits: 0 };
          }
          contributorMap[login].commits++;
        }
      } catch (err) {
        // Skip
      }
      repoActivity.push({
        repo: r.name,
        commits: repoCommits,
        open_prs: repoPRs,
        pushed_at: r.pushed_at,
        language: r.language,
      });
    }));

    const topContributors = Object.values(contributorMap)
      .sort((a, b) => b.commits - a.commits)
      .slice(0, 10);

    const activeRepos = repoActivity
      .filter(r => r.commits > 0)
      .sort((a, b) => b.commits - a.commits);

    return {
      org: GITHUB_ORG,
      period_days: Math.min(days, 30),
      since,
      total_repos: repos.length,
      total_commits: totalCommits,
      total_open_prs: totalOpenPRs,
      active_repos: activeRepos,
      top_contributors: topContributors,
    };
  },

  // ============ GCP CLOUD RUN MONITORING HANDLERS ============

  async get_cloudrun_service_info({ tenant }) {
    const auth = requireGcpAuth();
    const serviceName = getServiceName(tenant);
    const run = google.run({ version: 'v2', auth });
    const name = `projects/${GCP_PROJECT_ID}/locations/${GCP_REGION}/services/${serviceName}`;

    const { data } = await run.projects.locations.services.get({ name });
    const template = data.template || {};
    const container = template.containers?.[0] || {};
    const resources = container.resources?.limits || {};
    const scaling = template.scaling || {};

    return {
      service_name: serviceName,
      url: data.uri,
      latest_revision: data.latestReadyRevision?.split('/').pop() || null,
      image: container.image || null,
      cpu_limit: resources.cpu || null,
      memory_limit: resources.memory || null,
      min_instances: scaling.minInstanceCount || 0,
      max_instances: scaling.maxInstanceCount || null,
      last_deploy_time: data.updateTime || null,
      ingress: data.ingress || null,
    };
  },

  async get_cloudrun_metrics({ tenant, period }) {
    const auth = requireGcpAuth();
    const serviceName = getServiceName(tenant);
    const monitoring = google.monitoring({ version: 'v3', auth });

    const periodMap = { '1h': 3600, '6h': 21600, '24h': 86400, '7d': 604800, '30d': 2592000 };
    const seconds = periodMap[period] || periodMap['24h'];
    const now = new Date();
    const start = new Date(now.getTime() - seconds * 1000);

    const interval = {
      startTime: start.toISOString(),
      endTime: now.toISOString(),
    };
    const filter = (metric) =>
      `resource.type="cloud_run_revision" AND resource.labels.service_name="${serviceName}" AND metric.type="${metric}"`;

    async function fetchMetric(metricType, alignerOverride) {
      try {
        const { data } = await monitoring.projects.timeSeries.list({
          name: `projects/${GCP_PROJECT_ID}`,
          filter: filter(metricType),
          'interval.startTime': interval.startTime,
          'interval.endTime': interval.endTime,
          'aggregation.alignmentPeriod': `${seconds}s`,
          'aggregation.perSeriesAligner': alignerOverride || 'ALIGN_SUM',
          'aggregation.crossSeriesReducer': 'REDUCE_SUM',
        });
        return data.timeSeries || [];
      } catch {
        return [];
      }
    }

    const [requestSeries, latencySeries, instanceSeries] = await Promise.all([
      fetchMetric('run.googleapis.com/request_count', 'ALIGN_SUM'),
      fetchMetric('run.googleapis.com/request_latencies', 'ALIGN_PERCENTILE_99'),
      fetchMetric('run.googleapis.com/container/instance_count', 'ALIGN_MEAN'),
    ]);

    function sumPoints(series) {
      return series.reduce((sum, ts) => {
        return sum + (ts.points || []).reduce((s, p) => s + Number(p.value?.int64Value || p.value?.doubleValue || 0), 0);
      }, 0);
    }

    function avgPoints(series) {
      let total = 0, count = 0;
      for (const ts of series) {
        for (const p of ts.points || []) {
          total += Number(p.value?.doubleValue || p.value?.int64Value || 0);
          count++;
        }
      }
      return count > 0 ? total / count : 0;
    }

    const requestCount = sumPoints(requestSeries);
    const avgLatencyUs = avgPoints(latencySeries);
    const activeInstances = Math.round(avgPoints(instanceSeries));

    return {
      request_count: requestCount,
      avg_latency_ms: Math.round(avgLatencyUs / 1000 * 100) / 100,
      active_instances: activeInstances,
      period: period || '24h',
    };
  },

  async get_cloudrun_metrics_timeseries({ tenant, metric, period }) {
    const auth = requireGcpAuth();
    const serviceName = getServiceName(tenant);
    const monitoring = google.monitoring({ version: 'v3', auth });

    const periodMap = { '1h': 3600, '6h': 21600, '24h': 86400, '7d': 604800, '30d': 2592000 };
    const seconds = periodMap[period] || periodMap['24h'];
    const now = new Date();
    const start = new Date(now.getTime() - seconds * 1000);

    // Finer alignment for charts
    const alignmentMap = { '1h': 60, '6h': 300, '24h': 900, '7d': 3600, '30d': 14400 };
    const alignSec = alignmentMap[period] || alignmentMap['24h'];

    const metricMap = {
      request_count: { type: 'run.googleapis.com/request_count', aligner: 'ALIGN_SUM' },
      request_latencies: { type: 'run.googleapis.com/request_latencies', aligner: 'ALIGN_PERCENTILE_50' },
      instance_count: { type: 'run.googleapis.com/container/instance_count', aligner: 'ALIGN_MEAN' },
      cpu_utilization: { type: 'run.googleapis.com/container/cpu/utilizations', aligner: 'ALIGN_PERCENTILE_50' },
      memory_utilization: { type: 'run.googleapis.com/container/memory/utilizations', aligner: 'ALIGN_PERCENTILE_50' },
      error_count: { type: 'run.googleapis.com/request_count', aligner: 'ALIGN_SUM' },
    };

    const m = metricMap[metric];
    if (!m) throw new Error(`Unknown metric: ${metric}. Valid: ${Object.keys(metricMap).join(', ')}`);

    let extraFilter = '';
    if (metric === 'error_count') {
      extraFilter = ' AND metric.labels.response_code_class!="2xx"';
    }

    const { data } = await monitoring.projects.timeSeries.list({
      name: `projects/${GCP_PROJECT_ID}`,
      filter: `resource.type="cloud_run_revision" AND resource.labels.service_name="${serviceName}" AND metric.type="${m.type}"${extraFilter}`,
      'interval.startTime': start.toISOString(),
      'interval.endTime': now.toISOString(),
      'aggregation.alignmentPeriod': `${alignSec}s`,
      'aggregation.perSeriesAligner': m.aligner,
      'aggregation.crossSeriesReducer': 'REDUCE_SUM',
    });

    const isLatency = metric === 'request_latencies';
    const points = [];
    for (const ts of data.timeSeries || []) {
      for (const p of ts.points || []) {
        const raw = Number(p.value?.doubleValue || p.value?.int64Value || 0);
        points.push({
          timestamp: p.interval?.endTime,
          value: isLatency ? Math.round(raw / 1000 * 100) / 100 : raw,
        });
      }
    }

    points.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    return { metric, period: period || '24h', data: points };
  },

  async get_all_deployments_metrics({ period }) {
    const auth = getGcpAuth();
    if (!auth) {
      // Graceful fallback — return empty metrics for each tenant
      return Object.keys(TENANT_SERVICE_MAP).map(tenant => ({
        tenant,
        service_name: TENANT_SERVICE_MAP[tenant],
        request_count: null,
        avg_latency_ms: null,
        active_instances: null,
        error: 'GCP credentials not configured',
      }));
    }

    const results = await Promise.allSettled(
      Object.keys(TENANT_SERVICE_MAP).map(async (tenant) => {
        const metrics = await handlers.get_cloudrun_metrics({ tenant, period: period || '1h' });
        return { tenant, service_name: TENANT_SERVICE_MAP[tenant], ...metrics };
      })
    );

    return results.map((r, i) => {
      const tenant = Object.keys(TENANT_SERVICE_MAP)[i];
      if (r.status === 'fulfilled') return r.value;
      return { tenant, service_name: TENANT_SERVICE_MAP[tenant], error: r.reason?.message };
    });
  },

  async get_cloudrun_revisions({ tenant, limit }) {
    const auth = requireGcpAuth();
    const serviceName = getServiceName(tenant);
    const run = google.run({ version: 'v2', auth });
    const parent = `projects/${GCP_PROJECT_ID}/locations/${GCP_REGION}/services/${serviceName}`;

    const { data } = await run.projects.locations.services.revisions.list({
      parent,
      pageSize: limit || 10,
    });

    return (data.revisions || []).map((rev) => {
      const container = rev.containers?.[0] || {};
      return {
        name: rev.name?.split('/').pop(),
        create_time: rev.createTime,
        image: container.image || null,
        scaling: rev.scaling || {},
        conditions: (rev.conditions || []).map(c => ({ type: c.type, state: c.state })),
      };
    });
  },

  async get_deployment_logs({ tenant, severity, limit: maxEntries, hours_back, search }) {
    const auth = requireGcpAuth();
    const serviceName = getServiceName(tenant);
    const logging = google.logging({ version: 'v2', auth });

    const hours = hours_back || 1;
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();

    let filter = `resource.type="cloud_run_revision" AND resource.labels.service_name="${serviceName}" AND timestamp>="${since}"`;
    const validSeverities = ['DEFAULT', 'DEBUG', 'INFO', 'NOTICE', 'WARNING', 'ERROR', 'CRITICAL', 'ALERT', 'EMERGENCY'];
    if (severity && validSeverities.includes(severity)) filter += ` AND severity="${severity}"`;
    if (search) {
      const sanitized = search.replace(/["\\]/g, '');
      if (sanitized) filter += ` AND (textPayload=~"${sanitized}" OR jsonPayload.message=~"${sanitized}" OR httpRequest.requestUrl=~"${sanitized}")`;
    }

    const { data } = await logging.entries.list({
      requestBody: {
        resourceNames: [`projects/${GCP_PROJECT_ID}`],
        filter,
        orderBy: 'timestamp desc',
        pageSize: maxEntries || 50,
      },
    });

    return (data.entries || []).map((entry) => ({
      timestamp: entry.timestamp,
      severity: entry.severity || 'DEFAULT',
      message: extractLogMessage(entry),
      log_name: entry.logName?.split('/').pop(),
      trace_id: entry.trace || null,
      json_payload: entry.jsonPayload || entry.httpRequest || entry.protoPayload || null,
    }));
  },

  async get_deployment_log_summary({ tenant, hours_back }) {
    const auth = requireGcpAuth();
    const serviceName = getServiceName(tenant);
    const logging = google.logging({ version: 'v2', auth });

    const hours = hours_back || 24;
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const filter = `resource.type="cloud_run_revision" AND resource.labels.service_name="${serviceName}" AND timestamp>="${since}"`;

    // Fetch severity counts + recent errors in parallel
    const severities = ['ERROR', 'WARNING', 'INFO', 'DEBUG', 'NOTICE', 'CRITICAL'];
    const counts = {};

    const countPromises = severities.map(async (sev) => {
      try {
        const { data } = await logging.entries.list({
          requestBody: {
            resourceNames: [`projects/${GCP_PROJECT_ID}`],
            filter: `${filter} AND severity="${sev}"`,
            pageSize: 1,
          },
        });
        counts[sev] = data.entries?.length ? 1 : 0;
      } catch {
        counts[sev] = 0;
      }
    });

    const errorPromise = logging.entries.list({
      requestBody: {
        resourceNames: [`projects/${GCP_PROJECT_ID}`],
        filter: `${filter} AND severity>="ERROR"`,
        orderBy: 'timestamp desc',
        pageSize: 5,
      },
    }).catch(() => ({ data: { entries: [] } }));

    await Promise.all([...countPromises, errorPromise]);
    const { data: errorData } = await errorPromise;

    const recentErrors = (errorData.entries || []).map((e) => ({
      timestamp: e.timestamp,
      severity: e.severity,
      message: extractLogMessage(e),
    }));

    return {
      hours_back: hours,
      by_severity: counts,
      recent_errors: recentErrors,
    };
  },

  async get_firebase_users({ tenant, include_list }) {
    // Firebase user stats require per-tenant Firebase admin credentials
    // This is a placeholder that returns a graceful fallback
    // TODO: implement when per-tenant Firebase service accounts are available
    return {
      tenant,
      error: 'Firebase user stats not yet configured for this tenant',
      total_users: null,
      active_last_24h: null,
      active_last_7d: null,
    };
  },

  // ============ BUILD AGENTS (Layer 1) ============

  async list_build_runs({ status, repo, limit }) {
    const max = Math.min(limit || 20, 100);
    let sql = 'SELECT * FROM build_runs WHERE 1=1';
    const params = [];
    let idx = 1;
    if (status) { sql += ` AND status = $${idx++}`; params.push(status); }
    if (repo) { sql += ` AND repo = $${idx++}`; params.push(repo); }
    sql += ` ORDER BY created_at DESC LIMIT $${idx}`;
    params.push(max);
    return await query(sql, params);
  },

  async get_build_run({ id }) {
    const run = await queryOne('SELECT * FROM build_runs WHERE id = $1', [id]);
    if (!run) throw new Error(`Build run not found: ${id}`);
    const tasks = await query('SELECT * FROM build_tasks WHERE build_run_id = $1 ORDER BY created_at', [id]);
    return { ...run, tasks };
  },

  async create_build_run({ spec_title, spec_body, repo, branch }) {
    const rows = await query(
      `INSERT INTO build_runs (spec_title, spec_body, repo, branch) VALUES ($1, $2, $3, $4) RETURNING *`,
      [spec_title, spec_body, repo, branch || 'main']
    );
    return { success: true, build_run: rows[0] };
  },

  async cancel_build_run({ id }) {
    const rows = await query(
      `UPDATE build_runs SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND status IN ('pending', 'running') RETURNING *`,
      [id]
    );
    if (!rows.length) throw new Error(`Build run not found or not cancellable: ${id}`);
    // Also cancel any pending/running tasks
    await query(
      `UPDATE build_tasks SET status = 'cancelled', updated_at = NOW() WHERE build_run_id = $1 AND status IN ('pending', 'running')`,
      [id]
    );
    return { success: true, build_run: rows[0] };
  },

  async get_build_task_log({ task_id }) {
    const task = await queryOne('SELECT id, title, status, output_log, files_changed, error_message, started_at, completed_at FROM build_tasks WHERE id = $1', [task_id]);
    if (!task) throw new Error(`Build task not found: ${task_id}`);
    return task;
  },

  // ============ MONITORING (Layer 2) ============

  async list_error_events({ service, severity, acknowledged, limit }) {
    const max = Math.min(limit || 50, 200);
    let sql = 'SELECT * FROM error_events WHERE 1=1';
    const params = [];
    let idx = 1;
    if (service) { sql += ` AND service = $${idx++}`; params.push(service); }
    if (severity) { sql += ` AND severity = $${idx++}`; params.push(severity); }
    if (acknowledged !== undefined) { sql += ` AND acknowledged = $${idx++}`; params.push(acknowledged); }
    sql += ` ORDER BY last_seen_at DESC LIMIT $${idx}`;
    params.push(max);
    return await query(sql, params);
  },

  async get_error_event({ id }) {
    const event = await queryOne('SELECT * FROM error_events WHERE id = $1', [id]);
    if (!event) throw new Error(`Error event not found: ${id}`);
    const triage = await query('SELECT * FROM error_triage WHERE error_event_id = $1 ORDER BY created_at DESC', [id]);
    return { ...event, triage };
  },

  async list_error_triage({ category, auto_fixable, limit }) {
    const max = Math.min(limit || 50, 200);
    let sql = `SELECT et.*, ee.service, ee.severity, ee.message as error_message, ee.occurrence_count
               FROM error_triage et JOIN error_events ee ON et.error_event_id = ee.id WHERE 1=1`;
    const params = [];
    let idx = 1;
    if (category) { sql += ` AND et.category = $${idx++}`; params.push(category); }
    if (auto_fixable !== undefined) { sql += ` AND et.auto_fixable = $${idx++}`; params.push(auto_fixable); }
    sql += ` ORDER BY et.created_at DESC LIMIT $${idx}`;
    params.push(max);
    return await query(sql, params);
  },

  async get_monitoring_stats() {
    const [totalErrors, byService, bySeverity, unacked, autoFixable] = await Promise.all([
      queryOne(`SELECT COUNT(*) as total FROM error_events WHERE last_seen_at > NOW() - INTERVAL '24 hours'`),
      query(`SELECT service, COUNT(*) as count FROM error_events WHERE last_seen_at > NOW() - INTERVAL '24 hours' GROUP BY service ORDER BY count DESC`),
      query(`SELECT severity, COUNT(*) as count FROM error_events WHERE last_seen_at > NOW() - INTERVAL '24 hours' GROUP BY severity`),
      queryOne(`SELECT COUNT(*) as total FROM error_events WHERE acknowledged = FALSE`),
      queryOne(`SELECT COUNT(*) as total FROM error_triage WHERE auto_fixable = TRUE AND autofix_run_id IS NULL`)
    ]);
    return {
      last_24h: {
        total_errors: parseInt(totalErrors.total),
        by_service: byService,
        by_severity: bySeverity,
      },
      unacknowledged: parseInt(unacked.total),
      pending_autofixes: parseInt(autoFixable.total),
    };
  },

  async acknowledge_error({ id }) {
    const rows = await query(
      `UPDATE error_events SET acknowledged = TRUE WHERE id = $1 RETURNING *`,
      [id]
    );
    if (!rows.length) throw new Error(`Error event not found: ${id}`);
    return { success: true, error_event: rows[0] };
  },

  // ============ AUTO-FIX (Layer 3) ============

  async list_autofix_runs({ status, repo, limit }) {
    const max = Math.min(limit || 20, 100);
    let sql = `SELECT ar.*, et.category, et.root_cause, ee.service, ee.message as error_message
               FROM autofix_runs ar
               LEFT JOIN error_triage et ON ar.error_triage_id = et.id
               LEFT JOIN error_events ee ON et.error_event_id = ee.id
               WHERE 1=1`;
    const params = [];
    let idx = 1;
    if (status) { sql += ` AND ar.status = $${idx++}`; params.push(status); }
    if (repo) { sql += ` AND ar.repo = $${idx++}`; params.push(repo); }
    sql += ` ORDER BY ar.created_at DESC LIMIT $${idx}`;
    params.push(max);
    return await query(sql, params);
  },

  async get_autofix_run({ id }) {
    const run = await queryOne(
      `SELECT ar.*, et.category, et.root_cause, et.suggested_fix, ee.service, ee.severity, ee.message as error_message
       FROM autofix_runs ar
       LEFT JOIN error_triage et ON ar.error_triage_id = et.id
       LEFT JOIN error_events ee ON et.error_event_id = ee.id
       WHERE ar.id = $1`,
      [id]
    );
    if (!run) throw new Error(`Autofix run not found: ${id}`);
    return run;
  },

  async trigger_autofix({ error_triage_id, repo }) {
    const triage = await queryOne('SELECT * FROM error_triage WHERE id = $1', [error_triage_id]);
    if (!triage) throw new Error(`Error triage not found: ${error_triage_id}`);
    const rows = await query(
      `INSERT INTO autofix_runs (error_triage_id, repo, status) VALUES ($1, $2, 'pending') RETURNING *`,
      [error_triage_id, repo]
    );
    // Link autofix run back to triage
    await query('UPDATE error_triage SET autofix_run_id = $1 WHERE id = $2', [rows[0].id, error_triage_id]);
    return { success: true, autofix_run: rows[0] };
  },

  async cancel_autofix({ id }) {
    const rows = await query(
      `UPDATE autofix_runs SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND status IN ('pending', 'running', 'testing') RETURNING *`,
      [id]
    );
    if (!rows.length) throw new Error(`Autofix run not found or not cancellable: ${id}`);
    return { success: true, autofix_run: rows[0] };
  }
};

// ============ CRM INSTANCE REST API ============

// List all configured CRM instances
app.get('/api/instances', (req, res) => {
  const instances = CRM_COMPANIES.map(company => {
    const config = getCRMConfig(company);
    return { company, configured: !!config.url, url: config.url || null };
  });
  res.json(instances);
});

// Health check all CRM instances
app.get('/api/instances/health', async (req, res) => {
  const results = {};
  await Promise.all(CRM_COMPANIES.map(async (company) => {
    const config = getCRMConfig(company);
    if (!config.url) {
      results[company] = { status: 'not_configured' };
      return;
    }
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const resp = await fetch(`${config.url}/api/health`, {
        headers: { 'X-Tenant-ID': config.tenantId, 'X-API-Key': config.apiKey },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const latency = Date.now() - start;
      if (resp.ok) {
        results[company] = { status: latency > 5000 ? 'degraded' : 'healthy', latency_ms: latency };
      } else {
        results[company] = { status: 'unhealthy', latency_ms: latency, http_status: resp.status };
      }
    } catch (err) {
      results[company] = { status: 'down', error: err.message, latency_ms: Date.now() - start };
    }
  }));
  res.json(results);
});

// List users for a company
app.get('/api/instances/:company/users', async (req, res) => {
  try {
    const { company } = req.params;
    const { search, role, page, limit } = req.query;
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (role) params.set('role', role);
    if (page) params.set('page', page);
    if (limit) params.set('limit', limit);
    const qs = params.toString();
    const result = await callCRM(company, 'GET', `/admin/users${qs ? '?' + qs : ''}`, null);
    res.json({ company, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create user on a company's CRM
app.post('/api/instances/:company/users', async (req, res) => {
  try {
    const { company } = req.params;
    const { email, password, displayName, role } = req.body;
    if (!email || !password || !displayName) {
      return res.status(400).json({ error: 'email, password, and displayName are required' });
    }
    const result = await callCRM(company, 'POST', '/admin/users', { email, password, displayName, role: role || 'agent' });
    res.json({ company, ...result, success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update user role
app.patch('/api/instances/:company/users/:uid/role', async (req, res) => {
  try {
    const { company, uid } = req.params;
    const { role } = req.body;
    if (!role) return res.status(400).json({ error: 'role is required' });
    const result = await callCRM(company, 'PATCH', `/admin/users/${uid}/role`, { role });
    res.json({ company, ...result, success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete user
app.delete('/api/instances/:company/users/:uid', async (req, res) => {
  try {
    const { company, uid } = req.params;
    const result = await callCRM(company, 'DELETE', `/admin/users/${uid}`, null);
    res.json({ company, deleted: uid, ...result, success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset user password
app.post('/api/instances/:company/users/:uid/reset-password', async (req, res) => {
  try {
    const { company, uid } = req.params;
    const { newPassword } = req.body;
    if (!newPassword) return res.status(400).json({ error: 'newPassword is required' });
    const result = await callCRM(company, 'POST', '/admin/change-password', { userId: uid, newPassword });
    res.json({ company, user_id: uid, ...result, success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ FEEDBACK AGGREGATION REST API ============

// Aggregate feedback from all (or filtered) companies
app.get('/api/feedback/all', async (req, res) => {
  const { status, type, company: filterCompany } = req.query;
  const companies = filterCompany
    ? [filterCompany]
    : CRM_COMPANIES.filter(c => getCRMConfig(c).url);

  const results = [];
  const errors = {};

  await Promise.all(companies.map(async (company) => {
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (type) params.set('type', type);
      const qs = params.toString();
      const data = await callCRM(company, 'GET', `/tester-feedback${qs ? '?' + qs : ''}`, null);
      const items = Array.isArray(data) ? data : [];
      results.push(...items.map(item => ({ ...item, _company: company })));
    } catch (err) {
      errors[company] = err.message;
    }
  }));

  // Sort: CRITICAL > HIGH > MEDIUM > LOW, then newest first
  const priorityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  results.sort((a, b) => {
    const pDiff = (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9);
    if (pDiff !== 0) return pDiff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  res.json({ feedback: results, errors, totalCompanies: companies.length });
});

// Aggregate feedback stats from all companies
app.get('/api/feedback/stats', async (req, res) => {
  const companies = CRM_COMPANIES.filter(c => getCRMConfig(c).url);
  const perCompany = {};
  const aggregated = { total: 0, byStatus: {}, byType: {}, recentCount: 0, byCompany: {} };

  await Promise.all(companies.map(async (company) => {
    try {
      const stats = await callCRM(company, 'GET', '/tester-feedback/stats', null);
      perCompany[company] = stats;
      aggregated.total += stats.total || 0;
      aggregated.recentCount += stats.recentCount || 0;
      aggregated.byCompany[company] = stats.total || 0;
      for (const [s, count] of Object.entries(stats.byStatus || {})) {
        aggregated.byStatus[s] = (aggregated.byStatus[s] || 0) + count;
      }
      for (const [t, count] of Object.entries(stats.byType || {})) {
        aggregated.byType[t] = (aggregated.byType[t] || 0) + count;
      }
    } catch (err) {
      perCompany[company] = { error: err.message };
    }
  }));

  res.json({ aggregated, perCompany });
});

// Get single feedback item
app.get('/api/feedback/:company/:id', async (req, res) => {
  try {
    const { company, id } = req.params;
    const result = await callCRM(company, 'GET', `/tester-feedback/${id}`, null);
    res.json({ ...result, _company: company });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update feedback status/priority/resolution
app.patch('/api/feedback/:company/:id', async (req, res) => {
  try {
    const { company, id } = req.params;
    const { status, priority, resolutionNotes } = req.body;
    const body = {};
    if (status) body.status = status;
    if (priority) body.priority = priority;
    if (resolutionNotes !== undefined) body.resolutionNotes = resolutionNotes;
    const result = await callCRM(company, 'PATCH', `/tester-feedback/${id}`, body);
    res.json({ ...result, _company: company, success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ GITHUB REST API ============

app.get('/api/github/repos', async (req, res) => {
  try {
    const result = await handlers.github_list_repos({
      sort: req.query.sort || 'pushed',
      per_page: parseInt(req.query.per_page) || 30,
    });
    res.json({ repos: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/github/commits', async (req, res) => {
  try {
    const result = await handlers.github_list_commits({
      repo: req.query.repo || undefined,
      author: req.query.author || undefined,
      since: req.query.since || undefined,
      per_page: parseInt(req.query.per_page) || 10,
    });
    res.json({ commits: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/github/prs', async (req, res) => {
  try {
    const result = await handlers.github_list_prs({
      repo: req.query.repo || undefined,
      state: req.query.state || 'open',
      per_page: parseInt(req.query.per_page) || 10,
    });
    res.json({ prs: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/github/activity', async (req, res) => {
  try {
    const result = await handlers.github_org_activity({
      days: parseInt(req.query.days) || 7,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ DASHBOARD USER MANAGEMENT (Firebase Admin) ============

function requireFirebase(res) {
  if (!admin.apps?.length) {
    res.status(503).json({ error: 'Firebase Admin not configured' });
    return false;
  }
  return true;
}

// List all dashboard users (from Firebase Auth)
app.get('/api/dashboard-users', async (req, res) => {
  if (!requireFirebase(res)) return;
  try {
    const listResult = await admin.auth().listUsers(1000);
    const users = listResult.users.map(u => ({
      uid: u.uid,
      email: u.email,
      displayName: u.displayName || u.email?.split('@')[0] || 'User',
      role: u.customClaims?.role || 'agent',
      createdAt: u.metadata.creationTime,
      lastLogin: u.metadata.lastSignInTime,
      disabled: u.disabled,
    }));
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get user by email (for AuthContext role lookup)
app.get('/api/dashboard-users/by-email/:email', async (req, res) => {
  if (!requireFirebase(res)) return;
  try {
    const user = await admin.auth().getUserByEmail(req.params.email);
    res.json({
      uid: user.uid,
      email: user.email,
      displayName: user.displayName || user.email?.split('@')[0] || 'User',
      role: user.customClaims?.role || 'agent',
      createdAt: user.metadata.creationTime,
      lastLogin: user.metadata.lastSignInTime,
    });
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      res.status(404).json({ error: 'User not found' });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// Create a dashboard user
app.post('/api/dashboard-users', async (req, res) => {
  if (!requireFirebase(res)) return;
  try {
    const { email, password, displayName, role } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    const user = await admin.auth().createUser({
      email,
      password,
      displayName: displayName || email.split('@')[0],
    });
    if (role) {
      await admin.auth().setCustomUserClaims(user.uid, { role });
    }
    res.json({
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      role: role || 'agent',
      success: true,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update user role (via custom claims)
app.patch('/api/dashboard-users/:uid/role', async (req, res) => {
  if (!requireFirebase(res)) return;
  try {
    const { role } = req.body;
    if (!['admin', 'manager', 'agent'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be admin, manager, or agent' });
    }
    await admin.auth().setCustomUserClaims(req.params.uid, { role });
    res.json({ uid: req.params.uid, role, success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a dashboard user
app.delete('/api/dashboard-users/:uid', async (req, res) => {
  if (!requireFirebase(res)) return;
  try {
    await admin.auth().deleteUser(req.params.uid);
    res.json({ uid: req.params.uid, deleted: true, success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ BUILD AGENTS REST API ============

app.get('/api/build-runs', async (req, res) => {
  try {
    const result = await handlers.list_build_runs({ status: req.query.status, repo: req.query.repo, limit: parseInt(req.query.limit) || 20 });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/build-runs/:id', async (req, res) => {
  try {
    const result = await handlers.get_build_run({ id: req.params.id });
    res.json(result);
  } catch (err) { res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message }); }
});

app.post('/api/build-runs', async (req, res) => {
  try {
    const result = await handlers.create_build_run(req.body);
    res.status(201).json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/build-runs/:id/cancel', async (req, res) => {
  try {
    const result = await handlers.cancel_build_run({ id: req.params.id });
    res.json(result);
  } catch (err) { res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message }); }
});

app.get('/api/build-tasks/:id/log', async (req, res) => {
  try {
    const result = await handlers.get_build_task_log({ task_id: req.params.id });
    res.json(result);
  } catch (err) { res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message }); }
});

// ============ MONITORING REST API ============

app.get('/api/error-events', async (req, res) => {
  try {
    const result = await handlers.list_error_events({
      service: req.query.service, severity: req.query.severity,
      acknowledged: req.query.acknowledged !== undefined ? req.query.acknowledged === 'true' : undefined,
      limit: parseInt(req.query.limit) || 50
    });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/error-events/:id', async (req, res) => {
  try {
    const result = await handlers.get_error_event({ id: req.params.id });
    res.json(result);
  } catch (err) { res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message }); }
});

app.post('/api/error-events/:id/acknowledge', async (req, res) => {
  try {
    const result = await handlers.acknowledge_error({ id: req.params.id });
    res.json(result);
  } catch (err) { res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message }); }
});

app.get('/api/error-triage', async (req, res) => {
  try {
    const result = await handlers.list_error_triage({
      category: req.query.category,
      auto_fixable: req.query.auto_fixable !== undefined ? req.query.auto_fixable === 'true' : undefined,
      limit: parseInt(req.query.limit) || 50
    });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/monitoring/stats', async (req, res) => {
  try {
    const result = await handlers.get_monitoring_stats();
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============ AUTO-FIX REST API ============

app.get('/api/autofix-runs', async (req, res) => {
  try {
    const result = await handlers.list_autofix_runs({ status: req.query.status, repo: req.query.repo, limit: parseInt(req.query.limit) || 20 });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/autofix-runs/:id', async (req, res) => {
  try {
    const result = await handlers.get_autofix_run({ id: req.params.id });
    res.json(result);
  } catch (err) { res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message }); }
});

app.post('/api/autofix-runs', async (req, res) => {
  try {
    const result = await handlers.trigger_autofix(req.body);
    res.status(201).json(result);
  } catch (err) { res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message }); }
});

app.post('/api/autofix-runs/:id/cancel', async (req, res) => {
  try {
    const result = await handlers.cancel_autofix({ id: req.params.id });
    res.json(result);
  } catch (err) { res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message }); }
});

// ============ CHAT ENDPOINT - THE BRAIN ============
app.post('/chat', async (req, res) => {
  try {
    const { message, conversation_history = [] } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });

    const messages = [...conversation_history, { role: 'user', content: message }];
    const claudeTools = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));

    let response = await anthropic.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 4096, system: SYSTEM_PROMPT, tools: claudeTools, messages });

    while (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });
      const toolResults = [];
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          console.log(`Tool: ${block.name}`, block.input);
          try {
            const result = await handlers[block.name](block.input);
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
          } catch (err) {
            console.error(`Tool error (${block.name}):`, err);
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ error: err.message }), is_error: true });
          }
        }
      }
      messages.push({ role: 'user', content: toolResults });
      response = await anthropic.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 4096, system: SYSTEM_PROMPT, tools: claudeTools, messages });
    }

    const textContent = response.content.find(b => b.type === 'text');
    res.json({ response: textContent?.text || 'No response', conversation_history: messages.concat([{ role: 'assistant', content: response.content }]) });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ FILE UPLOAD ENDPOINT ============
app.post('/upload', async (req, res) => {
  try {
    const { slug, filename, content_base64, content_type, category, description } = req.body;
    if (!slug || !filename || !content_base64 || !content_type) {
      return res.status(400).json({ error: 'Missing required fields: slug, filename, content_base64, content_type' });
    }
    const result = await handlers.upload_document({ slug, filename, content_base64, content_type, category, description });
    res.json(result);
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ MCP ENDPOINTS ============
app.get('/mcp', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
  const keepAlive = setInterval(() => { res.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`); }, 30000);
  req.on('close', () => { clearInterval(keepAlive); });
});

app.get('/tools', (req, res) => { res.json({ tools }); });

app.post('/tools/:name', async (req, res) => {
  const { name } = req.params;
  if (!handlers[name]) return res.status(404).json({ error: `Tool not found: ${name}` });
  try {
    const result = await handlers[name](req.body);
    res.json({ result });
  } catch (error) {
    console.error(`Error executing ${name}:`, error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/mcp', async (req, res) => {
  const { method, params } = req.body;
  try {
    switch (method) {
      case 'initialize':
        res.json({ protocolVersion: '2024-11-05', serverInfo: { name: 'project-tracker', version: '1.0.0' }, capabilities: { tools: {} } });
        break;
      case 'tools/list':
        res.json({ tools });
        break;
      case 'tools/call': {
        const { name, arguments: args } = params;
        if (!handlers[name]) { res.status(404).json({ error: `Tool not found: ${name}` }); return; }
        const result = await handlers[name](args || {});
        res.json({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
        break;
      }
      default:
        res.status(400).json({ error: `Unknown method: ${method}` });
    }
  } catch (error) {
    console.error('MCP error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'degraded', database: 'disconnected', error: err.message, timestamp: new Date().toISOString() });
  }
});

app.get('/', (req, res) => {
  res.json({
    name: 'MCP Project Tracker',
    description: 'Digital Alpha AI-in-a-Box Portfolio Tracker',
    endpoints: {
      '/health': 'Health check',
      '/tools': 'List available tools',
      '/tools/:name': 'Execute a tool (POST)',
      '/mcp': 'MCP protocol endpoint',
      '/chat': 'Natural language chat endpoint (POST)',
      '/upload': 'File upload endpoint (POST)',
      '/api/instances': 'List CRM instances (GET)',
      '/api/instances/health': 'Health check all CRM instances (GET)',
      '/api/instances/:company/users': 'List/Create CRM users (GET/POST)',
      '/api/instances/:company/users/:uid/role': 'Update user role (PATCH)',
      '/api/instances/:company/users/:uid': 'Delete user (DELETE)',
      '/api/instances/:company/users/:uid/reset-password': 'Reset password (POST)',
      '/api/feedback/all': 'Aggregate feedback from all CRM instances (GET)',
      '/api/feedback/stats': 'Aggregate feedback stats (GET)',
      '/api/feedback/:company/:id': 'Get/Update feedback item (GET/PATCH)',
      '/api/dashboard-users': 'List/Create dashboard users (GET/POST)',
      '/api/dashboard-users/by-email/:email': 'Get user by email (GET)',
      '/api/dashboard-users/:uid/role': 'Update user role (PATCH)',
      '/api/dashboard-users/:uid': 'Delete user (DELETE)',
      '/api/github/repos': 'List org repos (GET)',
      '/api/github/commits': 'List commits, ?repo=X&author=Y&since=Z (GET)',
      '/api/github/prs': 'List PRs, ?repo=X&state=open|closed|all (GET)',
      '/api/github/activity': 'Org activity summary, ?days=7 (GET)'
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`MCP Project Tracker running on port ${PORT}`);
});

import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import Anthropic from '@anthropic-ai/sdk';
import { google } from 'googleapis';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

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
  }
];

// ============ TOOL HANDLERS ============
const handlers = {
  async list_companies() {
    const { data, error } = await supabase
      .from('companies')
      .select('id, slug, name, description, status, tools, created_at');
    if (error) throw error;
    return data;
  },

  async get_company({ slug }) {
    const { data, error } = await supabase
      .from('companies')
      .select(`
        *,
        contacts(*),
        milestones(*),
        documents(*),
        requirements(*),
        activity(*)
      `)
      .eq('slug', slug)
      .single();
    if (error) throw error;
    
    if (data.milestones) data.milestones.sort((a, b) => a.order_index - b.order_index);
    if (data.activity) data.activity.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    return data;
  },

  async update_company_status({ slug, status }) {
    const { data, error } = await supabase
      .from('companies')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('slug', slug)
      .select();
    if (error) throw error;
    return { success: true, company: data[0] };
  },

  async list_milestones({ slug }) {
    const { data: company } = await supabase
      .from('companies').select('id').eq('slug', slug).single();
    if (!company) throw new Error(`Company not found: ${slug}`);
    
    const { data, error } = await supabase
      .from('milestones')
      .select('*')
      .eq('company_id', company.id)
      .order('order_index');
    if (error) throw error;
    return data;
  },

  async update_milestone({ milestone_id, status, notes }) {
    const update = { 
      status,
      updated_at: new Date().toISOString()
    };
    if (status === 'done') update.completed_at = new Date().toISOString();
    if (notes) update.notes = notes;
    
    const { data, error } = await supabase
      .from('milestones')
      .update(update)
      .eq('id', milestone_id)
      .select();
    if (error) throw error;
    return { success: true, milestone: data[0] };
  },

  async add_milestone({ slug, title, due_date }) {
    const { data: company } = await supabase
      .from('companies').select('id').eq('slug', slug).single();
    if (!company) throw new Error(`Company not found: ${slug}`);
    
    const { data: existing } = await supabase
      .from('milestones')
      .select('order_index')
      .eq('company_id', company.id)
      .order('order_index', { ascending: false })
      .limit(1);
    
    const order_index = existing?.length ? existing[0].order_index + 1 : 0;
    
    const { data, error } = await supabase
      .from('milestones')
      .insert({ company_id: company.id, title, due_date, order_index })
      .select();
    if (error) throw error;
    return { success: true, milestone: data[0] };
  },

  async add_note({ slug, content, type = 'note' }) {
    const { data: company } = await supabase
      .from('companies').select('id').eq('slug', slug).single();
    if (!company) throw new Error(`Company not found: ${slug}`);
    
    const { data, error } = await supabase
      .from('activity')
      .insert({ company_id: company.id, content, type })
      .select();
    if (error) throw error;
    return { success: true, activity: data[0] };
  },

  async get_recent_activity({ slug, limit = 20 }) {
    let query = supabase
      .from('activity')
      .select('*, companies(name, slug)')
      .order('created_at', { ascending: false })
      .limit(limit);
    
    if (slug) {
      const { data: company } = await supabase
        .from('companies').select('id').eq('slug', slug).single();
      if (company) {
        query = query.eq('company_id', company.id);
      }
    }
    
    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  async update_requirement({ slug, item, status }) {
    const { data: company } = await supabase
      .from('companies').select('id').eq('slug', slug).single();
    if (!company) throw new Error(`Company not found: ${slug}`);
    
    const { data, error } = await supabase
      .from('requirements')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('company_id', company.id)
      .ilike('item', `%${item}%`)
      .select();
    if (error) throw error;
    return { success: true, requirement: data[0] };
  },

  async add_requirement({ slug, item, status = 'needed' }) {
    const { data: company } = await supabase
      .from('companies').select('id').eq('slug', slug).single();
    if (!company) throw new Error(`Company not found: ${slug}`);
    
    const { data, error } = await supabase
      .from('requirements')
      .insert({ company_id: company.id, item, status })
      .select();
    if (error) throw error;
    return { success: true, requirement: data[0] };
  },

  async list_documents({ slug }) {
    const { data: company } = await supabase
      .from('companies').select('id').eq('slug', slug).single();
    if (!company) throw new Error(`Company not found: ${slug}`);
    
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .eq('company_id', company.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async add_document({ slug, name, type, url, notes }) {
    const { data: company } = await supabase
      .from('companies').select('id').eq('slug', slug).single();
    if (!company) throw new Error(`Company not found: ${slug}`);
    
    const { data, error } = await supabase
      .from('documents')
      .insert({ company_id: company.id, name, type, url, notes })
      .select();
    if (error) throw error;
    return { success: true, document: data[0] };
  },

  async add_contact({ slug, name, role, email, phone }) {
    const { data: company } = await supabase
      .from('companies').select('id').eq('slug', slug).single();
    if (!company) throw new Error(`Company not found: ${slug}`);
    
    const { data, error } = await supabase
      .from('contacts')
      .insert({ company_id: company.id, name, role, email, phone })
      .select();
    if (error) throw error;
    return { success: true, contact: data[0] };
  },

  async list_contacts({ slug }) {
    const { data: company } = await supabase
      .from('companies').select('id').eq('slug', slug).single();
    if (!company) throw new Error(`Company not found: ${slug}`);
    
    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .eq('company_id', company.id);
    if (error) throw error;
    return data;
  },

  async get_portfolio_summary() {
    const { data: companies, error } = await supabase
      .from('companies')
      .select(`
        slug, name, status,
        milestones(status)
      `);
    if (error) throw error;
    
    return companies.map(c => {
      const total = c.milestones?.length || 0;
      const done = c.milestones?.filter(m => m.status === 'done').length || 0;
      return {
        name: c.name,
        slug: c.slug,
        status: c.status,
        progress: total ? Math.round((done / total) * 100) : 0,
        milestones: `${done}/${total}`
      };
    });
  },

  async send_email({ to, subject, body }) {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
      throw new Error('Email not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD environment variables.');
    }
    
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to,
      subject,
      html: body
    });
    
    return { success: true, message: `Email sent to ${to}` };
  },

  async send_project_update({ to, subject, include_details = false }) {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
      throw new Error('Email not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD environment variables.');
    }
    
    const { data: companies, error } = await supabase
      .from('companies')
      .select(`
        slug, name, status, description,
        milestones(title, status, order_index),
        requirements(item, status)
      `);
    if (error) throw error;
    
    const date = new Date().toLocaleDateString('en-US', { 
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
    });
    
    let html = `
      <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto;">
        <h1 style="color: #1a365d; border-bottom: 2px solid #1a365d; padding-bottom: 10px;">
          AI-in-a-Box Portfolio Update
        </h1>
        <p style="color: #666; font-size: 14px;">${date}</p>
        
        <h2 style="color: #1a365d; margin-top: 30px;">Portfolio Summary</h2>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px;">
          <tr style="background: #f0f4f8;">
            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #ddd;">Company</th>
            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #ddd;">Status</th>
            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #ddd;">Progress</th>
          </tr>
    `;
    
    for (const c of companies) {
      const total = c.milestones?.length || 0;
      const done = c.milestones?.filter(m => m.status === 'done').length || 0;
      const progress = total ? Math.round((done / total) * 100) : 0;
      
      const statusColor = {
        'active': '#28a745',
        'discovery': '#ffc107',
        'pilot': '#17a2b8',
        'deployed': '#007bff'
      }[c.status] || '#6c757d';
      
      html += `
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #ddd;"><strong>${c.name}</strong></td>
          <td style="padding: 12px; border-bottom: 1px solid #ddd;">
            <span style="background: ${statusColor}; color: white; padding: 4px 10px; border-radius: 12px; font-size: 12px;">
              ${c.status}
            </span>
          </td>
          <td style="padding: 12px; border-bottom: 1px solid #ddd;">
            <div style="background: #e9ecef; border-radius: 10px; height: 20px; width: 150px; overflow: hidden;">
              <div style="background: linear-gradient(90deg, #28a745, #20c997); height: 100%; width: ${progress}%;"></div>
            </div>
            <span style="font-size: 12px; color: #666;">${done}/${total} milestones (${progress}%)</span>
          </td>
        </tr>
      `;
    }
    
    html += '</table>';
    
    if (include_details) {
      for (const c of companies) {
        html += `
          <div style="margin-bottom: 30px; padding: 20px; background: #f8f9fa; border-radius: 8px;">
            <h3 style="color: #1a365d; margin-top: 0;">${c.name}</h3>
            <p style="color: #666; font-size: 14px;">${c.description || ''}</p>
        `;
        
        const sortedMilestones = (c.milestones || [])
          .filter(m => !m.title.startsWith('[FUTURE]'))
          .sort((a, b) => a.order_index - b.order_index);
        
        if (sortedMilestones.length > 0) {
          html += '<p style="margin-bottom: 5px;"><strong>Milestones:</strong></p><ul style="margin-top: 5px;">';
          for (const m of sortedMilestones) {
            const icon = m.status === 'done' ? '✓' : '○';
            const style = m.status === 'done' ? 'color: #28a745;' : 'color: #666;';
            html += `<li style="${style}">${icon} ${m.title}</li>`;
          }
          html += '</ul>';
        }
        
        const needed = (c.requirements || []).filter(r => r.status === 'needed');
        if (needed.length > 0) {
          html += '<p style="margin-bottom: 5px;"><strong>Still Need:</strong></p><ul style="margin-top: 5px;">';
          for (const r of needed) {
            html += `<li style="color: #856404;">${r.item}</li>`;
          }
          html += '</ul>';
        }
        
        html += '</div>';
      }
    }
    
    html += `
        <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
        <p style="color: #888; font-size: 12px;">
          Sent from AI-in-a-Box Project Tracker
        </p>
      </div>
    `;
    
    const emailSubject = subject || `AI-in-a-Box Portfolio Update — ${date}`;
    
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to,
      subject: emailSubject,
      html
    });
    
    await supabase.from('activity').insert({
      company_id: null,
      type: 'email',
      content: `Sent portfolio update to ${to}`
    });
    
    return { success: true, message: `Portfolio update sent to ${to}` };
  },

  // ============ DEV TASKS HANDLERS ============
  async list_dev_tasks({ status, assigned_to, priority }) {
    let query = supabase
      .from('dev_tasks')
      .select('*, companies(name, slug)')
      .order('priority')
      .order('due_date');
    
    if (status) query = query.eq('status', status);
    if (assigned_to) query = query.eq('assigned_to', assigned_to);
    if (priority) query = query.eq('priority', priority);
    
    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  async add_dev_task({ title, description, assigned_to, priority, steps, due_date }) {
    const { data, error } = await supabase
      .from('dev_tasks')
      .insert({
        title,
        description,
        assigned_to,
        priority: priority || 'medium',
        steps: steps || [],
        due_date
      })
      .select()
      .single();
    if (error) throw error;
    return { success: true, task: data };
  },

  async update_dev_task({ task_id, status, assigned_to, priority }) {
    const updates = { updated_at: new Date().toISOString() };
    if (status) {
      updates.status = status;
      if (status === 'done') updates.completed_at = new Date().toISOString();
    }
    if (assigned_to) updates.assigned_to = assigned_to;
    if (priority) updates.priority = priority;
    
    const { data, error } = await supabase
      .from('dev_tasks')
      .update(updates)
      .eq('id', task_id)
      .select()
      .single();
    if (error) throw error;
    return { success: true, task: data };
  },

  async delete_dev_task({ task_id }) {
    const { error } = await supabase
      .from('dev_tasks')
      .delete()
      .eq('id', task_id);
    if (error) throw error;
    return { success: true, deleted: task_id };
  },

  // ============ DOCUMENT STORAGE HANDLERS ============
  async upload_document({ slug, filename, content_base64, content_type, category, description }) {
    let company_id = null;
    if (slug !== 'platform' && slug !== 'dev') {
      const { data: company } = await supabase
        .from('companies')
        .select('id')
        .eq('slug', slug)
        .single();
      if (!company) throw new Error(`Company not found: ${slug}`);
      company_id = company.id;
    }

    const buffer = Buffer.from(content_base64, 'base64');
    const bucket_path = `${slug}/${filename}`;
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('documents')
      .upload(bucket_path, buffer, {
        contentType: content_type,
        upsert: true
      });
    
    if (uploadError) throw uploadError;
    
    const { data: urlData } = supabase.storage
      .from('documents')
      .getPublicUrl(bucket_path);
    
    const ext = filename.split('.').pop().toLowerCase();
    
    const { data: doc, error: dbError } = await supabase
      .from('documents')
      .insert({
        company_id,
        name: filename,
        type: category || 'general',
        url: urlData.publicUrl,
        file_url: urlData.publicUrl,
        bucket_path,
        file_type: ext,
        category: category || 'general',
        notes: description
      })
      .select()
      .single();
    
    if (dbError) throw dbError;
    
    return { 
      success: true, 
      document: doc,
      url: urlData.publicUrl
    };
  },

  async get_document_content({ document_id }) {
    const { data: doc, error } = await supabase
      .from('documents')
      .select('*, companies(name, slug)')
      .eq('id', document_id)
      .single();
    
    if (error) throw error;
    if (!doc) throw new Error('Document not found');
    
    const textFormats = ['md', 'txt', 'json', 'csv', 'html', 'xml', 'js', 'ts', 'py', 'sql'];
    const ext = doc.file_type?.toLowerCase();
    
    if (!textFormats.includes(ext)) {
      return {
        document: doc,
        content: null,
        message: `Cannot read content of .${ext} files directly. Use the URL to view: ${doc.file_url}`
      };
    }
    
    try {
      const response = await fetch(doc.file_url);
      if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`);
      let content = await response.text();
      
      const truncated = content.length > 50000;
      if (truncated) {
        content = content.substring(0, 50000) + '\n\n... [truncated]';
      }
      
      return {
        document: doc,
        content,
        truncated
      };
    } catch (fetchError) {
      return {
        document: doc,
        content: null,
        error: fetchError.message
      };
    }
  },

  async list_all_documents({ slug, category }) {
    let query = supabase
      .from('documents')
      .select('*, companies(name, slug)')
      .order('created_at', { ascending: false });
    
    if (slug) {
      if (slug === 'platform' || slug === 'dev') {
        query = query.is('company_id', null);
      } else {
        const { data: company } = await supabase
          .from('companies')
          .select('id')
          .eq('slug', slug)
          .single();
        if (company) {
          query = query.eq('company_id', company.id);
        }
      }
    }
    
    if (category) {
      query = query.eq('category', category);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    
    return data;
  },

  async delete_document({ document_id }) {
    const { data: doc } = await supabase
      .from('documents')
      .select('bucket_path')
      .eq('id', document_id)
      .single();
    
    if (doc?.bucket_path) {
      await supabase.storage
        .from('documents')
        .remove([doc.bucket_path]);
    }
    
    const { error } = await supabase
      .from('documents')
      .delete()
      .eq('id', document_id);
    
    if (error) throw error;
    
    return { success: true, deleted: document_id };
  },

  // ============ DEPLOYMENT HANDLERS ============
  async list_deployments({ status }) {
    let query = supabase
      .from('deployments')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (status) {
      query = query.eq('status', status);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  async get_deployment({ slug, deployment_id }) {
    let query = supabase.from('deployments').select('*');
    
    if (deployment_id) {
      query = query.eq('id', deployment_id);
    } else if (slug) {
      query = query.eq('slug', slug);
    } else {
      throw new Error('Must provide slug or deployment_id');
    }
    
    const { data: deployment, error } = await query.single();
    if (error) throw error;
    if (!deployment) throw new Error('Deployment not found');
    
    const { data: components, error: compError } = await supabase
      .from('deployment_components')
      .select('*')
      .eq('deployment_id', deployment.id);
    
    if (compError) throw compError;
    
    const result = { ...deployment };
    
    for (const comp of components || []) {
      result[comp.component_type] = {
        status: comp.status,
        url: comp.url,
        last_checked: comp.last_checked,
        error_message: comp.error_message,
        ...comp.config
      };
    }
    
    return result;
  },

  async add_deployment({ name, description, github_url, frontend_url, mcp_server_url, database_type, database_provider }) {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    
    const { data: existing } = await supabase
      .from('deployments')
      .select('id')
      .eq('slug', slug)
      .single();
    
    if (existing) {
      throw new Error(`Deployment with slug "${slug}" already exists`);
    }
    
    const { data: deployment, error } = await supabase
      .from('deployments')
      .insert({
        name,
        slug,
        description,
        status: 'active'
      })
      .select()
      .single();
    
    if (error) throw error;
    
    const components = [
      {
        deployment_id: deployment.id,
        component_type: 'github',
        status: github_url ? 'unknown' : 'not_configured',
        url: github_url,
        config: github_url ? { repo_url: github_url, branch: 'main' } : {}
      },
      {
        deployment_id: deployment.id,
        component_type: 'frontend',
        status: frontend_url ? 'unknown' : 'not_configured',
        url: frontend_url,
        config: {}
      },
      {
        deployment_id: deployment.id,
        component_type: 'mcp_server',
        status: mcp_server_url ? 'unknown' : 'not_configured',
        url: mcp_server_url,
        config: {}
      },
      {
        deployment_id: deployment.id,
        component_type: 'database',
        status: database_type ? 'unknown' : 'not_configured',
        url: null,
        config: {
          type: database_type || null,
          provider: database_provider || null
        }
      }
    ];
    
    const { error: compError } = await supabase
      .from('deployment_components')
      .insert(components);
    
    if (compError) throw compError;
    
    return await handlers.get_deployment({ deployment_id: deployment.id });
  },

  async update_deployment({ deployment_id, name, description, status }) {
    const updates = { updated_at: new Date().toISOString() };
    if (name) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (status) updates.status = status;
    
    const { data, error } = await supabase
      .from('deployments')
      .update(updates)
      .eq('id', deployment_id)
      .select()
      .single();
    
    if (error) throw error;
    return { success: true, deployment: data };
  },

  async update_deployment_component({ deployment_id, component, status, url, config }) {
    const updates = { updated_at: new Date().toISOString() };
    if (status) updates.status = status;
    if (url !== undefined) updates.url = url;
    if (config) {
      const { data: existing } = await supabase
        .from('deployment_components')
        .select('config')
        .eq('deployment_id', deployment_id)
        .eq('component_type', component)
        .single();
      
      updates.config = { ...(existing?.config || {}), ...config };
    }
    
    const { data, error } = await supabase
      .from('deployment_components')
      .update(updates)
      .eq('deployment_id', deployment_id)
      .eq('component_type', component)
      .select()
      .single();
    
    if (error) throw error;
    return { success: true, component: data };
  },

  async delete_deployment({ deployment_id }) {
    const { error } = await supabase
      .from('deployments')
      .delete()
      .eq('id', deployment_id);
    
    if (error) throw error;
    return { success: true, deleted: deployment_id };
  },

  async check_deployment_health({ deployment_id }) {
    const { data: components, error } = await supabase
      .from('deployment_components')
      .select('*')
      .eq('deployment_id', deployment_id);
    
    if (error) throw error;
    
    const results = {};
    
    for (const comp of components || []) {
      if (!comp.url) {
        results[comp.component_type] = { status: 'not_configured', checked: false };
        continue;
      }
      
      try {
        const startTime = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        
        let checkUrl = comp.url;
        if (comp.component_type === 'mcp_server') {
          checkUrl = comp.url.replace(/\/$/, '') + '/health';
        }
        
        const response = await fetch(checkUrl, { 
          method: 'GET',
          signal: controller.signal
        });
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
        
        await supabase
          .from('deployment_components')
          .update({
            status: newStatus,
            last_checked: new Date().toISOString(),
            error_message: errorMessage,
            updated_at: new Date().toISOString()
          })
          .eq('id', comp.id);
        
        results[comp.component_type] = {
          status: newStatus,
          latency,
          checked: true
        };
        
      } catch (err) {
        await supabase
          .from('deployment_components')
          .update({
            status: 'down',
            last_checked: new Date().toISOString(),
            error_message: err.message,
            updated_at: new Date().toISOString()
          })
          .eq('id', comp.id);
        
        results[comp.component_type] = {
          status: 'down',
          error: err.message,
          checked: true
        };
      }
    }
    
    return { deployment_id, health_check: results };
  },

  // ============ GMAIL HANDLERS ============
  async list_emails({ folder = 'inbox', company_slug, query, max_results = 50 }) {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_REFRESH_TOKEN) {
      throw new Error('Google API not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN.');
    }
    
    const auth = getGoogleAuth();
    const gmail = google.gmail({ version: 'v1', auth });
    
    // Get company contact emails if filtering by company
    let contactEmails = [];
    if (company_slug) {
      const { data: company } = await supabase
        .from('companies')
        .select('id')
        .eq('slug', company_slug)
        .single();
      
      if (company) {
        const { data: contacts } = await supabase
          .from('contacts')
          .select('email')
          .eq('company_id', company.id);
        
        contactEmails = contacts?.map(c => c.email).filter(Boolean) || [];
      }
    }

    // Build Gmail query
    let q = query || '';
    if (folder === 'inbox') q = `in:inbox ${q}`.trim();
    else if (folder === 'sent') q = `in:sent ${q}`.trim();
    else if (folder === 'drafts') q = `in:drafts ${q}`.trim();

    const listResponse = await gmail.users.messages.list({
      userId: 'me',
      maxResults: max_results,
      q: q || undefined,
    });

    const messages = listResponse.data.messages || [];
    
    // Fetch message details
    const emails = await Promise.all(
      messages.slice(0, 20).map(async (msg) => { // Limit to 20 for speed
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'metadata',
          metadataHeaders: ['From', 'To', 'Subject', 'Date'],
        });

        const headers = detail.data.payload.headers;
        const getHeader = (name) => headers.find(h => h.name === name)?.value || '';

        return {
          id: msg.id,
          threadId: msg.threadId,
          from: getHeader('From'),
          to: getHeader('To'),
          subject: getHeader('Subject'),
          preview: detail.data.snippet || '',
          date: getHeader('Date'),
          read: !detail.data.labelIds?.includes('UNREAD'),
          starred: detail.data.labelIds?.includes('STARRED') || false,
        };
      })
    );

    // Filter by company contacts if specified
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
    
    const detail = await gmail.users.messages.get({
      userId: 'me',
      id: email_id,
      format: 'full',
    });

    const headers = detail.data.payload.headers;
    const getHeader = (name) => headers.find(h => h.name === name)?.value || '';

    // Extract body (handles multipart)
    const getBody = (payload) => {
      if (payload.body?.data) {
        return Buffer.from(payload.body.data, 'base64').toString('utf-8');
      }
      if (payload.parts) {
        // Prefer text/plain
        for (const part of payload.parts) {
          if (part.mimeType === 'text/plain' && part.body?.data) {
            return Buffer.from(part.body.data, 'base64').toString('utf-8');
          }
        }
        // Fallback to text/html
        for (const part of payload.parts) {
          if (part.mimeType === 'text/html' && part.body?.data) {
            return Buffer.from(part.body.data, 'base64').toString('utf-8');
          }
          if (part.parts) {
            const nested = getBody(part);
            if (nested) return nested;
          }
        }
      }
      return '';
    };

    return {
      id: email_id,
      threadId: detail.data.threadId,
      from: getHeader('From'),
      to: getHeader('To'),
      subject: getHeader('Subject'),
      body: getBody(detail.data.payload),
      preview: detail.data.snippet || '',
      date: getHeader('Date'),
      read: !detail.data.labelIds?.includes('UNREAD'),
      starred: detail.data.labelIds?.includes('STARRED') || false,
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

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      maxResults: max_results,
      singleEvents: true,
      orderBy: 'startTime',
    });

    let events = response.data.items.map(event => {
      // Extract company from [slug] prefix
      const titleMatch = event.summary?.match(/^\[([a-z0-9-]+)\]\s*/i);
      const companySlug = titleMatch ? titleMatch[1].toLowerCase() : null;
      const cleanTitle = titleMatch ? event.summary.replace(titleMatch[0], '') : event.summary;
      
      return {
        id: event.id,
        title: event.summary || 'Untitled',
        cleanTitle,
        description: event.description,
        start: event.start.dateTime || event.start.date,
        end: event.end.dateTime || event.end.date,
        location: event.location,
        meetLink: event.hangoutLink || event.conferenceData?.entryPoints?.[0]?.uri,
        attendees: event.attendees?.map(a => a.email) || [],
        companySlug
      };
    });

    // Filter by company if specified
    if (company_slug) {
      events = events.filter(e => e.companySlug === company_slug.toLowerCase());
    }

    return events;
  },

  async create_calendar_event({ title, start_time, end_time, description, location, attendees }) {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_REFRESH_TOKEN) {
      throw new Error('Google API not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN.');
    }
    
    const auth = getGoogleAuth();
    const calendar = google.calendar({ version: 'v3', auth });
    
    const event = {
      summary: title,
      description: description,
      location: location,
      start: {
        dateTime: new Date(start_time).toISOString(),
        timeZone: 'America/New_York'
      },
      end: {
        dateTime: new Date(end_time).toISOString(),
        timeZone: 'America/New_York'
      }
    };
    
    if (attendees && attendees.length > 0) {
      event.attendees = attendees.map(email => ({ email }));
    }
    
    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
      sendUpdates: attendees ? 'all' : 'none'
    });
    
    return {
      success: true,
      event: {
        id: response.data.id,
        title: response.data.summary,
        start: response.data.start.dateTime,
        end: response.data.end.dateTime,
        link: response.data.htmlLink
      }
    };
  }
};

// ============ CHAT ENDPOINT - THE BRAIN ============
app.post('/chat', async (req, res) => {
  try {
    const { message, conversation_history = [] } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message required' });
    }

    const messages = [
      ...conversation_history,
      { role: 'user', content: message }
    ];

    const claudeTools = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema
    }));

    let response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: claudeTools,
      messages
    });

    while (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });

      const toolResults = [];
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          console.log(`Tool: ${block.name}`, block.input);
          
          try {
            const result = await handlers[block.name](block.input);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result)
            });
          } catch (err) {
            console.error(`Tool error (${block.name}):`, err);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify({ error: err.message }),
              is_error: true
            });
          }
        }
      }

      messages.push({ role: 'user', content: toolResults });

      response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: claudeTools,
        messages
      });
    }

    const textContent = response.content.find(b => b.type === 'text');
    const finalResponse = textContent?.text || 'No response';

    res.json({
      response: finalResponse,
      conversation_history: messages.concat([{ role: 'assistant', content: response.content }])
    });

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
  
  const keepAlive = setInterval(() => {
    res.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`);
  }, 30000);
  
  req.on('close', () => {
    clearInterval(keepAlive);
  });
});

app.get('/tools', (req, res) => {
  res.json({ tools });
});

app.post('/tools/:name', async (req, res) => {
  const { name } = req.params;
  const params = req.body;
  
  if (!handlers[name]) {
    return res.status(404).json({ error: `Tool not found: ${name}` });
  }
  
  try {
    const result = await handlers[name](params);
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
        res.json({
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'project-tracker', version: '1.0.0' },
          capabilities: { tools: {} }
        });
        break;
        
      case 'tools/list':
        res.json({ tools });
        break;
        
      case 'tools/call':
        const { name, arguments: args } = params;
        if (!handlers[name]) {
          res.status(404).json({ error: `Tool not found: ${name}` });
          return;
        }
        const result = await handlers[name](args || {});
        res.json({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
        break;
        
      default:
        res.status(400).json({ error: `Unknown method: ${method}` });
    }
  } catch (error) {
    console.error('MCP error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
      '/upload': 'File upload endpoint (POST)'
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`MCP Project Tracker running on port ${PORT}`);
});
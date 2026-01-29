import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import Anthropic from '@anthropic-ai/sdk';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Email transporter (Gmail)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

// ============ SYSTEM PROMPT FOR CHAT ============
const SYSTEM_PROMPT = `You are the AI-in-a-Box Dev Dashboard assistant. You help the Digital Alpha team manage AI implementations across their portfolio companies.

You have access to tools that let you:
- View and update company status, milestones, and requirements
- Track dev tasks and assignments  
- Manage documents and files
- Send emails and project updates
- View activity logs

Current portfolio companies:
- DTIQ (video surveillance, loss prevention) - Zendesk, Salesforce, ChurnZero
- Element 8 / ATLINK (ISP, wireless broadband) - Powercode, PowerNOC, WISDM, etc
- QWILT (CDN, edge computing) - Slack-based support
- PacketFabric (network connectivity) - ServiceNow
- Welink (ISP, similar to Element 8) - Discovery phase

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
    description: "Register a document for a company",
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
    
    // Sort milestones and activity
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
    
    // Get max order_index
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
      .order('uploaded_at', { ascending: false });
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
    
    // Get all company data
    const { data: companies, error } = await supabase
      .from('companies')
      .select(`
        slug, name, status, description,
        milestones(title, status, order_index),
        requirements(item, status)
      `);
    if (error) throw error;
    
    // Build email HTML
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
    
    // Add details if requested
    if (include_details) {
      for (const c of companies) {
        html += `
          <div style="margin-bottom: 30px; padding: 20px; background: #f8f9fa; border-radius: 8px;">
            <h3 style="color: #1a365d; margin-top: 0;">${c.name}</h3>
            <p style="color: #666; font-size: 14px;">${c.description || ''}</p>
        `;
        
        // Milestones
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
        
        // Requirements
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
    
    // Send email
    const emailSubject = subject || `AI-in-a-Box Portfolio Update — ${date}`;
    
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to,
      subject: emailSubject,
      html
    });
    
    // Log activity
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
  }
};

// ============ CHAT ENDPOINT - THE BRAIN ============
app.post('/chat', async (req, res) => {
  try {
    const { message, conversation_history = [] } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message required' });
    }

    // Build messages
    const messages = [
      ...conversation_history,
      { role: 'user', content: message }
    ];

    // Convert tools to Claude format
    const claudeTools = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema
    }));

    // Call Claude
    let response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: claudeTools,
      messages
    });

    // Tool use loop
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

    // Extract text response
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

// ============ MCP ENDPOINTS ============

// SSE endpoint for MCP
app.get('/mcp', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
  
  // Keep connection alive
  const keepAlive = setInterval(() => {
    res.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`);
  }, 30000);
  
  req.on('close', () => {
    clearInterval(keepAlive);
  });
});

// List available tools
app.get('/tools', (req, res) => {
  res.json({ tools });
});

// Execute a tool
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

// MCP protocol endpoint (for Claude.ai)
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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root
app.get('/', (req, res) => {
  res.json({
    name: 'MCP Project Tracker',
    description: 'Digital Alpha AI-in-a-Box Portfolio Tracker',
    endpoints: {
      '/health': 'Health check',
      '/tools': 'List available tools',
      '/tools/:name': 'Execute a tool (POST)',
      '/mcp': 'MCP protocol endpoint',
      '/chat': 'Natural language chat endpoint (POST)'
    }
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`MCP Project Tracker running on port ${PORT}`);
});
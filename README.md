# MCP Project Tracker

MCP Server for tracking Digital Alpha AI-in-a-Box portfolio projects.

## Quick Start

### 1. Set up Supabase (5 min)

1. Go to [supabase.com](https://supabase.com) → New Project
2. Name it `project-tracker`, set a password, choose region
3. Once created, go to **SQL Editor**
4. Paste contents of `schema.sql` and run
5. Go to **Settings → API** and copy:
   - Project URL → `SUPABASE_URL`
   - `anon` public key → `SUPABASE_KEY`

### 2. Seed Initial Data (2 min)

```bash
# Set env vars
export SUPABASE_URL="https://xxx.supabase.co"
export SUPABASE_KEY="eyJ..."

# Install and seed
npm install
npm run seed
```

### 3. Set Up Gmail (2 min)

1. Go to [myaccount.google.com](https://myaccount.google.com)
2. Security → 2-Step Verification (must be enabled)
3. App passwords → Create new → Name it "MCP Server"
4. Copy the 16-character password

You'll add these as environment variables:
- `GMAIL_USER` = your email
- `GMAIL_APP_PASSWORD` = the 16-char password

### 3. Deploy to Render (5 min)

**Option A: Via Dashboard**
1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your repo
4. Settings:
   - Build Command: `npm install`
   - Start Command: `node server.js`
5. Add environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_KEY`
6. Deploy

**Option B: Via CLI**
```bash
render deploy
```

### 4. Connect to Claude

Once deployed, you'll get a URL like `https://mcp-project-tracker.onrender.com`

Add to Claude.ai as an MCP server:
- URL: `https://mcp-project-tracker.onrender.com/mcp`

---

## Available Tools

| Tool | Description |
|------|-------------|
| `list_companies` | List all portfolio companies |
| `get_company` | Get full details for a company |
| `update_company_status` | Update company status (discovery/active/pilot/deployed) |
| `list_milestones` | List milestones for a company |
| `update_milestone` | Mark milestone as done/in_progress/blocked |
| `add_milestone` | Add new milestone |
| `add_note` | Add activity note for a company |
| `get_recent_activity` | Get recent activity across portfolio |
| `update_requirement` | Update requirement status (needed/requested/received) |
| `add_requirement` | Add new requirement |
| `list_documents` | List documents for a company |
| `add_document` | Register a document |
| `add_contact` | Add contact person |
| `list_contacts` | List contacts for a company |
| `get_portfolio_summary` | High-level progress summary |
| `send_email` | Send a custom email |
| `send_project_update` | Generate and send formatted portfolio update email |

---

## Example Usage with Claude

```
You: "What's the status across all companies?"
Claude: [calls get_portfolio_summary]

You: "Mark DTIQ's agent handbook milestone as done - Sarah sent it today"
Claude: [calls update_milestone + add_note]

You: "Add Jake Miller as a contact for Element 8 - he's the NOC Manager"
Claude: [calls add_contact]

You: "QWILT sent their runbooks, update that"
Claude: [calls update_requirement]

You: "Show me recent activity"
Claude: [calls get_recent_activity]

You: "Send Rick a portfolio update"
Claude: [calls send_project_update with Rick's email]

You: "Email the team that we got DTIQ's call files"
Claude: [calls send_email with custom message]
```

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Server info |
| `/health` | GET | Health check |
| `/tools` | GET | List available tools |
| `/tools/:name` | POST | Execute a tool |
| `/mcp` | POST | MCP protocol endpoint |

### Direct API Usage

```bash
# List companies
curl https://your-server.onrender.com/tools/list_companies -X POST

# Get company details
curl https://your-server.onrender.com/tools/get_company \
  -X POST -H "Content-Type: application/json" \
  -d '{"slug": "dtiq"}'

# Add a note
curl https://your-server.onrender.com/tools/add_note \
  -X POST -H "Content-Type: application/json" \
  -d '{"slug": "dtiq", "content": "Met with Sarah about handbook"}'
```

---

## Local Development

```bash
# Install
npm install

# Set env vars
export SUPABASE_URL="https://xxx.supabase.co"
export SUPABASE_KEY="eyJ..."

# Run with watch mode
npm run dev

# Server runs at http://localhost:3000
```

---

## Project Structure

```
mcp-project-tracker/
├── server.js       # Main MCP server
├── schema.sql      # Database schema
├── seed.js         # Initial data seeder
├── package.json
├── render.yaml     # Render deployment config
└── README.md
```

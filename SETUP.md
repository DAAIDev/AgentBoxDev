# AgentBox MCP Server

Express.js MCP server for managing Digital Alpha portfolio companies, deployments, dev tasks, communication, and GCP monitoring.

**Production:** `https://mcp-server-aj37mp5t6a-uc.a.run.app`
**GCP Project:** `agentbox-485618` | **Region:** `us-central1`

---

## Local Development

### Prerequisites

- Node.js 18+
- Access to GCP project `agentbox-485618`
- [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/connect-auth-proxy) (for database access)
- `gcloud` CLI (authenticated with a GCP account that has Cloud SQL Client role)

### 1. Install dependencies

```bash
npm install
```

### 2. Set up environment variables

Create a `.env` file in the project root:

```env
# === REQUIRED ===

# Database (Cloud SQL via Auth Proxy)
DATABASE_URL=postgresql://<user>:<password>@localhost:5433/mcp

# GCP Service Account (base64-encoded JSON key)
# Required for: Cloud Monitoring, Cloud Logging, Cloud Run Admin APIs
GCP_SERVICE_ACCOUNT_JSON=<base64-encoded-json>

# Server port
PORT=3002

# === OPTIONAL (can be set up later) ===

# Google OAuth — needed for Gmail/Calendar tools only
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=
# GOOGLE_REFRESH_TOKEN=

# Anthropic — needed for /chat endpoint only
# ANTHROPIC_API_KEY=
```

**How to get the required variables:**

| Variable | How to obtain |
|----------|--------------|
| `DATABASE_URL` | Ask the team lead. Format: `postgresql://user:pass@localhost:5433/mcp`. Port 5433 is the Cloud SQL Auth Proxy. |
| `GCP_SERVICE_ACCOUNT_JSON` | Download JSON key from GCP Console (IAM > Service Accounts), then base64 encode: `base64 -w 0 key.json` (Linux/Mac) or `certutil -encode key.json encoded.txt` (Windows). Required roles: `monitoring.viewer`, `logging.viewer`, `run.viewer`. |

### 3. Start Cloud SQL Auth Proxy

In a separate terminal:

```bash
# Authenticate first (one-time)
gcloud auth application-default login

# Start the proxy (tunnels localhost:5433 to Cloud SQL)
cloud-sql-proxy agentbox-485618:us-central1:agentbox-db-mcp --port=5433
```

Your GCP account needs the **Cloud SQL Client** role. Ask the team lead to grant it if you get a 403 error.

### 4. Start the server

```bash
npm run dev
# Server runs at http://localhost:3002
```

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/tools` | GET | List all available tools |
| `/tools/:name` | POST | Execute a tool by name |
| `/chat` | POST | AI chat endpoint (requires Anthropic key) |
| `/upload` | POST | File upload |
| `/mcp` | POST | MCP protocol endpoint |

---

## Tools Overview

The server exposes ~50 tools organized by feature:

### Portfolio & Companies
`list_companies`, `get_company`, `update_company_status`, `get_portfolio_summary`, `get_recent_activity`

### Milestones & Requirements
`list_milestones`, `add_milestone`, `update_milestone`, `add_requirement`, `update_requirement`

### Contacts & Documents
`list_contacts`, `add_contact`, `list_documents`, `add_document`

### Dev Tasks
`list_dev_tasks`, `add_dev_task`, `update_dev_task`, `delete_dev_task`

### Deployments (CRUD)
`list_deployments`, `get_deployment`, `add_deployment`, `update_deployment`, `update_deployment_component`, `delete_deployment`, `check_deployment_health`

### GCP Monitoring (requires `GCP_SERVICE_ACCOUNT_JSON`)
`get_cloudrun_service_info`, `get_cloudrun_metrics`, `get_cloudrun_metrics_timeseries`, `get_all_deployments_metrics`, `get_cloudrun_revisions`, `get_deployment_logs`, `get_deployment_log_summary`, `get_firebase_users`

### Communication (requires Google OAuth — optional)
`send_email`, `send_project_update`, `list_emails`, `get_email`, `list_calendar_events`, `create_calendar_event`

### Admin & Feedback
`submit_admin_request`, `list_feedback`, `update_feedback`, `submit_feedback`

---

## Database

**Cloud SQL PostgreSQL 15** — instance: `agentbox-db-mcp`

Schema is in `schema.sql`. Key tables: `companies`, `milestones`, `requirements`, `contacts`, `documents`, `activity`, `dev_tasks`, `deployments`, `deployment_components`, `notes`, `admin_requests`, `feedback`.

---

## Project Structure

```
AgentBoxDev/
├── server.js          # Main server (all tools, routes, handlers)
├── schema.sql         # Database schema
├── seed.js            # Initial data seeder
├── package.json
├── .env               # Local env vars (not committed)
└── README.md
```

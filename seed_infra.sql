-- ============================================
-- Infrastructure Registry Seed Data
-- Based on actual deploy workflows as of Mar 2026
-- ============================================

DELETE FROM tenant_configs;

-- ============================================
-- CRM Backend (NestJS) — 6 instances
-- Repo: DAAITeam/CRMBackend
-- Deploy: GitHub Actions on push to main (all) or dev branch (dev only)
-- Cloud Run config: Memory 512Mi, CPU 1, min 0, max 10, port 8080
-- Cloud SQL pattern: agentbox-db-{company}
-- ============================================

INSERT INTO tenant_configs (tenant, service_type, cloud_run_service, github_repo, git_branch, env_vars_required, secrets, deploy_command, feature_flags, notes) VALUES
('packetfabric', 'backend', 'crm-backend-packetfabric', 'DAAITeam/CRMBackend', 'main',
  '[
    {"name": "TENANT_ID", "desc": "Company slug", "secret": false, "value": "packetfabric"},
    {"name": "NODE_ENV", "desc": "Environment", "secret": false, "value": "production"},
    {"name": "RAG_SERVICE_URL", "desc": "RAG service URL — auto-resolved at deploy time from Cloud Run", "secret": false},
    {"name": "PHONE_AI_URL", "desc": "Phone Agent URL — auto-resolved at deploy from Cloud Run", "secret": false},
    {"name": "GCS_BUCKET_NAME", "desc": "GCS bucket for attachments", "secret": false, "value": "agentbox-attachments-packetfabric"},
    {"name": "ALLOWED_ORIGINS", "desc": "CORS origins — auto-resolved from frontend Cloud Run URL", "secret": false}
  ]'::jsonb,
  '[
    {"name": "DATABASE_URL", "gcp_secret": "packetfabric-database-url"},
    {"name": "FIREBASE_PROJECT_ID", "gcp_secret": "packetfabric-firebase-project-id", "env_prefix": "PACKETFABRIC_"},
    {"name": "FIREBASE_CLIENT_EMAIL", "gcp_secret": "packetfabric-firebase-client-email", "env_prefix": "PACKETFABRIC_"},
    {"name": "FIREBASE_PRIVATE_KEY", "gcp_secret": "packetfabric-firebase-private-key", "env_prefix": "PACKETFABRIC_"},
    {"name": "API_KEY", "gcp_secret": "packetfabric-api-key", "env_prefix": "PACKETFABRIC_"},
    {"name": "ANTHROPIC_API_KEY", "gcp_secret": "packetfabric-anthropic-api-key"},
    {"name": "RAG_API_KEY", "gcp_secret": "packetfabric-rag-api-key"},
    {"name": "PHONE_AI_API_KEY", "gcp_secret": "packetfabric-phone-ai-api-key"},
    {"name": "MONITORING_WEBHOOK_SECRET", "gcp_secret": "packetfabric-monitoring-webhook-secret"}
  ]'::jsonb,
  'Deploys via GitHub Actions. Push to main triggers deploy to all 6 instances. Manual dispatch available with target selector.',
  '{"ENABLE_NOC_DASHBOARD": true, "ENABLE_CIRCUITS": true, "ENABLE_PHONE_AGENT": true, "ENABLE_AI_TOOLBOX": true, "ENABLE_CHANGE_MGMT": true, "ENABLE_SERVICE_DELIVERY": true, "ENABLE_TESTER_FEEDBACK": true}'::jsonb,
  'PacketFabric gets ALL features enabled. Has MONITORING_WEBHOOK_SECRET (unique to PF + dev). Cloud SQL: agentbox-db-packetfabric.'
),

('dtiq', 'backend', 'crm-backend-dtiq', 'DAAITeam/CRMBackend', 'main',
  '[
    {"name": "TENANT_ID", "desc": "Company slug", "secret": false, "value": "dtiq"},
    {"name": "NODE_ENV", "desc": "Environment", "secret": false, "value": "production"},
    {"name": "RAG_SERVICE_URL", "desc": "Auto-resolved at deploy time", "secret": false},
    {"name": "PHONE_AI_URL", "desc": "Auto-resolved at deploy time", "secret": false},
    {"name": "GCS_BUCKET_NAME", "desc": "GCS bucket", "secret": false, "value": "agentbox-attachments-dtiq"},
    {"name": "ALLOWED_ORIGINS", "desc": "Auto-resolved from frontend URL", "secret": false}
  ]'::jsonb,
  '[
    {"name": "DATABASE_URL", "gcp_secret": "dtiq-database-url"},
    {"name": "FIREBASE_PROJECT_ID", "gcp_secret": "dtiq-firebase-project-id", "env_prefix": "DTIQ_"},
    {"name": "FIREBASE_CLIENT_EMAIL", "gcp_secret": "dtiq-firebase-client-email", "env_prefix": "DTIQ_"},
    {"name": "FIREBASE_PRIVATE_KEY", "gcp_secret": "dtiq-firebase-private-key", "env_prefix": "DTIQ_"},
    {"name": "API_KEY", "gcp_secret": "dtiq-api-key", "env_prefix": "DTIQ_"},
    {"name": "ANTHROPIC_API_KEY", "gcp_secret": "dtiq-anthropic-api-key"},
    {"name": "RAG_API_KEY", "gcp_secret": "dtiq-rag-api-key"},
    {"name": "PHONE_AI_API_KEY", "gcp_secret": "dtiq-phone-ai-api-key"}
  ]'::jsonb,
  'Deploys via GitHub Actions. Push to main triggers deploy to all 6 instances.',
  '{"ENABLE_NOC_DASHBOARD": false, "ENABLE_CIRCUITS": false, "ENABLE_PHONE_AGENT": true, "ENABLE_AI_TOOLBOX": true, "ENABLE_CHANGE_MGMT": false, "ENABLE_SERVICE_DELIVERY": false, "ENABLE_TESTER_FEEDBACK": true}'::jsonb,
  'Cloud SQL: agentbox-db-dtiq.'
),

('element8', 'backend', 'crm-backend-element8', 'DAAITeam/CRMBackend', 'main',
  '[
    {"name": "TENANT_ID", "desc": "Company slug", "secret": false, "value": "element8"},
    {"name": "NODE_ENV", "desc": "Environment", "secret": false, "value": "production"},
    {"name": "RAG_SERVICE_URL", "desc": "Auto-resolved at deploy time", "secret": false},
    {"name": "PHONE_AI_URL", "desc": "Auto-resolved at deploy time", "secret": false},
    {"name": "GCS_BUCKET_NAME", "desc": "GCS bucket", "secret": false, "value": "agentbox-attachments-element8"},
    {"name": "ALLOWED_ORIGINS", "desc": "Auto-resolved from frontend URL", "secret": false}
  ]'::jsonb,
  '[
    {"name": "DATABASE_URL", "gcp_secret": "element8-database-url"},
    {"name": "FIREBASE_PROJECT_ID", "gcp_secret": "element8-firebase-project-id", "env_prefix": "ELEMENT8_"},
    {"name": "FIREBASE_CLIENT_EMAIL", "gcp_secret": "element8-firebase-client-email", "env_prefix": "ELEMENT8_"},
    {"name": "FIREBASE_PRIVATE_KEY", "gcp_secret": "element8-firebase-private-key", "env_prefix": "ELEMENT8_"},
    {"name": "API_KEY", "gcp_secret": "element8-api-key", "env_prefix": "ELEMENT8_"},
    {"name": "ANTHROPIC_API_KEY", "gcp_secret": "element8-anthropic-api-key"},
    {"name": "RAG_API_KEY", "gcp_secret": "element8-rag-api-key"},
    {"name": "PHONE_AI_API_KEY", "gcp_secret": "element8-phone-ai-api-key"}
  ]'::jsonb,
  'Deploys via GitHub Actions. Push to main triggers deploy to all 6 instances.',
  '{"ENABLE_NOC_DASHBOARD": false, "ENABLE_CIRCUITS": false, "ENABLE_PHONE_AGENT": true, "ENABLE_AI_TOOLBOX": true, "ENABLE_CHANGE_MGMT": false, "ENABLE_SERVICE_DELIVERY": false, "ENABLE_TESTER_FEEDBACK": true}'::jsonb,
  'Cloud SQL: agentbox-db-element8.'
),

('qwilt', 'backend', 'crm-backend-qwilt', 'DAAITeam/CRMBackend', 'main',
  '[
    {"name": "TENANT_ID", "desc": "Company slug", "secret": false, "value": "qwilt"},
    {"name": "NODE_ENV", "desc": "Environment", "secret": false, "value": "production"},
    {"name": "RAG_SERVICE_URL", "desc": "Auto-resolved at deploy time", "secret": false},
    {"name": "PHONE_AI_URL", "desc": "Auto-resolved at deploy time", "secret": false},
    {"name": "GCS_BUCKET_NAME", "desc": "GCS bucket", "secret": false, "value": "agentbox-attachments-qwilt"},
    {"name": "ALLOWED_ORIGINS", "desc": "Auto-resolved from frontend URL", "secret": false}
  ]'::jsonb,
  '[
    {"name": "DATABASE_URL", "gcp_secret": "qwilt-database-url"},
    {"name": "FIREBASE_PROJECT_ID", "gcp_secret": "qwilt-firebase-project-id", "env_prefix": "QWILT_"},
    {"name": "FIREBASE_CLIENT_EMAIL", "gcp_secret": "qwilt-firebase-client-email", "env_prefix": "QWILT_"},
    {"name": "FIREBASE_PRIVATE_KEY", "gcp_secret": "qwilt-firebase-private-key", "env_prefix": "QWILT_"},
    {"name": "API_KEY", "gcp_secret": "qwilt-api-key", "env_prefix": "QWILT_"},
    {"name": "ANTHROPIC_API_KEY", "gcp_secret": "qwilt-anthropic-api-key"},
    {"name": "RAG_API_KEY", "gcp_secret": "qwilt-rag-api-key"},
    {"name": "PHONE_AI_API_KEY", "gcp_secret": "qwilt-phone-ai-api-key"}
  ]'::jsonb,
  'Deploys via GitHub Actions. Push to main triggers deploy to all 6 instances.',
  '{"ENABLE_NOC_DASHBOARD": false, "ENABLE_CIRCUITS": false, "ENABLE_PHONE_AGENT": true, "ENABLE_AI_TOOLBOX": true, "ENABLE_CHANGE_MGMT": false, "ENABLE_SERVICE_DELIVERY": false, "ENABLE_TESTER_FEEDBACK": true}'::jsonb,
  'Cloud SQL: agentbox-db-qwilt.'
),

('welink', 'backend', 'crm-backend-welink', 'DAAITeam/CRMBackend', 'main',
  '[
    {"name": "TENANT_ID", "desc": "Company slug", "secret": false, "value": "welink"},
    {"name": "NODE_ENV", "desc": "Environment", "secret": false, "value": "production"},
    {"name": "RAG_SERVICE_URL", "desc": "Auto-resolved at deploy time", "secret": false},
    {"name": "PHONE_AI_URL", "desc": "Auto-resolved at deploy time", "secret": false},
    {"name": "GCS_BUCKET_NAME", "desc": "GCS bucket", "secret": false, "value": "agentbox-attachments-welink"},
    {"name": "ALLOWED_ORIGINS", "desc": "Auto-resolved from frontend URL", "secret": false}
  ]'::jsonb,
  '[
    {"name": "DATABASE_URL", "gcp_secret": "welink-database-url"},
    {"name": "FIREBASE_PROJECT_ID", "gcp_secret": "welink-firebase-project-id", "env_prefix": "WELINK_"},
    {"name": "FIREBASE_CLIENT_EMAIL", "gcp_secret": "welink-firebase-client-email", "env_prefix": "WELINK_"},
    {"name": "FIREBASE_PRIVATE_KEY", "gcp_secret": "welink-firebase-private-key", "env_prefix": "WELINK_"},
    {"name": "API_KEY", "gcp_secret": "welink-api-key", "env_prefix": "WELINK_"},
    {"name": "ANTHROPIC_API_KEY", "gcp_secret": "welink-anthropic-api-key"},
    {"name": "RAG_API_KEY", "gcp_secret": "welink-rag-api-key"},
    {"name": "PHONE_AI_API_KEY", "gcp_secret": "welink-phone-ai-api-key"}
  ]'::jsonb,
  'Deploys via GitHub Actions. Push to main triggers deploy to all 6 instances.',
  '{"ENABLE_NOC_DASHBOARD": false, "ENABLE_CIRCUITS": false, "ENABLE_PHONE_AGENT": true, "ENABLE_AI_TOOLBOX": true, "ENABLE_CHANGE_MGMT": true, "ENABLE_SERVICE_DELIVERY": true, "ENABLE_TESTER_FEEDBACK": true}'::jsonb,
  'WeLink gets change management + service delivery + scheduling. Cloud SQL: agentbox-db-welink.'
),

('dev', 'backend', 'crm-backend-dev', 'DAAITeam/CRMBackend', 'main',
  '[
    {"name": "TENANT_ID", "desc": "Company slug", "secret": false, "value": "dev"},
    {"name": "NODE_ENV", "desc": "Environment", "secret": false, "value": "production"},
    {"name": "RAG_SERVICE_URL", "desc": "Auto-resolved at deploy time", "secret": false},
    {"name": "PHONE_AI_URL", "desc": "Auto-resolved at deploy time", "secret": false},
    {"name": "GCS_BUCKET_NAME", "desc": "GCS bucket", "secret": false, "value": "agentbox-attachments-dev"},
    {"name": "ALLOWED_ORIGINS", "desc": "Auto-resolved from frontend URL", "secret": false},
    {"name": "DISABLE_SLA_CRON", "desc": "Disables SLA background jobs on dev", "secret": false, "value": "true"}
  ]'::jsonb,
  '[
    {"name": "DATABASE_URL", "gcp_secret": "dev-database-url"},
    {"name": "FIREBASE_PROJECT_ID", "gcp_secret": "dev-firebase-project-id", "env_prefix": "DEV_"},
    {"name": "FIREBASE_CLIENT_EMAIL", "gcp_secret": "dev-firebase-client-email", "env_prefix": "DEV_"},
    {"name": "FIREBASE_PRIVATE_KEY", "gcp_secret": "dev-firebase-private-key", "env_prefix": "DEV_"},
    {"name": "API_KEY", "gcp_secret": "dev-api-key", "env_prefix": "DEV_"},
    {"name": "ANTHROPIC_API_KEY", "gcp_secret": "dev-anthropic-api-key"},
    {"name": "RAG_API_KEY", "gcp_secret": "dev-rag-api-key"},
    {"name": "PHONE_AI_API_KEY", "gcp_secret": "dev-phone-ai-api-key"},
    {"name": "MONITORING_WEBHOOK_SECRET", "gcp_secret": "dev-monitoring-webhook-secret"}
  ]'::jsonb,
  'Deploys via GitHub Actions. Push to main deploys all; push to dev branch deploys dev only.',
  '{"ENABLE_NOC_DASHBOARD": true, "ENABLE_CIRCUITS": true, "ENABLE_PHONE_AGENT": true, "ENABLE_AI_TOOLBOX": true, "ENABLE_CHANGE_MGMT": true, "ENABLE_SERVICE_DELIVERY": true, "ENABLE_SCHEDULING": true, "ENABLE_TESTER_FEEDBACK": true, "DISABLE_SLA_CRON": true}'::jsonb,
  'Dev instance — all features enabled. SLA cron disabled. db-f1-micro (256MB RAM, ~25 max connections). Firebase project: agentbox-dev-support. Cloud SQL: agentbox-db-dev.'
);

-- ============================================
-- CRM Frontend (Next.js) — 6 instances
-- Repo: DAAITeam/CRMFrontEnd
-- Deploy: GitHub Actions on push to main (all) or dev branch (dev only)
-- Cloud Run config: Memory 512Mi, CPU 1, min 0, max 5, port 8080
-- CRITICAL: Firebase build args MUST be set or auth breaks
-- Image tagged per-company: crm-frontend:{sha}-{company}
-- ============================================

INSERT INTO tenant_configs (tenant, service_type, cloud_run_service, github_repo, git_branch, env_vars_required, secrets, deploy_command, feature_flags, notes) VALUES
('packetfabric', 'frontend', 'crm-frontend-packetfabric', 'DAAITeam/CRMFrontEnd', 'main',
  '[
    {"name": "NEXT_PUBLIC_COMPANY_SLUG", "desc": "Company slug (build arg)", "secret": false, "value": "packetfabric"},
    {"name": "NEXT_PUBLIC_API_URL", "desc": "Backend API URL — auto-resolved at deploy time", "secret": false},
    {"name": "NEXT_PUBLIC_FIREBASE_API_KEY", "desc": "Firebase web API key (build arg from Secret Manager)", "secret": false},
    {"name": "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", "desc": "Firebase auth domain (build arg)", "secret": false},
    {"name": "NEXT_PUBLIC_FIREBASE_PROJECT_ID", "desc": "Firebase project ID (build arg)", "secret": false},
    {"name": "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", "desc": "Firebase storage bucket (build arg)", "secret": false},
    {"name": "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", "desc": "Firebase messaging ID (build arg)", "secret": false},
    {"name": "NEXT_PUBLIC_FIREBASE_APP_ID", "desc": "Firebase app ID (build arg)", "secret": false}
  ]'::jsonb,
  '[
    {"name": "FIREBASE_API_KEY", "gcp_secret": "packetfabric-firebase-api-key", "note": "Used as build arg"},
    {"name": "FIREBASE_AUTH_DOMAIN", "gcp_secret": "packetfabric-firebase-auth-domain"},
    {"name": "FIREBASE_PROJECT_ID", "gcp_secret": "packetfabric-firebase-project-id"},
    {"name": "FIREBASE_STORAGE_BUCKET", "gcp_secret": "packetfabric-firebase-storage-bucket"},
    {"name": "FIREBASE_MESSAGING_SENDER_ID", "gcp_secret": "packetfabric-firebase-messaging-sender-id"},
    {"name": "FIREBASE_APP_ID", "gcp_secret": "packetfabric-firebase-app-id"},
    {"name": "DATABASE_URL", "gcp_secret": "packetfabric-database-url"},
    {"name": "FIREBASE_CLIENT_EMAIL", "gcp_secret": "packetfabric-firebase-client-email"},
    {"name": "FIREBASE_PRIVATE_KEY", "gcp_secret": "packetfabric-firebase-private-key"}
  ]'::jsonb,
  'Deploys via GitHub Actions. Firebase config baked into image at build time. Backend URL auto-resolved.',
  '{"ENABLE_NOC_DASHBOARD": true, "ENABLE_CIRCUITS": true, "ENABLE_PHONE_AGENT": true, "ENABLE_AI_TOOLBOX": true, "ENABLE_CHANGE_MGMT": true, "ENABLE_SERVICE_DELIVERY": true}'::jsonb,
  'CRITICAL: Firebase env vars MUST be set or auth/login breaks. Feature flags must match backend. Image tagged per-company.'
),
('dtiq', 'frontend', 'crm-frontend-dtiq', 'DAAITeam/CRMFrontEnd', 'main',
  '[{"name": "NEXT_PUBLIC_COMPANY_SLUG", "desc": "Build arg", "secret": false, "value": "dtiq"}, {"name": "NEXT_PUBLIC_API_URL", "desc": "Auto-resolved", "secret": false}, {"name": "NEXT_PUBLIC_FIREBASE_*", "desc": "6 Firebase build args from Secret Manager", "secret": false}]'::jsonb,
  '[{"name": "FIREBASE_*", "gcp_secret": "dtiq-firebase-*", "note": "6 build args + 3 runtime secrets"}, {"name": "DATABASE_URL", "gcp_secret": "dtiq-database-url"}]'::jsonb,
  'Deploys via GitHub Actions. Same pattern as PF frontend.',
  '{"ENABLE_NOC_DASHBOARD": false, "ENABLE_CIRCUITS": false, "ENABLE_PHONE_AGENT": true, "ENABLE_AI_TOOLBOX": true, "ENABLE_CHANGE_MGMT": false, "ENABLE_SERVICE_DELIVERY": false}'::jsonb,
  'Firebase env vars MUST be set or auth breaks.'
),
('element8', 'frontend', 'crm-frontend-element8', 'DAAITeam/CRMFrontEnd', 'main',
  '[{"name": "NEXT_PUBLIC_COMPANY_SLUG", "desc": "Build arg", "secret": false, "value": "element8"}, {"name": "NEXT_PUBLIC_API_URL", "desc": "Auto-resolved", "secret": false}, {"name": "NEXT_PUBLIC_FIREBASE_*", "desc": "6 Firebase build args from Secret Manager", "secret": false}]'::jsonb,
  '[{"name": "FIREBASE_*", "gcp_secret": "element8-firebase-*"}, {"name": "DATABASE_URL", "gcp_secret": "element8-database-url"}]'::jsonb,
  'Deploys via GitHub Actions.',
  '{"ENABLE_NOC_DASHBOARD": false, "ENABLE_CIRCUITS": false, "ENABLE_PHONE_AGENT": true, "ENABLE_AI_TOOLBOX": true, "ENABLE_CHANGE_MGMT": false, "ENABLE_SERVICE_DELIVERY": false}'::jsonb,
  'Firebase env vars MUST be set or auth breaks.'
),
('qwilt', 'frontend', 'crm-frontend-qwilt', 'DAAITeam/CRMFrontEnd', 'main',
  '[{"name": "NEXT_PUBLIC_COMPANY_SLUG", "desc": "Build arg", "secret": false, "value": "qwilt"}, {"name": "NEXT_PUBLIC_API_URL", "desc": "Auto-resolved", "secret": false}, {"name": "NEXT_PUBLIC_FIREBASE_*", "desc": "6 Firebase build args from Secret Manager", "secret": false}]'::jsonb,
  '[{"name": "FIREBASE_*", "gcp_secret": "qwilt-firebase-*"}, {"name": "DATABASE_URL", "gcp_secret": "qwilt-database-url"}]'::jsonb,
  'Deploys via GitHub Actions.',
  '{"ENABLE_NOC_DASHBOARD": false, "ENABLE_CIRCUITS": false, "ENABLE_PHONE_AGENT": true, "ENABLE_AI_TOOLBOX": true, "ENABLE_CHANGE_MGMT": false, "ENABLE_SERVICE_DELIVERY": false}'::jsonb,
  'Firebase env vars MUST be set or auth breaks.'
),
('welink', 'frontend', 'crm-frontend-welink', 'DAAITeam/CRMFrontEnd', 'main',
  '[{"name": "NEXT_PUBLIC_COMPANY_SLUG", "desc": "Build arg", "secret": false, "value": "welink"}, {"name": "NEXT_PUBLIC_API_URL", "desc": "Auto-resolved", "secret": false}, {"name": "NEXT_PUBLIC_FIREBASE_*", "desc": "6 Firebase build args from Secret Manager", "secret": false}]'::jsonb,
  '[{"name": "FIREBASE_*", "gcp_secret": "welink-firebase-*"}, {"name": "DATABASE_URL", "gcp_secret": "welink-database-url"}]'::jsonb,
  'Deploys via GitHub Actions.',
  '{"ENABLE_NOC_DASHBOARD": false, "ENABLE_CIRCUITS": false, "ENABLE_PHONE_AGENT": true, "ENABLE_AI_TOOLBOX": true, "ENABLE_CHANGE_MGMT": true, "ENABLE_SERVICE_DELIVERY": true}'::jsonb,
  'Firebase env vars MUST be set or auth breaks. WeLink gets change mgmt + service delivery.'
),
('dev', 'frontend', 'crm-frontend-dev', 'DAAITeam/CRMFrontEnd', 'main',
  '[{"name": "NEXT_PUBLIC_COMPANY_SLUG", "desc": "Build arg", "secret": false, "value": "dev"}, {"name": "NEXT_PUBLIC_API_URL", "desc": "Auto-resolved", "secret": false}, {"name": "NEXT_PUBLIC_FIREBASE_*", "desc": "6 Firebase build args from Secret Manager", "secret": false}]'::jsonb,
  '[{"name": "FIREBASE_*", "gcp_secret": "dev-firebase-*", "note": "Dev Firebase project: agentbox-dev-support"}, {"name": "DATABASE_URL", "gcp_secret": "dev-database-url"}]'::jsonb,
  'Deploys via GitHub Actions. Push to main deploys all; push to dev branch deploys dev only.',
  '{"ENABLE_NOC_DASHBOARD": true, "ENABLE_CIRCUITS": true, "ENABLE_PHONE_AGENT": true, "ENABLE_AI_TOOLBOX": true, "ENABLE_CHANGE_MGMT": true, "ENABLE_SERVICE_DELIVERY": true}'::jsonb,
  'Dev instance. Firebase project: agentbox-dev-support (NOT production Firebase). All features enabled.'
);

-- ============================================
-- RAG Service (Python/FastAPI) — 5 instances (NO dev)
-- Repo: DAAITeam/RAGService
-- Deploy: GitHub Actions on push to main
-- Cloud Run config: Memory 512Mi, CPU 1, min 0, max 5, port 8080
-- ============================================

INSERT INTO tenant_configs (tenant, service_type, cloud_run_service, github_repo, git_branch, env_vars_required, secrets, deploy_command, notes) VALUES
('packetfabric', 'rag', 'rag-service-packetfabric', 'DAAITeam/RAGService', 'main',
  '[]'::jsonb,
  '[{"name": "DATABASE_URL", "gcp_secret": "packetfabric-database-url"}, {"name": "OPENAI_API_KEY", "gcp_secret": "packetfabric-openai-api-key"}, {"name": "ANTHROPIC_API_KEY", "gcp_secret": "packetfabric-anthropic-api-key"}, {"name": "RAG_API_KEY", "gcp_secret": "packetfabric-rag-api-key"}]'::jsonb,
  'Deploys via GitHub Actions on push to main. Migrations run via Cloud SQL Auth Proxy before deploy.',
  'Python FastAPI + pgvector. OpenAI text-embedding-3-small (1536-dim). Tier boosting: t1=1.5x, t2=1.2x, t3=1.0x. Auth: X-API-Key header. Cloud SQL: agentbox-db-packetfabric (shared with CRM).'
),
('dtiq', 'rag', 'rag-service-dtiq', 'DAAITeam/RAGService', 'main',
  '[]'::jsonb,
  '[{"name": "DATABASE_URL", "gcp_secret": "dtiq-database-url"}, {"name": "OPENAI_API_KEY", "gcp_secret": "dtiq-openai-api-key"}, {"name": "ANTHROPIC_API_KEY", "gcp_secret": "dtiq-anthropic-api-key"}, {"name": "RAG_API_KEY", "gcp_secret": "dtiq-rag-api-key"}]'::jsonb,
  'Deploys via GitHub Actions on push to main.',
  'Cloud SQL: agentbox-db-dtiq.'
),
('element8', 'rag', 'rag-service-element8', 'DAAITeam/RAGService', 'main',
  '[]'::jsonb,
  '[{"name": "DATABASE_URL", "gcp_secret": "element8-database-url"}, {"name": "OPENAI_API_KEY", "gcp_secret": "element8-openai-api-key"}, {"name": "ANTHROPIC_API_KEY", "gcp_secret": "element8-anthropic-api-key"}, {"name": "RAG_API_KEY", "gcp_secret": "element8-rag-api-key"}]'::jsonb,
  'Deploys via GitHub Actions on push to main.',
  'Cloud SQL: agentbox-db-element8.'
),
('qwilt', 'rag', 'rag-service-qwilt', 'DAAITeam/RAGService', 'main',
  '[]'::jsonb,
  '[{"name": "DATABASE_URL", "gcp_secret": "qwilt-database-url"}, {"name": "OPENAI_API_KEY", "gcp_secret": "qwilt-openai-api-key"}, {"name": "ANTHROPIC_API_KEY", "gcp_secret": "qwilt-anthropic-api-key"}, {"name": "RAG_API_KEY", "gcp_secret": "qwilt-rag-api-key"}]'::jsonb,
  'Deploys via GitHub Actions on push to main.',
  'Cloud SQL: agentbox-db-qwilt.'
),
('welink', 'rag', 'rag-service-welink', 'DAAITeam/RAGService', 'main',
  '[]'::jsonb,
  '[{"name": "DATABASE_URL", "gcp_secret": "welink-database-url"}, {"name": "OPENAI_API_KEY", "gcp_secret": "welink-openai-api-key"}, {"name": "ANTHROPIC_API_KEY", "gcp_secret": "welink-anthropic-api-key"}, {"name": "RAG_API_KEY", "gcp_secret": "welink-rag-api-key"}]'::jsonb,
  'Deploys via GitHub Actions on push to main.',
  'Cloud SQL: agentbox-db-welink. No dev RAG instance exists.'
);

-- ============================================
-- Phone Agent (Node.js/Express) — 3 instances
-- Repo: DAAITeam/PhoneAgent
-- Deploy: GitHub Actions on push to main (backend/** paths)
-- PF and WL removed Mar 6 2026 (commit 6b40843)
-- Cloud Run config: Memory 1Gi, CPU 2, min 1, max 10, port 3000
-- Session affinity enabled, timeout 3600s
-- ============================================

INSERT INTO tenant_configs (tenant, service_type, cloud_run_service, github_repo, git_branch, env_vars_required, secrets, deploy_command, notes) VALUES
('dtiq', 'phone-agent', 'phone-agent-dtiq', 'DAAITeam/PhoneAgent', 'main',
  '[
    {"name": "TENANT_ID", "desc": "Company slug", "secret": false, "value": "dtiq"},
    {"name": "CRM_TENANT_ID", "desc": "CRM tenant ID", "secret": false, "value": "dtiq"},
    {"name": "NODE_ENV", "desc": "Environment", "secret": false, "value": "production"},
    {"name": "CRM_API_URL", "desc": "CRM backend URL — auto-resolved at deploy time", "secret": false}
  ]'::jsonb,
  '[
    {"name": "DATABASE_URL", "gcp_secret": "dtiq-phone-agent-database-url", "note": "SEPARATE DB from CRM backend"},
    {"name": "ANTHROPIC_API_KEY", "gcp_secret": "dtiq-anthropic-api-key"},
    {"name": "TWILIO_ACCOUNT_SID", "gcp_secret": "dtiq-twilio-account-sid"},
    {"name": "TWILIO_AUTH_TOKEN", "gcp_secret": "dtiq-twilio-auth-token"},
    {"name": "TWILIO_PHONE_NUMBER", "gcp_secret": "dtiq-twilio-phone-number"},
    {"name": "DEEPGRAM_API_KEY", "gcp_secret": "dtiq-deepgram-api-key"},
    {"name": "REDIS_URL", "gcp_secret": "dtiq-redis-url"},
    {"name": "JWT_SECRET", "gcp_secret": "dtiq-jwt-secret"},
    {"name": "CRM_API_KEY", "gcp_secret": "dtiq-api-key"},
    {"name": "PHONE_AI_SERVICE_API_KEY", "gcp_secret": "dtiq-phone-ai-api-key"}
  ]'::jsonb,
  'Deploys via GitHub Actions on push to main (backend/** paths only). Manual dispatch with company selector.',
  'Phone Agent uses SEPARATE database (secret: {company}-phone-agent-database-url, NOT {company}-database-url). Port: 3000. Memory: 1Gi, CPU: 2, min 1, max 10. Session affinity for WebSocket. Timeout: 3600s. PUBLIC_URL auto-set after deploy. Twilio webhooks configured manually per phone number.'
),
('element8', 'phone-agent', 'phone-agent-element8', 'DAAITeam/PhoneAgent', 'main',
  '[
    {"name": "TENANT_ID", "desc": "Company slug", "secret": false, "value": "element8"},
    {"name": "CRM_TENANT_ID", "desc": "CRM tenant ID", "secret": false, "value": "element8"},
    {"name": "NODE_ENV", "desc": "Environment", "secret": false, "value": "production"},
    {"name": "CRM_API_URL", "desc": "CRM backend URL — auto-resolved at deploy time", "secret": false}
  ]'::jsonb,
  '[
    {"name": "DATABASE_URL", "gcp_secret": "element8-phone-agent-database-url"},
    {"name": "ANTHROPIC_API_KEY", "gcp_secret": "element8-anthropic-api-key"},
    {"name": "TWILIO_ACCOUNT_SID", "gcp_secret": "element8-twilio-account-sid"},
    {"name": "TWILIO_AUTH_TOKEN", "gcp_secret": "element8-twilio-auth-token"},
    {"name": "TWILIO_PHONE_NUMBER", "gcp_secret": "element8-twilio-phone-number"},
    {"name": "DEEPGRAM_API_KEY", "gcp_secret": "element8-deepgram-api-key"},
    {"name": "REDIS_URL", "gcp_secret": "element8-redis-url"},
    {"name": "JWT_SECRET", "gcp_secret": "element8-jwt-secret"},
    {"name": "CRM_API_KEY", "gcp_secret": "element8-api-key"},
    {"name": "PHONE_AI_SERVICE_API_KEY", "gcp_secret": "element8-phone-ai-api-key"}
  ]'::jsonb,
  'Deploys via GitHub Actions on push to main (backend/** paths only).',
  'Same config as dtiq phone-agent. Port: 3000, Memory: 1Gi, CPU: 2, min 1, max 10.'
),
('qwilt', 'phone-agent', 'phone-agent-qwilt', 'DAAITeam/PhoneAgent', 'main',
  '[
    {"name": "TENANT_ID", "desc": "Company slug", "secret": false, "value": "qwilt"},
    {"name": "CRM_TENANT_ID", "desc": "CRM tenant ID", "secret": false, "value": "qwilt"},
    {"name": "NODE_ENV", "desc": "Environment", "secret": false, "value": "production"},
    {"name": "CRM_API_URL", "desc": "CRM backend URL — auto-resolved at deploy time", "secret": false}
  ]'::jsonb,
  '[
    {"name": "DATABASE_URL", "gcp_secret": "qwilt-phone-agent-database-url"},
    {"name": "ANTHROPIC_API_KEY", "gcp_secret": "qwilt-anthropic-api-key"},
    {"name": "TWILIO_ACCOUNT_SID", "gcp_secret": "qwilt-twilio-account-sid"},
    {"name": "TWILIO_AUTH_TOKEN", "gcp_secret": "qwilt-twilio-auth-token"},
    {"name": "TWILIO_PHONE_NUMBER", "gcp_secret": "qwilt-twilio-phone-number"},
    {"name": "DEEPGRAM_API_KEY", "gcp_secret": "qwilt-deepgram-api-key"},
    {"name": "REDIS_URL", "gcp_secret": "qwilt-redis-url"},
    {"name": "JWT_SECRET", "gcp_secret": "qwilt-jwt-secret"},
    {"name": "CRM_API_KEY", "gcp_secret": "qwilt-api-key"},
    {"name": "PHONE_AI_SERVICE_API_KEY", "gcp_secret": "qwilt-phone-ai-api-key"}
  ]'::jsonb,
  'Deploys via GitHub Actions on push to main (backend/** paths only).',
  'Same config as dtiq phone-agent. Port: 3000, Memory: 1Gi, CPU: 2, min 1, max 10.'
);

-- ============================================
-- AgentBox Dashboard (Next.js) — single instance
-- Repo: DAAITeam/AgentBoxDashboard
-- Deploy: GitHub Actions on push to main
-- Firebase project: boxai-d3b31 (separate from company CRM projects)
-- Cloud Run config: Memory 512Mi, CPU 1, min 0, max 5, port 8080
-- ============================================

INSERT INTO tenant_configs (tenant, service_type, cloud_run_service, github_repo, git_branch, env_vars_required, secrets, deploy_command, notes) VALUES
('dashboard', 'dashboard', 'agentbox-dashboard', 'DAAITeam/AgentBoxDashboard', 'main',
  '[
    {"name": "NEXT_PUBLIC_COMPANY_SLUG", "desc": "Always agentbox", "secret": false, "value": "agentbox"},
    {"name": "NEXT_PUBLIC_FIREBASE_API_KEY", "desc": "Firebase web API key (build arg, hardcoded in workflow)", "secret": false, "value": "AIzaSyDPXD8DPkOZHJXFPrHRBMfy_zE186sfsO0"},
    {"name": "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", "desc": "Firebase auth domain", "secret": false, "value": "boxai-d3b31.firebaseapp.com"},
    {"name": "NEXT_PUBLIC_FIREBASE_PROJECT_ID", "desc": "Firebase project ID", "secret": false, "value": "boxai-d3b31"},
    {"name": "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", "desc": "Firebase storage", "secret": false, "value": "boxai-d3b31.firebasestorage.app"},
    {"name": "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", "desc": "Firebase messaging", "secret": false, "value": "915024281656"},
    {"name": "NEXT_PUBLIC_FIREBASE_APP_ID", "desc": "Firebase app ID", "secret": false, "value": "1:915024281656:web:23203039c967161bbb66cd"},
    {"name": "FIREBASE_PROJECT_ID", "desc": "Runtime Firebase project", "secret": false, "value": "boxai-d3b31"},
    {"name": "FIREBASE_CLIENT_EMAIL", "desc": "Firebase admin SA", "secret": false, "value": "firebase-adminsdk-fbsvc@boxai-d3b31.iam.gserviceaccount.com"},
    {"name": "PLANNING_DOCS_BUCKET", "desc": "GCS bucket for planning docs", "secret": false, "value": "da-platform-assets"}
  ]'::jsonb,
  '[{"name": "FIREBASE_PRIVATE_KEY", "gcp_secret": "agentbox-dashboard-firebase-key"}]'::jsonb,
  'Deploys via GitHub Actions on push to main. Firebase config hardcoded in workflow (not from Secret Manager).',
  'Internal ops dashboard. Firebase project: boxai-d3b31 (separate from company CRMs). Single instance, NOT per-company. NO Cloud SQL attached.'
);

-- ============================================
-- MCP Server (AgentBoxDev) — single instance
-- Repo: DAAIDev/AgentBoxDev
-- Deploy: GitHub Actions on push to main
-- Cloud Run config: Memory 512Mi, CPU 1, min 0, max 3, port 8080
-- Cloud SQL: agentbox-db-mcp
-- ============================================

INSERT INTO tenant_configs (tenant, service_type, cloud_run_service, github_repo, git_branch, env_vars_required, secrets, deploy_command, notes) VALUES
('mcp-server', 'mcp', 'mcp-server', 'DAAIDev/AgentBoxDev', 'main',
  '[
    {"name": "NODE_ENV", "desc": "Environment", "secret": false, "value": "production"},
    {"name": "GCS_BUCKET", "desc": "GCS bucket for documents", "secret": false, "value": "mcp-documents-agentbox"},
    {"name": "CRM_INSTANCES", "desc": "Comma-separated company list", "secret": false, "value": "dtiq,packetfabric,element8,qwilt,welink,dev"},
    {"name": "CRM_URL_*", "desc": "CRM backend URLs per company — auto-resolved at deploy time from Cloud Run", "secret": false}
  ]'::jsonb,
  '[
    {"name": "DATABASE_URL", "gcp_secret": "mcp-database-url"},
    {"name": "ANTHROPIC_API_KEY", "gcp_secret": "mcp-anthropic-api-key"},
    {"name": "GMAIL_USER", "gcp_secret": "mcp-gmail-user"},
    {"name": "GMAIL_APP_PASSWORD", "gcp_secret": "mcp-gmail-app-password"},
    {"name": "GOOGLE_CLIENT_ID", "gcp_secret": "mcp-google-client-id"},
    {"name": "GOOGLE_CLIENT_SECRET", "gcp_secret": "mcp-google-client-secret"},
    {"name": "GOOGLE_REFRESH_TOKEN", "gcp_secret": "mcp-google-refresh-token"},
    {"name": "CRM_KEY_DTIQ", "gcp_secret": "dtiq-api-key"},
    {"name": "CRM_KEY_PACKETFABRIC", "gcp_secret": "packetfabric-api-key"},
    {"name": "CRM_KEY_ELEMENT8", "gcp_secret": "element8-api-key"},
    {"name": "CRM_KEY_QWILT", "gcp_secret": "qwilt-api-key"},
    {"name": "CRM_KEY_WELINK", "gcp_secret": "welink-api-key"},
    {"name": "CRM_KEY_DEV", "gcp_secret": "dev-api-key"},
    {"name": "GITHUB_TOKEN", "gcp_secret": "mcp-github-token"},
    {"name": "FIREBASE_PROJECT_ID", "gcp_secret": "mcp-firebase-project-id"},
    {"name": "FIREBASE_CLIENT_EMAIL", "gcp_secret": "mcp-firebase-client-email"},
    {"name": "FIREBASE_PRIVATE_KEY", "gcp_secret": "mcp-firebase-private-key"},
    {"name": "GCP_SERVICE_ACCOUNT_JSON", "gcp_secret": "mcp-gcp-service-account"}
  ]'::jsonb,
  'Deploys via GitHub Actions on push to main. CRM URLs auto-resolved from Cloud Run at deploy time.',
  'Central MCP server for all Claude Code agents and the AgentBox Dashboard. 65+ tools. Cloud SQL: agentbox-db-mcp. GitHub org: DAAIDev (not DAAITeam). Max 3 instances.'
);

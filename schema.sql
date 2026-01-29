-- ============================================
-- MCP Project Tracker Schema
-- Run this in Supabase SQL Editor
-- ============================================

-- Companies
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'discovery' CHECK (status IN ('discovery', 'active', 'pilot', 'deployed')),
  tools TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Contacts at each company
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT,
  email TEXT,
  phone TEXT,
  is_primary BOOLEAN DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Milestones
CREATE TABLE milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'done', 'blocked')),
  order_index INT DEFAULT 0,
  due_date DATE,
  completed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Documents
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT,
  storage_path TEXT,
  url TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

-- Activity/Notes log
CREATE TABLE activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  type TEXT DEFAULT 'note' CHECK (type IN ('note', 'milestone', 'document', 'meeting', 'call', 'email')),
  content TEXT NOT NULL,
  author TEXT DEFAULT 'Chris',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Requirements (what we have / what we need)
CREATE TABLE requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  item TEXT NOT NULL,
  status TEXT DEFAULT 'needed' CHECK (status IN ('needed', 'requested', 'received')),
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_milestones_company ON milestones(company_id);
CREATE INDEX idx_activity_company ON activity(company_id);
CREATE INDEX idx_activity_created ON activity(created_at DESC);
CREATE INDEX idx_requirements_company ON requirements(company_id);
CREATE INDEX idx_documents_company ON documents(company_id);
CREATE INDEX idx_contacts_company ON contacts(company_id);

-- Enable Row Level Security (optional, for multi-user later)
-- ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE milestones ENABLE ROW LEVEL SECURITY;
-- etc.

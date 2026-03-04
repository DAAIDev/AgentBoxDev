// seed.js - Run with: node seed.js
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

async function seed() {
  console.log('Seeding database...\n');

  // ============ COMPANIES ============
  const companies = [
    { slug: 'dtiq', name: 'DTIQ', description: 'IoT video surveillance, loss prevention, and operational analytics solutions', status: 'active', tools: '{Zendesk,Salesforce,ChurnZero}' },
    { slug: 'element8', name: 'Element 8 / ATLINK', description: 'ISP / Wireless broadband with multi-network support. Starting with support, then website interface for natural language questions.', status: 'active', tools: '{PowerCode,Podium,Skyswitch,"Go High Level",Crowdfiber,WISDM.ai,Actify.ai,Spotio,softr.io}' },
    { slug: 'qwilt', name: 'QWILT', description: 'Content delivery and edge computing. Most support via email/Slack, little phone intake. Escalations are calls to next person up.', status: 'active', tools: '{Zendesk,Coralogix,Zabbix,Slack}' },
    { slug: 'packetfabric', name: 'PacketFabric', description: 'Network-as-a-Service. Includes Unitas and INAP.', status: 'active', tools: '{ServiceNow}' },
    { slug: 'welink', name: 'Welink', description: 'ISP / Broadband - similar profile to Element 8, flows will likely be the same', status: 'discovery', tools: '{}' },
  ];

  for (const c of companies) {
    await pool.query(
      `INSERT INTO companies (slug, name, description, status, tools)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (slug) DO UPDATE SET name = $2, description = $3, status = $4, tools = $5
       RETURNING id`,
      [c.slug, c.name, c.description, c.status, c.tools]
    );
  }
  console.log(`✓ Seeded ${companies.length} companies`);

  // Get company IDs
  const { rows: companyRows } = await pool.query('SELECT id, slug FROM companies');
  const companyIds = {};
  for (const c of companyRows) companyIds[c.slug] = c.id;

  // ============ MILESTONES ============
  const milestones = [
    { company_id: companyIds.dtiq, title: 'Ticket export received (11/2025+)', status: 'done', order_index: 0 },
    { company_id: companyIds.dtiq, title: 'RAG ticket data', status: 'pending', order_index: 1 },
    { company_id: companyIds.dtiq, title: 'Download Zendesk docs', status: 'pending', order_index: 2 },
    { company_id: companyIds.dtiq, title: 'Ingest Zendesk docs to RAG', status: 'pending', order_index: 3 },
    { company_id: companyIds.dtiq, title: 'Receive call files', status: 'pending', order_index: 4 },
    { company_id: companyIds.dtiq, title: 'MCP server integration', status: 'pending', order_index: 5 },
    { company_id: companyIds.dtiq, title: 'L1 voice agent prototype', status: 'pending', order_index: 6 },
    { company_id: companyIds.dtiq, title: 'Benchmark testing', status: 'pending', order_index: 7 },
    { company_id: companyIds.dtiq, title: 'Pilot deployment', status: 'pending', order_index: 8 },
    { company_id: companyIds.element8, title: 'Training docs received', status: 'done', order_index: 0 },
    { company_id: companyIds.element8, title: 'Notes from E8 received', status: 'done', order_index: 1 },
    { company_id: companyIds.element8, title: 'Get Powercode API access', status: 'pending', order_index: 2 },
    { company_id: companyIds.element8, title: 'Download tickets from Powercode', status: 'pending', order_index: 3 },
    { company_id: companyIds.element8, title: 'Understand Powercode workflow', status: 'pending', order_index: 4 },
    { company_id: companyIds.element8, title: 'Docs uploaded to RAG engine', status: 'pending', order_index: 5 },
    { company_id: companyIds.element8, title: 'MCP server integration', status: 'pending', order_index: 6 },
    { company_id: companyIds.element8, title: 'L1 support prototype', status: 'pending', order_index: 7 },
    { company_id: companyIds.element8, title: 'Benchmark testing', status: 'pending', order_index: 8 },
    { company_id: companyIds.element8, title: 'Pilot deployment', status: 'pending', order_index: 9 },
    { company_id: companyIds.element8, title: '[FUTURE] Website NL interface', status: 'pending', order_index: 100 },
    { company_id: companyIds.element8, title: '[FUTURE] Sales internal agent (sales #s, who led, who closed)', status: 'pending', order_index: 101 },
    { company_id: companyIds.element8, title: '[FUTURE] Billing team automation', status: 'pending', order_index: 102 },
    { company_id: companyIds.element8, title: '[FUTURE] Sales team automation', status: 'pending', order_index: 103 },
    { company_id: companyIds.element8, title: '[FUTURE] Rescheduling SOP automation', status: 'pending', order_index: 104 },
    { company_id: companyIds.element8, title: '[FUTURE] Spanish language support', status: 'pending', order_index: 105 },
    { company_id: companyIds.element8, title: '[FUTURE] Address serviceability checks', status: 'pending', order_index: 106 },
    { company_id: companyIds.qwilt, title: 'Met with head of support', status: 'done', order_index: 0 },
    { company_id: companyIds.qwilt, title: 'Get support documentation', status: 'pending', order_index: 1 },
    { company_id: companyIds.qwilt, title: 'Get Slack API access', status: 'pending', order_index: 2 },
    { company_id: companyIds.qwilt, title: 'Slack integration', status: 'pending', order_index: 3 },
    { company_id: companyIds.qwilt, title: 'Automate L1 requests (email/Slack)', status: 'pending', order_index: 4 },
    { company_id: companyIds.qwilt, title: 'Automate escalation calls', status: 'pending', order_index: 5 },
    { company_id: companyIds.qwilt, title: 'Docs uploaded to RAG engine', status: 'pending', order_index: 6 },
    { company_id: companyIds.qwilt, title: 'Benchmark testing', status: 'pending', order_index: 7 },
    { company_id: companyIds.qwilt, title: 'Pilot deployment', status: 'pending', order_index: 8 },
    { company_id: companyIds.packetfabric, title: 'Ticket access (PF, Unitas, INAP)', status: 'done', order_index: 0 },
    { company_id: companyIds.packetfabric, title: 'Get support documentation', status: 'pending', order_index: 1 },
    { company_id: companyIds.packetfabric, title: 'Get access to 3rd party software', status: 'pending', order_index: 2 },
    { company_id: companyIds.packetfabric, title: 'Meet to discuss replacing ServiceNow', status: 'pending', order_index: 3 },
    { company_id: companyIds.packetfabric, title: 'Map out full support workflow', status: 'pending', order_index: 4 },
    { company_id: companyIds.packetfabric, title: 'Docs uploaded to RAG engine', status: 'pending', order_index: 5 },
    { company_id: companyIds.packetfabric, title: 'MCP server integration', status: 'pending', order_index: 6 },
    { company_id: companyIds.packetfabric, title: 'Benchmark testing', status: 'pending', order_index: 7 },
    { company_id: companyIds.packetfabric, title: 'Pilot deployment', status: 'pending', order_index: 8 },
    { company_id: companyIds.welink, title: 'Discovery call (tomorrow)', status: 'pending', order_index: 0 },
    { company_id: companyIds.welink, title: 'Get data', status: 'pending', order_index: 1 },
    { company_id: companyIds.welink, title: 'Get all 3rd party tools list', status: 'pending', order_index: 2 },
    { company_id: companyIds.welink, title: 'Get documentation', status: 'pending', order_index: 3 },
    { company_id: companyIds.welink, title: 'Docs uploaded to RAG engine', status: 'pending', order_index: 4 },
    { company_id: companyIds.welink, title: 'MCP server integration', status: 'pending', order_index: 5 },
    { company_id: companyIds.welink, title: 'L1 support prototype (reuse E8 flows)', status: 'pending', order_index: 6 },
    { company_id: companyIds.welink, title: 'Benchmark testing', status: 'pending', order_index: 7 },
    { company_id: companyIds.welink, title: 'Pilot deployment', status: 'pending', order_index: 8 },
  ];

  for (const m of milestones) {
    await pool.query(
      'INSERT INTO milestones (company_id, title, status, order_index) VALUES ($1, $2, $3, $4)',
      [m.company_id, m.title, m.status, m.order_index]
    );
  }
  console.log(`✓ Seeded ${milestones.length} milestones`);

  // ============ REQUIREMENTS ============
  const requirements = [
    { company_id: companyIds.dtiq, item: 'Ticket Export (11/2025+)', status: 'received' },
    { company_id: companyIds.dtiq, item: 'Zendesk Docs', status: 'needed', notes: 'Need to download and ingest' },
    { company_id: companyIds.dtiq, item: 'Call Files', status: 'needed', notes: 'Waiting on these' },
    { company_id: companyIds.dtiq, item: 'Salesforce API Access', status: 'needed' },
    { company_id: companyIds.dtiq, item: 'ChurnZero API Access', status: 'needed' },
    { company_id: companyIds.element8, item: 'Training Docs', status: 'received' },
    { company_id: companyIds.element8, item: 'Notes from E8', status: 'received' },
    { company_id: companyIds.element8, item: 'Powercode API Access', status: 'needed' },
    { company_id: companyIds.element8, item: 'Powercode Tickets', status: 'needed' },
    { company_id: companyIds.qwilt, item: 'Met with Head of Support', status: 'received' },
    { company_id: companyIds.qwilt, item: 'Support Documentation', status: 'needed' },
    { company_id: companyIds.qwilt, item: 'Slack API Access', status: 'needed' },
    { company_id: companyIds.packetfabric, item: 'Ticket Access (PF, Unitas, INAP)', status: 'received' },
    { company_id: companyIds.packetfabric, item: 'Support Documentation', status: 'needed' },
    { company_id: companyIds.packetfabric, item: '3rd Party Software Access', status: 'needed' },
    { company_id: companyIds.packetfabric, item: 'ServiceNow Replacement Discussion', status: 'needed' },
    { company_id: companyIds.welink, item: 'Discovery Call', status: 'needed', notes: 'Tomorrow' },
    { company_id: companyIds.welink, item: 'Data', status: 'needed' },
    { company_id: companyIds.welink, item: '3rd Party Tools List', status: 'needed' },
    { company_id: companyIds.welink, item: 'Documentation', status: 'needed' },
  ];

  for (const r of requirements) {
    await pool.query(
      'INSERT INTO requirements (company_id, item, status, notes) VALUES ($1, $2, $3, $4)',
      [r.company_id, r.item, r.status, r.notes || null]
    );
  }
  console.log(`✓ Seeded ${requirements.length} requirements`);

  console.log('\n✅ Database seeded successfully!');
  await pool.end();
}

seed().catch(console.error);

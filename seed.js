// seed.js - Run with: node seed.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function seed() {
  console.log('Seeding database...\n');

  // ============ COMPANIES ============
  const companies = [
    {
      slug: 'dtiq',
      name: 'DTIQ',
      description: 'IoT video surveillance, loss prevention, and operational analytics solutions',
      status: 'active',
      tools: ['Zendesk', 'Salesforce', 'ChurnZero']
    },
    {
      slug: 'element8',
      name: 'Element 8 / ATLINK',
      description: 'ISP / Wireless broadband with multi-network support. Starting with support, then website interface for natural language questions.',
      status: 'active',
      tools: ['PowerCode', 'Podium', 'Skyswitch', 'Go High Level', 'Crowdfiber', 'WISDM.ai', 'Actify.ai', 'Spotio', 'softr.io']
    },
    {
      slug: 'qwilt',
      name: 'QWILT',
      description: 'Content delivery and edge computing. Most support via email/Slack, little phone intake. Escalations are calls to next person up.',
      status: 'active',
      tools: ['Zendesk', 'Coralogix', 'Zabbix', 'Slack']
    },
    {
      slug: 'packetfabric',
      name: 'PacketFabric',
      description: 'Network-as-a-Service. Includes Unitas and INAP.',
      status: 'active',
      tools: ['ServiceNow']
    },
    {
      slug: 'welink',
      name: 'Welink',
      description: 'ISP / Broadband - similar profile to Element 8, flows will likely be the same',
      status: 'discovery',
      tools: []
    }
  ];

  const { data: companyData, error: companyError } = await supabase
    .from('companies')
    .upsert(companies, { onConflict: 'slug' })
    .select();

  if (companyError) {
    console.error('Error seeding companies:', companyError);
    return;
  }
  console.log(`✓ Seeded ${companyData.length} companies`);

  // Get company IDs
  const companyIds = {};
  for (const c of companyData) {
    companyIds[c.slug] = c.id;
  }

  // ============ MILESTONES ============
  const milestones = [
    // DTIQ
    { company_id: companyIds.dtiq, title: 'Ticket export received (11/2025+)', status: 'done', order_index: 0 },
    { company_id: companyIds.dtiq, title: 'RAG ticket data', status: 'pending', order_index: 1 },
    { company_id: companyIds.dtiq, title: 'Download Zendesk docs', status: 'pending', order_index: 2 },
    { company_id: companyIds.dtiq, title: 'Ingest Zendesk docs to RAG', status: 'pending', order_index: 3 },
    { company_id: companyIds.dtiq, title: 'Receive call files', status: 'pending', order_index: 4 },
    { company_id: companyIds.dtiq, title: 'MCP server integration', status: 'pending', order_index: 5 },
    { company_id: companyIds.dtiq, title: 'L1 voice agent prototype', status: 'pending', order_index: 6 },
    { company_id: companyIds.dtiq, title: 'Benchmark testing', status: 'pending', order_index: 7 },
    { company_id: companyIds.dtiq, title: 'Pilot deployment', status: 'pending', order_index: 8 },

    // Element 8 - Current Phase
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
    // Element 8 - Future Features
    { company_id: companyIds.element8, title: '[FUTURE] Website NL interface', status: 'pending', order_index: 100 },
    { company_id: companyIds.element8, title: '[FUTURE] Sales internal agent (sales #s, who led, who closed)', status: 'pending', order_index: 101 },
    { company_id: companyIds.element8, title: '[FUTURE] Billing team automation', status: 'pending', order_index: 102 },
    { company_id: companyIds.element8, title: '[FUTURE] Sales team automation', status: 'pending', order_index: 103 },
    { company_id: companyIds.element8, title: '[FUTURE] Rescheduling SOP automation', status: 'pending', order_index: 104 },
    { company_id: companyIds.element8, title: '[FUTURE] Spanish language support', status: 'pending', order_index: 105 },
    { company_id: companyIds.element8, title: '[FUTURE] Address serviceability checks', status: 'pending', order_index: 106 },

    // QWILT
    { company_id: companyIds.qwilt, title: 'Met with head of support', status: 'done', order_index: 0 },
    { company_id: companyIds.qwilt, title: 'Get support documentation', status: 'pending', order_index: 1 },
    { company_id: companyIds.qwilt, title: 'Get Slack API access', status: 'pending', order_index: 2 },
    { company_id: companyIds.qwilt, title: 'Slack integration', status: 'pending', order_index: 3 },
    { company_id: companyIds.qwilt, title: 'Automate L1 requests (email/Slack)', status: 'pending', order_index: 4 },
    { company_id: companyIds.qwilt, title: 'Automate escalation calls', status: 'pending', order_index: 5 },
    { company_id: companyIds.qwilt, title: 'Docs uploaded to RAG engine', status: 'pending', order_index: 6 },
    { company_id: companyIds.qwilt, title: 'Benchmark testing', status: 'pending', order_index: 7 },
    { company_id: companyIds.qwilt, title: 'Pilot deployment', status: 'pending', order_index: 8 },

    // PacketFabric
    { company_id: companyIds.packetfabric, title: 'Ticket access (PF, Unitas, INAP)', status: 'done', order_index: 0 },
    { company_id: companyIds.packetfabric, title: 'Get support documentation', status: 'pending', order_index: 1 },
    { company_id: companyIds.packetfabric, title: 'Get access to 3rd party software', status: 'pending', order_index: 2 },
    { company_id: companyIds.packetfabric, title: 'Meet to discuss replacing ServiceNow', status: 'pending', order_index: 3 },
    { company_id: companyIds.packetfabric, title: 'Map out full support workflow', status: 'pending', order_index: 4 },
    { company_id: companyIds.packetfabric, title: 'Docs uploaded to RAG engine', status: 'pending', order_index: 5 },
    { company_id: companyIds.packetfabric, title: 'MCP server integration', status: 'pending', order_index: 6 },
    { company_id: companyIds.packetfabric, title: 'Benchmark testing', status: 'pending', order_index: 7 },
    { company_id: companyIds.packetfabric, title: 'Pilot deployment', status: 'pending', order_index: 8 },

    // Welink
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

  const { data: milestoneData, error: milestoneError } = await supabase
    .from('milestones')
    .insert(milestones)
    .select();

  if (milestoneError) {
    console.error('Error seeding milestones:', milestoneError);
  } else {
    console.log(`✓ Seeded ${milestoneData.length} milestones`);
  }

  // ============ REQUIREMENTS ============
  const requirements = [
    // DTIQ
    { company_id: companyIds.dtiq, item: 'Ticket Export (11/2025+)', status: 'received' },
    { company_id: companyIds.dtiq, item: 'Zendesk Docs', status: 'needed', notes: 'Need to download and ingest' },
    { company_id: companyIds.dtiq, item: 'Call Files', status: 'needed', notes: 'Waiting on these' },
    { company_id: companyIds.dtiq, item: 'Salesforce API Access', status: 'needed' },
    { company_id: companyIds.dtiq, item: 'ChurnZero API Access', status: 'needed' },

    // Element 8
    { company_id: companyIds.element8, item: 'Training Docs', status: 'received' },
    { company_id: companyIds.element8, item: 'Notes from E8', status: 'received' },
    { company_id: companyIds.element8, item: 'Powercode API Access', status: 'needed' },
    { company_id: companyIds.element8, item: 'Powercode Tickets', status: 'needed' },

    // QWILT
    { company_id: companyIds.qwilt, item: 'Met with Head of Support', status: 'received' },
    { company_id: companyIds.qwilt, item: 'Support Documentation', status: 'needed' },
    { company_id: companyIds.qwilt, item: 'Slack API Access', status: 'needed' },

    // PacketFabric
    { company_id: companyIds.packetfabric, item: 'Ticket Access (PF, Unitas, INAP)', status: 'received' },
    { company_id: companyIds.packetfabric, item: 'Support Documentation', status: 'needed' },
    { company_id: companyIds.packetfabric, item: '3rd Party Software Access', status: 'needed' },
    { company_id: companyIds.packetfabric, item: 'ServiceNow Replacement Discussion', status: 'needed' },

    // Welink
    { company_id: companyIds.welink, item: 'Discovery Call', status: 'needed', notes: 'Tomorrow' },
    { company_id: companyIds.welink, item: 'Data', status: 'needed' },
    { company_id: companyIds.welink, item: '3rd Party Tools List', status: 'needed' },
    { company_id: companyIds.welink, item: 'Documentation', status: 'needed' },
  ];

  const { data: reqData, error: reqError } = await supabase
    .from('requirements')
    .insert(requirements)
    .select();

  if (reqError) {
    console.error('Error seeding requirements:', reqError);
  } else {
    console.log(`✓ Seeded ${reqData.length} requirements`);
  }

  // ============ INITIAL ACTIVITY ============
  const activity = [
    // DTIQ
    { company_id: companyIds.dtiq, type: 'document', content: 'Received ticket export going back to 11/2025' },
    { company_id: companyIds.dtiq, type: 'note', content: 'Need to RAG ticket data, download Zendesk docs, and ingest' },
    { company_id: companyIds.dtiq, type: 'note', content: 'Waiting on call files' },
    
    // Element 8
    { company_id: companyIds.element8, type: 'document', content: 'Received training docs and notes' },
    { company_id: companyIds.element8, type: 'meeting', content: 'Got detailed notes on tools: PowerCode (operational/tickets), Podium, Skyswitch (whitelabel PDX), Go High Level (early pipeline), Crowdfiber (Texas), WISDM.ai (24/7 support+sales, Spanish, address serviceable), Actify.ai (qualification), Spotio (door to door), softr.io (looking at for AI dashboard)' },
    { company_id: companyIds.element8, type: 'note', content: 'Customer facing inbound: Sales, Support, Billing' },
    { company_id: companyIds.element8, type: 'note', content: 'Internal agent wishlist: Sales manager queries (sales #s, who led, who closed)' },
    { company_id: companyIds.element8, type: 'note', content: 'Future automation: Rescheduling SOP, Billing team workflows, Sales team workflows' },
    { company_id: companyIds.element8, type: 'note', content: 'Starting with support, then website NL interface' },
    
    // QWILT
    { company_id: companyIds.qwilt, type: 'meeting', content: 'Met with head of support' },
    { company_id: companyIds.qwilt, type: 'note', content: 'Most support via email/Slack, little phone intake' },
    { company_id: companyIds.qwilt, type: 'note', content: 'Escalations are calls to next person up - automating these could be a win' },
    { company_id: companyIds.qwilt, type: 'note', content: 'Real win: Slack integration + L1 request automation' },
    
    // PacketFabric
    { company_id: companyIds.packetfabric, type: 'note', content: 'Have access to tickets for PF, Unitas, INAP' },
    { company_id: companyIds.packetfabric, type: 'note', content: 'Need to meet to discuss replacing ServiceNow' },
    { company_id: companyIds.packetfabric, type: 'note', content: 'Need to map out full support workflow' },
    
    // Welink
    { company_id: companyIds.welink, type: 'note', content: 'Similar to E8 - flows will likely be the same' },
    { company_id: companyIds.welink, type: 'note', content: 'Discovery call tomorrow' },
  ];

  const { data: activityData, error: activityError } = await supabase
    .from('activity')
    .insert(activity)
    .select();

  if (activityError) {
    console.error('Error seeding activity:', activityError);
  } else {
    console.log(`✓ Seeded ${activityData.length} activity entries`);
  }

  console.log('\n✅ Database seeded successfully!');
}

seed().catch(console.error);

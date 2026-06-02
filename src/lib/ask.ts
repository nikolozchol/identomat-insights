import Anthropic from '@anthropic-ai/sdk';
import { getSupabaseAdmin } from './supabase';

const MODEL = 'claude-haiku-4-5-20251001';
const WS = '00000000-0000-0000-0000-000000000001';

// Per-page GA4 rows are stored at this sentinel (channel/country = '(all)').
const ALL = '(all)';

const ACTIONABLE_SEV = new Set(['critical', 'high', 'medium']);

const INTENTS = ['page_diagnosis', 'biggest_opportunities', 'page_metrics', 'query_performance', 'site_metrics', 'unknown'] as const;
type Intent = (typeof INTENTS)[number];

type Classification = {
  intent: Intent;
  entities: { page_url?: string; query?: string };
  date_range: { start: string; end: string } | null;
};

type InsightLite = {
  id: string;
  detector: string;
  category: string;
  severity: string;
  polarity: string;
  title: string;
  narrative: string | null;
  evidence: Record<string, unknown>;
  page_id: string | null;
};

type ActionSuggestion = { insight_id: string; title: string; severity: string; polarity: string };

type Confidence = 'high' | 'medium' | 'low' | 'n/a';

export type AskResult = {
  intent: Intent;
  found: boolean;
  answer: string;
  confidence: Confidence;
  citedInsightIds: string[];
  actionSuggestions: ActionSuggestion[];
  dateRange: { start: string; end: string } | null;
};

type HandlerOut = {
  found: boolean;
  facts: string;                       // locked numbers/insights sent to the explainer
  fallbackAnswer: string;              // deterministic answer used if the LLM call fails / !found
  evidence: Record<string, unknown>;   // structured, stored in questions.evidence
  citedInsights: InsightLite[];
  confidence: Confidence;
  dateRange: { start: string; end: string } | null;
};

// ---------- small helpers ----------

function normalizePath(raw: string): string {
  let p = (raw ?? '').trim();
  if (!p) return '';
  if (/^https?:\/\//i.test(p)) {
    try { p = new URL(p).pathname; } catch { /* keep as-is */ }
  }
  if (!p.startsWith('/')) p = '/' + p;
  return p.length > 1 ? p.replace(/\/+$/, '') : p;
}

function pathVariants(p: string): string[] {
  if (!p || p === '/') return ['/'];
  return Array.from(new Set([p, p + '/']));
}

function asNum(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function sev(s: string): number {
  const r: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return r[s] ?? 4;
}

function isActionable(i: InsightLite): boolean {
  return (i.polarity === 'issue' || i.polarity === 'opportunity') && ACTIONABLE_SEV.has(i.severity);
}

function insightPath(i: InsightLite): string | null {
  const ev = i.evidence ?? {};
  for (const k of ['page_path', 'page', 'url', 'path']) {
    const v = ev[k];
    if (typeof v === 'string' && v.trim()) return normalizePath(v);
  }
  return null;
}

function completeness(daysWithData: number, windowDays: number): Confidence {
  if (windowDays <= 0) return 'n/a';
  const frac = daysWithData / windowDays;
  if (frac >= 0.75) return 'high';
  if (frac >= 0.4) return 'medium';
  return 'low';
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start === -1 || end === -1 || end < start) return null;
    return JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------- data loaders ----------

async function loadActiveInsights(): Promise<InsightLite[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('insights')
    .select('id, detector, category, severity, polarity, title, narrative, evidence, page_id')
    .eq('workspace_id', WS)
    .eq('status', 'active')
    .order('severity', { ascending: true });
  if (error) throw new Error(`load insights failed: ${error.message}`);
  return ((data ?? []) as Array<Partial<InsightLite>>).map((r) => ({
    id: String(r.id),
    detector: String(r.detector ?? ''),
    category: String(r.category ?? ''),
    severity: String(r.severity ?? 'low'),
    polarity: String(r.polarity ?? 'issue'),
    title: String(r.title ?? ''),
    narrative: (r.narrative as string | null) ?? null,
    evidence: (r.evidence as Record<string, unknown>) ?? {},
    page_id: (r.page_id as string | null) ?? null,
  }));
}

async function loadActionedInsightIds(): Promise<Set<string>> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from('actions').select('insight_id').eq('workspace_id', WS);
  if (error) throw new Error(`load actions failed: ${error.message}`);
  return new Set(
    ((data ?? []) as Array<{ insight_id: string | null }>).map((a) => a.insight_id).filter((x): x is string => !!x),
  );
}

async function latestDate(table: string): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(table)
    .select('date')
    .eq('workspace_id', WS)
    .order('date', { ascending: false })
    .limit(1);
  if (error) throw new Error(`latest date (${table}) failed: ${error.message}`);
  const row = ((data ?? []) as Array<{ date: string }>)[0];
  return row?.date ?? null;
}

function resolveWindow(
  dr: { start: string; end: string } | null,
  anchorEnd: string | null,
  days = 28,
): { start: string; end: string } | null {
  if (dr && dr.start && dr.end) return dr;
  if (!anchorEnd) return null;
  const startD = new Date(anchorEnd + 'T00:00:00Z');
  startD.setUTCDate(startD.getUTCDate() - (days - 1));
  return { start: startD.toISOString().slice(0, 10), end: anchorEnd };
}

function windowDays(w: { start: string; end: string }): number {
  const a = new Date(w.start + 'T00:00:00Z').getTime();
  const b = new Date(w.end + 'T00:00:00Z').getTime();
  return Math.max(1, Math.round((b - a) / 864e5) + 1);
}

// ---------- handlers ----------

function insightLines(items: InsightLite[]): string {
  return items
    .map((i) => `- [${i.polarity}/${i.severity}] ${i.title}${i.narrative ? ` — ${i.narrative}` : ''}`)
    .join('\n');
}

async function handlePageDiagnosis(c: Classification, insights: InsightLite[]): Promise<HandlerOut> {
  const path = normalizePath(c.entities.page_url ?? '');
  if (!path) {
    return notFound('Which page should I look at? For example: "what\'s going on with /pricing?"');
  }
  const variants = new Set(pathVariants(path));
  const matched = insights.filter((i) => {
    const ip = insightPath(i);
    return ip ? variants.has(ip) : false;
  });
  if (matched.length === 0) {
    return {
      found: false,
      facts: '',
      fallbackAnswer: `No active issues or opportunities are currently flagged for ${path}. You can ask for its traffic and search metrics instead (e.g. "how is ${path} doing?").`,
      evidence: { page: path },
      citedInsights: [],
      confidence: 'n/a',
      dateRange: null,
    };
  }
  matched.sort((a, b) => sev(a.severity) - sev(b.severity));
  const facts = `Page: ${path}\nActive findings for this page:\n${insightLines(matched)}`;
  const counts = `${matched.length} active finding${matched.length === 1 ? '' : 's'}`;
  return {
    found: true,
    facts,
    fallbackAnswer: `${path} has ${counts}: ${matched.map((m) => m.title).join('; ')}.`,
    evidence: { page: path, findings: matched.map((m) => ({ detector: m.detector, severity: m.severity, polarity: m.polarity, title: m.title })) },
    citedInsights: matched,
    confidence: 'medium',
    dateRange: null,
  };
}

async function handleBiggestOpportunities(insights: InsightLite[]): Promise<HandlerOut> {
  const opps = insights.filter((i) => i.polarity === 'opportunity');
  const issues = insights.filter((i) => i.polarity === 'issue');
  const picked = [...opps, ...issues].sort((a, b) => sev(a.severity) - sev(b.severity)).slice(0, 6);
  if (picked.length === 0) {
    return notFound('No active opportunities or issues are flagged right now — the feed is quiet.');
  }
  const facts = `The most important active opportunities and issues, by severity:\n${insightLines(picked)}`;
  return {
    found: true,
    facts,
    fallbackAnswer: `Top focus areas right now: ${picked.map((m) => m.title).join('; ')}.`,
    evidence: { items: picked.map((m) => ({ detector: m.detector, severity: m.severity, polarity: m.polarity, title: m.title })) },
    citedInsights: picked,
    confidence: 'medium',
    dateRange: null,
  };
}

async function handlePageMetrics(c: Classification, insights: InsightLite[]): Promise<HandlerOut> {
  const supabase = getSupabaseAdmin();
  const path = normalizePath(c.entities.page_url ?? '');
  if (!path) {
    return notFound('Which page should I pull metrics for? For example: "how did /blog/x do last month?"');
  }
  const variants = pathVariants(path);
  const anchor = (await latestDate('ga4_daily')) ?? (await latestDate('gsc_daily'));
  const win = resolveWindow(c.date_range, anchor, 28);
  if (!win) return notFound(`I don't have any analytics data loaded yet, so I can't report on ${path}.`);

  // GA4 per-page rows live at channel='(all)', country='(all)'
  const { data: ga4Data, error: ga4Err } = await supabase
    .from('ga4_daily')
    .select('date, sessions, conversions, engaged_sessions')
    .eq('workspace_id', WS)
    .in('page_path', variants)
    .eq('channel', ALL)
    .eq('country', ALL)
    .gte('date', win.start)
    .lte('date', win.end);
  if (ga4Err) throw new Error(`ga4 page query failed: ${ga4Err.message}`);
  const ga4Rows = (ga4Data ?? []) as Array<{ date: string; sessions: unknown; conversions: unknown; engaged_sessions: unknown }>;
  let sessions = 0, conversions = 0, engaged = 0;
  const ga4Dates = new Set<string>();
  for (const r of ga4Rows) {
    sessions += asNum(r.sessions);
    conversions += asNum(r.conversions);
    engaged += asNum(r.engaged_sessions);
    ga4Dates.add(r.date);
  }

  // GSC per-page rows (raw page x query); aggregate
  const { data: gscData, error: gscErr } = await supabase
    .from('gsc_daily')
    .select('clicks, impressions, position')
    .eq('workspace_id', WS)
    .in('page_path', variants)
    .gte('date', win.start)
    .lte('date', win.end);
  if (gscErr) throw new Error(`gsc page query failed: ${gscErr.message}`);
  const gscRows = (gscData ?? []) as Array<{ clicks: unknown; impressions: unknown; position: unknown }>;
  let clicks = 0, impressions = 0, posWeight = 0;
  for (const r of gscRows) {
    const im = asNum(r.impressions);
    clicks += asNum(r.clicks);
    impressions += im;
    posWeight += asNum(r.position) * im;
  }
  const avgPosition = impressions > 0 ? posWeight / impressions : null;

  if (sessions === 0 && impressions === 0) {
    return notFound(`I don't have traffic or search data for ${path} between ${win.start} and ${win.end}.`);
  }

  const onPage = insights.filter((i) => {
    const ip = insightPath(i);
    return ip ? pathVariants(path).includes(ip) : false;
  });

  const factLines = [
    `Page: ${path}`,
    `Window: ${win.start} to ${win.end}`,
    `GA4 sessions: ${sessions}`,
    `GA4 demo requests (conversions): ${conversions}`,
    `GA4 engaged sessions: ${engaged}`,
    `Search clicks: ${clicks}`,
    `Search impressions: ${impressions}`,
    `Search avg position: ${avgPosition === null ? 'n/a' : avgPosition.toFixed(1)}`,
  ];
  if (onPage.length) factLines.push(`Active findings on this page:\n${insightLines(onPage)}`);

  return {
    found: true,
    facts: factLines.join('\n'),
    fallbackAnswer: `Between ${win.start} and ${win.end}, ${path} had ${sessions} sessions, ${conversions} demo requests, ${clicks} search clicks and ${impressions} impressions${avgPosition === null ? '' : ` at avg position ${avgPosition.toFixed(1)}`}.`,
    evidence: {
      page: path,
      sessions,
      conversions,
      engaged_sessions: engaged,
      gsc_clicks: clicks,
      gsc_impressions: impressions,
      gsc_avg_position: avgPosition,
    },
    citedInsights: onPage,
    confidence: completeness(ga4Dates.size || gscRows.length, windowDays(win)),
    dateRange: win,
  };
}

async function handleQueryPerformance(c: Classification, insights: InsightLite[]): Promise<HandlerOut> {
  const supabase = getSupabaseAdmin();
  const q = (c.entities.query ?? '').trim();
  if (!q) {
    return notFound('Which search query? For example: "how am I ranking for kyc api?"');
  }
  const anchor = await latestDate('gsc_daily');
  const win = resolveWindow(c.date_range, anchor, 28);
  if (!win) return notFound(`I don't have Search Console data loaded yet, so I can't report on "${q}".`);

  const { data, error } = await supabase
    .from('gsc_daily')
    .select('date, page_path, clicks, impressions, position')
    .eq('workspace_id', WS)
    .ilike('query', q)
    .gte('date', win.start)
    .lte('date', win.end);
  if (error) throw new Error(`gsc query query failed: ${error.message}`);
  const rows = (data ?? []) as Array<{ date: string; page_path: string; clicks: unknown; impressions: unknown; position: unknown }>;

  let clicks = 0, impressions = 0, posWeight = 0;
  const byPage = new Map<string, number>();
  const dates = new Set<string>();
  for (const r of rows) {
    const im = asNum(r.impressions);
    clicks += asNum(r.clicks);
    impressions += im;
    posWeight += asNum(r.position) * im;
    byPage.set(r.page_path, (byPage.get(r.page_path) ?? 0) + im);
    dates.add(r.date);
  }
  if (impressions === 0) {
    return notFound(`I don't have Search Console data for the query "${q}" between ${win.start} and ${win.end}.`);
  }
  const avgPosition = posWeight / impressions;
  const ctr = impressions > 0 ? clicks / impressions : 0;
  let topPage = '';
  let topImpr = -1;
  for (const [p, im] of byPage) if (im > topImpr) { topImpr = im; topPage = p; }

  const related = insights.filter((i) => {
    const qv = i.evidence?.query;
    return typeof qv === 'string' && qv.trim().toLowerCase() === q.toLowerCase();
  });

  const factLines = [
    `Query: "${q}"`,
    `Window: ${win.start} to ${win.end}`,
    `Clicks: ${clicks}`,
    `Impressions: ${impressions}`,
    `CTR: ${(ctr * 100).toFixed(2)}%`,
    `Avg position: ${avgPosition.toFixed(1)}`,
    `Top landing page for this query: ${topPage}`,
  ];
  if (related.length) factLines.push(`Active findings tied to this query:\n${insightLines(related)}`);

  return {
    found: true,
    facts: factLines.join('\n'),
    fallbackAnswer: `For "${q}" between ${win.start} and ${win.end}: ${impressions} impressions, ${clicks} clicks (CTR ${(ctr * 100).toFixed(2)}%), avg position ${avgPosition.toFixed(1)}, mostly landing on ${topPage}.`,
    evidence: { query: q, clicks, impressions, ctr, avg_position: avgPosition, top_page: topPage },
    citedInsights: related,
    confidence: completeness(dates.size, windowDays(win)),
    dateRange: win,
  };
}

async function handleSiteMetrics(c: Classification): Promise<HandlerOut> {
  const supabase = getSupabaseAdmin();
  const anchor = await latestDate('ga4_daily');
  const win = resolveWindow(c.date_range, anchor, 28);
  if (!win) return notFound("I don't have any analytics data loaded yet, so I can't report overall totals.");

  // Site-wide totals: GA4 '(site)' rows summed across real channels (excluding the '(all)' aggregate).
  const { data, error } = await supabase
    .from('ga4_daily')
    .select('date, sessions, conversions')
    .eq('workspace_id', WS)
    .eq('page_path', '(site)')
    .eq('country', '(all)')
    .neq('channel', '(all)')
    .gte('date', win.start)
    .lte('date', win.end);
  if (error) throw new Error(`ga4 site query failed: ${error.message}`);
  const rows = (data ?? []) as Array<{ date: string; sessions: unknown; conversions: unknown }>;
  if (rows.length === 0) return notFound(`I don't have site-wide traffic data between ${win.start} and ${win.end}.`);

  let sessions = 0, conversions = 0;
  const dates = new Set<string>();
  for (const r of rows) { sessions += asNum(r.sessions); conversions += asNum(r.conversions); dates.add(r.date); }
  const cr = sessions > 0 ? (conversions / sessions) * 100 : 0;

  const factLines = [
    'Scope: entire site',
    `Window: ${win.start} to ${win.end}`,
    `Total sessions: ${sessions}`,
    `Total conversions (GA4 key events): ${conversions}`,
    `Site conversion rate: ${cr.toFixed(2)}%`,
    'Note: GA4 "conversions" counts whichever key events the property marks (may include more than demo-request form submissions), and a conversion is recorded on whichever page the key event fires (often a confirmation or thank-you page).',
  ];

  return {
    found: true,
    facts: factLines.join('\n'),
    fallbackAnswer: `Between ${win.start} and ${win.end}, the site recorded ${conversions.toLocaleString()} conversions across ${sessions.toLocaleString()} sessions (a ${cr.toFixed(2)}% conversion rate).`,
    evidence: { scope: 'site', sessions, conversions, conversion_rate_pct: cr },
    citedInsights: [],
    confidence: completeness(dates.size, windowDays(win)),
    dateRange: win,
  };
}

function notFound(message: string): HandlerOut {
  return { found: false, facts: '', fallbackAnswer: message, evidence: {}, citedInsights: [], confidence: 'n/a', dateRange: null };
}

function unknownOut(): HandlerOut {
  return notFound(
    "I can answer questions about your pages, search queries, and where to focus — for example: \"what's going on with /pricing?\", \"how is /blog/x doing?\", \"how am I ranking for kyc api?\", or \"where should I focus?\". I couldn't map that question to the data I have.",
  );
}

// ---------- LLM stages ----------

const CLASSIFY_SYSTEM = [
  'You are an intent classifier for an internal marketing analytics tool for Identomat (a KYC / identity-verification company).',
  'Given a user question, output ONLY valid JSON (no markdown, no prose) matching this schema:',
  '{',
  '  "intent": "page_diagnosis" | "biggest_opportunities" | "page_metrics" | "query_performance" | "site_metrics" | "unknown",',
  '  "entities": { "page_url"?: string, "query"?: string },',
  '  "date_range": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" } | null',
  '}',
  '',
  'Intent meanings:',
  '- page_diagnosis: what is wrong / what is going on with a specific page (wants the flagged issues/opportunities).',
  '- page_metrics: how a specific page is performing (traffic, conversions, search clicks/impressions/position).',
  '- query_performance: how the site ranks/performs for a specific search query.',
  '- biggest_opportunities: where should I focus / what are my biggest opportunities or problems (no specific page or query).',
  '- site_metrics: overall, site-wide totals not tied to one page (total conversions, total sessions or traffic, overall conversion rate). Use this when the user asks about the whole site or uses words like "overall", "in general", "total", or "altogether".',
  '- unknown: anything outside the above or that the data cannot answer.',
  '',
  'Rules:',
  '- For page_diagnosis and page_metrics, put the page path in entities.page_url (e.g. "/pricing"). For query_performance, put the search term in entities.query.',
  '- Do NOT invent dates. If the user gives a relative range like "last month" or "last week", compute concrete dates from TODAY={{TODAY}}. Otherwise set date_range to null.',
  '- Output JSON only.',
].join('\n');

function normalizeClassification(obj: Record<string, unknown> | null): Classification {
  const intentRaw = typeof obj?.intent === 'string' ? obj.intent : 'unknown';
  const intent = (INTENTS as readonly string[]).includes(intentRaw) ? (intentRaw as Intent) : 'unknown';
  const entsRaw = (obj?.entities as Record<string, unknown>) ?? {};
  const entities: Classification['entities'] = {};
  if (typeof entsRaw.page_url === 'string' && entsRaw.page_url.trim()) entities.page_url = entsRaw.page_url.trim();
  if (typeof entsRaw.query === 'string' && entsRaw.query.trim()) entities.query = entsRaw.query.trim();
  let date_range: Classification['date_range'] = null;
  const dr = obj?.date_range as Record<string, unknown> | null | undefined;
  if (dr && typeof dr.start === 'string' && typeof dr.end === 'string' && dr.start && dr.end) {
    date_range = { start: dr.start, end: dr.end };
  }
  return { intent, entities, date_range };
}

async function classify(client: Anthropic, question: string): Promise<Classification> {
  const today = new Date().toISOString().slice(0, 10);
  const system = CLASSIFY_SYSTEM.replace('{{TODAY}}', today);
  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      system,
      messages: [{ role: 'user', content: question }],
    });
    const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
    return normalizeClassification(parseJsonObject(text));
  } catch {
    return { intent: 'unknown', entities: {}, date_range: null };
  }
}

const EXPLAIN_SYSTEM = [
  'You are a marketing analyst for Identomat (KYC / AML / identity verification). The audience is a non-technical marketing team; the primary conversion is demo requests.',
  'Answer the user question using ONLY the verified data provided below it. The numbers are already computed and correct.',
  'Rules:',
  '- Use only the figures and facts given. Never invent, estimate, or re-round numbers. If something is not in the data, say so plainly.',
  '- Do not assert causes, mechanisms, or effects that are not explicitly stated in the data. If you mention a possible cause or consequence, mark it as a possibility with words like "may", "could", or "might"; never state it as established fact.',
  '- Do not claim that one finding causes another (for example, that errors are "preventing" conversions, or that one metric "drove" another) unless the data explicitly states that link.',
  '- Zero conversions on a page does NOT mean the page fails to convert: conversions are often recorded on a separate confirmation or thank-you page after a redirect. Report the figure plainly and do not infer that the page is broken or losing conversions.',
  '- State what the data shows first; keep any suggestion brief, tentative, and clearly separate from the facts.',
  '- Be concise: 2-4 sentences of plain language that reference the actual numbers.',
  '- No markdown, no headers, no bullet lists. Just the answer.',
  '- If the data includes open issues or opportunities the user could act on, you may add ONE short closing sentence noting they can turn these into action tasks.',
].join('\n');

async function explain(client: Anthropic, question: string, facts: string): Promise<string> {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 350,
    system: EXPLAIN_SYSTEM,
    messages: [{ role: 'user', content: `Question: ${question}\n\nVerified data:\n${facts}` }],
  });
  const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
  if (!text) throw new Error('empty answer from model');
  return text;
}

// ---------- orchestrator ----------

export async function askQuestion(opts: { question: string }): Promise<AskResult> {
  const supabase = getSupabaseAdmin();
  const question = opts.question.trim();
  if (!question) throw new Error('empty question');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY');
  const client = new Anthropic({ apiKey });

  const classification = await classify(client, question);

  const insights = await loadActiveInsights();

  let out: HandlerOut;
  switch (classification.intent) {
    case 'page_diagnosis':
      out = await handlePageDiagnosis(classification, insights);
      break;
    case 'biggest_opportunities':
      out = await handleBiggestOpportunities(insights);
      break;
    case 'page_metrics':
      out = await handlePageMetrics(classification, insights);
      break;
    case 'query_performance':
      out = await handleQueryPerformance(classification, insights);
      break;
    case 'site_metrics':
      out = await handleSiteMetrics(classification);
      break;
    default:
      out = unknownOut();
  }

  // Convert-to-action suggestions: cited insights that qualify and have no action yet.
  let actionSuggestions: ActionSuggestion[] = [];
  if (out.citedInsights.length) {
    const actioned = await loadActionedInsightIds();
    actionSuggestions = out.citedInsights
      .filter((i) => isActionable(i) && !actioned.has(i.id))
      .map((i) => ({ insight_id: i.id, title: i.title, severity: i.severity, polarity: i.polarity }));
  }

  // Answer: LLM when we have data; deterministic fallback otherwise or on failure.
  let answer = out.fallbackAnswer;
  if (out.found) {
    try {
      answer = await explain(client, question, out.facts);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      console.warn(`  explainer failed: ${m} — using deterministic answer.`);
      answer = out.fallbackAnswer;
    }
  }

  const citedInsightIds = out.citedInsights.map((i) => i.id);
  const evidence: Record<string, unknown> = {
    intent: classification.intent,
    date_range: out.dateRange,
    ...out.evidence,
    cited_insight_ids: citedInsightIds,
    action_suggestions: actionSuggestions,
  };

  const { error: saveErr } = await supabase.from('questions').insert({
    workspace_id: WS,
    question,
    answer,
    evidence,
    confidence: out.confidence,
  });
  if (saveErr) throw new Error(`save question failed: ${saveErr.message}`);

  return {
    intent: classification.intent,
    found: out.found,
    answer,
    confidence: out.confidence,
    citedInsightIds,
    actionSuggestions,
    dateRange: out.dateRange,
  };
}

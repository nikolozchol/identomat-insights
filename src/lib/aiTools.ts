import Anthropic from '@anthropic-ai/sdk';
import { google } from 'googleapis';
import { getGoogleAuth } from './google';

type Supa = ReturnType<typeof import('./supabase').getSupabaseAdmin>;
export type ToolCtx = { supabase: Supa; workspaceId: string };
export type ToolTrace = { name: string; args: string; result?: string };

const SENT = { ALL: '(all)', SITE: '(site)', COUNTRY: '(country)' };

function norm(p: string): string {
  let s = (p ?? '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) { try { s = new URL(s).pathname; } catch { /* keep */ } }
  if (!s.startsWith('/')) s = '/' + s;
  return s.length > 1 ? s.replace(/\/+$/, '') : s;
}
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

async function anchorDate(ctx: ToolCtx, table: 'ga4_daily' | 'gsc_daily'): Promise<string | null> {
  const { data } = await ctx.supabase
    .from(table).select('date').eq('workspace_id', ctx.workspaceId)
    .order('date', { ascending: false }).limit(1);
  const maxDate = ((data ?? [])[0] as { date: string } | undefined)?.date ?? null;
  if (!maxDate) return null;
  const today = new Date().toISOString().slice(0, 10);
  return maxDate > today ? today : maxDate;
}
function windowFrom(anchor: string, days: number): string {
  const d = new Date(anchor + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d.toISOString().slice(0, 10);
}
const cap = <T,>(rows: T[], n: number) => rows.slice(0, n);

async function syncedBreakdown(ctx: ToolCtx, input: { dimension: 'country' | 'channel'; days?: number }) {
  const days = Math.min(Math.max(input.days ?? 28, 1), 90);
  const anchor = await anchorDate(ctx, 'ga4_daily');
  if (!anchor) return { error: 'no GA4 data synced yet' };
  const since = windowFrom(anchor, days);
  const q = ctx.supabase
    .from('ga4_daily')
    .select(input.dimension === 'country' ? 'country, sessions, conversions' : 'channel, sessions, conversions')
    .eq('workspace_id', ctx.workspaceId)
    .gte('date', since).lte('date', anchor);
  const { data } = input.dimension === 'country'
    ? await q.eq('page_path', SENT.COUNTRY).eq('channel', SENT.COUNTRY).neq('country', SENT.ALL)
    : await q.eq('page_path', SENT.SITE).eq('country', SENT.ALL).neq('channel', SENT.ALL);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const agg = new Map<string, { sessions: number; conversions: number }>();
  for (const r of rows) {
    const key = String(r[input.dimension] ?? '').trim() || '(unassigned)';
    const cur = agg.get(key) ?? { sessions: 0, conversions: 0 };
    cur.sessions += Number(r.sessions ?? 0);
    cur.conversions += Number(r.conversions ?? 0);
    agg.set(key, cur);
  }
  const total = [...agg.values()].reduce((s, v) => s + v.sessions, 0);
  const out = [...agg.entries()]
    .map(([k, v]) => ({
      [input.dimension]: k, sessions: v.sessions, conversions: v.conversions,
      conv_rate_pct: v.sessions > 0 ? r2((v.conversions / v.sessions) * 100) : 0,
      share_pct: total > 0 ? r1((v.sessions / total) * 100) : 0,
    }))
    .sort((a, b) => (b.sessions as number) - (a.sessions as number));
  return { window: `${since}..${anchor}`, rows: cap(out, 40) };
}

async function syncedDailyTrend(ctx: ToolCtx, input: { scope?: 'site' | 'country' | 'channel'; value?: string; days?: number }) {
  const days = Math.min(Math.max(input.days ?? 28, 1), 90);
  const scope = input.scope ?? 'site';
  const anchor = await anchorDate(ctx, 'ga4_daily');
  if (!anchor) return { error: 'no GA4 data synced yet' };
  const since = windowFrom(anchor, days);
  let q = ctx.supabase
    .from('ga4_daily').select('date, sessions, conversions')
    .eq('workspace_id', ctx.workspaceId)
    .gte('date', since).lte('date', anchor);
  if (scope === 'site') q = q.eq('page_path', SENT.SITE).eq('channel', SENT.ALL).eq('country', SENT.ALL);
  else if (scope === 'country') q = q.eq('page_path', SENT.COUNTRY).eq('channel', SENT.COUNTRY).eq('country', input.value ?? '');
  else q = q.eq('page_path', SENT.SITE).eq('country', SENT.ALL).eq('channel', input.value ?? '');
  const { data } = await q;
  const rows = (data ?? []) as Array<{ date: string; sessions: unknown; conversions: unknown }>;
  const byDate = new Map<string, { sessions: number; conversions: number }>();
  for (const r of rows) {
    const cur = byDate.get(r.date) ?? { sessions: 0, conversions: 0 };
    cur.sessions += Number(r.sessions ?? 0);
    cur.conversions += Number(r.conversions ?? 0);
    byDate.set(r.date, cur);
  }
  const out = [...byDate.entries()].map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date));
  if (out.length === 0) return { window: `${since}..${anchor}`, scope, value: input.value ?? null, rows: [], note: 'no rows — check the value spelling (country names/codes as stored by GA4) or use ga4_live_report' };
  return { window: `${since}..${anchor}`, scope, value: input.value ?? null, rows: out };
}

async function pagesOverview(ctx: ToolCtx, input: { days?: number; limit?: number }) {
  const days = Math.min(Math.max(input.days ?? 28, 1), 90);
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 50);
  const [ga4Res, gscRes] = [
    await ctx.supabase.rpc('ga4_page_window', { p_workspace: ctx.workspaceId, p_lookback: days }),
    await ctx.supabase.rpc('gsc_page_window', { p_workspace: ctx.workspaceId, p_lookback: days }),
  ];
  const map = new Map<string, Record<string, unknown>>();
  for (const r of ((ga4Res.data ?? []) as Array<Record<string, unknown>>)) {
    const k = norm(String(r.page_path ?? ''));
    const sess = Number(r.sessions ?? 0), eng = Number(r.engaged_sessions ?? 0);
    map.set(k, { page: k, sessions: sess, engaged_pct: sess > 0 ? r1((eng / sess) * 100) : 0, clicks: 0, impressions: 0, avg_position: null });
  }
  for (const r of ((gscRes.data ?? []) as Array<Record<string, unknown>>)) {
    const k = norm(String(r.page_path ?? ''));
    const cur = map.get(k) ?? { page: k, sessions: 0, engaged_pct: 0, clicks: 0, impressions: 0, avg_position: null };
    cur.clicks = Number(r.clicks ?? 0);
    cur.impressions = Number(r.impressions ?? 0);
    cur.avg_position = r.avg_position == null ? null : r1(Number(r.avg_position));
    map.set(k, cur);
  }
  const rows = [...map.values()].sort((a, b) => Number(b.sessions) - Number(a.sessions));
  return { lookback_days: days, rows: cap(rows, limit) };
}

async function gscQueries(ctx: ToolCtx, input: { days?: number; page_path?: string; limit?: number }) {
  const days = Math.min(Math.max(input.days ?? 28, 1), 90);
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 50);
  const anchor = await anchorDate(ctx, 'gsc_daily');
  if (!anchor) return { error: 'no GSC data synced yet' };
  const since = windowFrom(anchor, days);
  let q = ctx.supabase
    .from('gsc_daily').select('query, page_path, clicks, impressions, position')
    .eq('workspace_id', ctx.workspaceId)
    .gte('date', since).lte('date', anchor)
    .neq('query', SENT.ALL);
  if (input.page_path) q = q.eq('page_path', norm(input.page_path));
  const { data } = await q.limit(8000);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const agg = new Map<string, { clicks: number; impressions: number; posW: number }>();
  for (const r of rows) {
    const key = String(r.query ?? '').trim();
    if (!key) continue;
    const cur = agg.get(key) ?? { clicks: 0, impressions: 0, posW: 0 };
    const imp = Number(r.impressions ?? 0);
    cur.clicks += Number(r.clicks ?? 0);
    cur.impressions += imp;
    cur.posW += Number(r.position ?? 0) * imp;
    agg.set(key, cur);
  }
  const out = [...agg.entries()]
    .map(([query, v]) => ({
      query, clicks: v.clicks, impressions: v.impressions,
      avg_position: v.impressions > 0 ? r1(v.posW / v.impressions) : null,
      ctr_pct: v.impressions > 0 ? r2((v.clicks / v.impressions) * 100) : 0,
    }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
  return { window: `${since}..${anchor}`, page: input.page_path ? norm(input.page_path) : null, rows: cap(out, limit) };
}

async function clarityPages(ctx: ToolCtx, input: { days?: number; page_path?: string }) {
  const days = Math.min(Math.max(input.days ?? 28, 1), 90);
  const { data } = await ctx.supabase.rpc('clarity_page_window', { p_workspace: ctx.workspaceId, p_window: days });
  const rows = ((data ?? []) as Array<Record<string, unknown>>).filter((r) => Number(r.sessions ?? 0) > 0);
  const med = (xs: number[]) => {
    const v = xs.slice().sort((a, b) => a - b);
    if (!v.length) return 0;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };
  const baseline = {
    dead_click_pct_median: r1(med(rows.map((r) => Number(r.dead_click_pct ?? 0)))),
    rage_click_pct_median: r1(med(rows.map((r) => Number(r.rage_click_pct ?? 0)))),
    quick_back_pct_median: r1(med(rows.map((r) => Number(r.quick_back_pct ?? 0)))),
  };
  const shape = (r: Record<string, unknown>) => ({
    page: String(r.page_path ?? ''), sessions: Number(r.sessions ?? 0),
    dead_click_pct: r1(Number(r.dead_click_pct ?? 0)), rage_click_pct: r1(Number(r.rage_click_pct ?? 0)),
    quick_back_pct: r1(Number(r.quick_back_pct ?? 0)), js_error_pct: r1(Number(r.js_error_pct ?? 0)),
    avg_scroll_depth: r1(Number(r.avg_scroll_depth ?? 0)), avg_time_sec: r1(Number(r.avg_time ?? 0)),
  });
  if (input.page_path) {
    const target = norm(input.page_path);
    const hit = rows.find((r) => norm(String(r.page_path ?? '')) === target);
    return { window_days: days, baseline, page: hit ? shape(hit) : null, note: hit ? undefined : 'page not found in Clarity window' };
  }
  const sorted = rows.sort((a, b) => Number(b.sessions ?? 0) - Number(a.sessions ?? 0)).map(shape);
  return { window_days: days, baseline, rows: cap(sorted, 25) };
}

async function getInsight(ctx: ToolCtx, input: { insight_id: string }) {
  const { data } = await ctx.supabase
    .from('insights')
    .select('id, title, narrative, evidence, category, severity, polarity, detector, detected_at, page_id')
    .eq('workspace_id', ctx.workspaceId).eq('id', input.insight_id).limit(1);
  const row = ((data ?? []) as Array<Record<string, unknown>>)[0];
  return row ?? { error: 'insight not found' };
}

async function googleConfig(ctx: ToolCtx): Promise<{ propertyId?: string; siteUrl?: string }> {
  const { data } = await ctx.supabase
    .from('data_sources').select('type, config').eq('workspace_id', ctx.workspaceId);
  const rows = (data ?? []) as Array<{ type: string; config: Record<string, unknown> | null }>;
  const ga4 = rows.find((r) => r.type === 'ga4')?.config ?? {};
  const gsc = rows.find((r) => r.type === 'gsc')?.config ?? {};
  return {
    propertyId: typeof ga4.property_id === 'string' ? ga4.property_id : undefined,
    siteUrl: typeof gsc.site_url === 'string' ? gsc.site_url : undefined,
  };
}

const GA4_DIMS = ['date', 'country', 'region', 'city', 'sessionDefaultChannelGroup', 'sessionSource', 'sessionMedium', 'sessionCampaignName', 'landingPagePlusQueryString', 'pagePath', 'deviceCategory', 'hostName', 'firstUserDefaultChannelGroup'];
const GA4_METRICS = ['sessions', 'engagedSessions', 'activeUsers', 'screenPageViews', 'keyEvents', 'conversions', 'averageSessionDuration', 'engagementRate', 'bounceRate'];

async function ga4LiveReport(ctx: ToolCtx, input: {
  dimensions: string[]; metrics: string[]; start_date: string; end_date: string;
  filter?: { dimension: string; value: string; match_type?: 'EXACT' | 'CONTAINS' | 'BEGINS_WITH' };
  limit?: number;
}) {
  const { propertyId } = await googleConfig(ctx);
  if (!propertyId) return { error: 'GA4 property not configured' };
  const dims = (input.dimensions ?? []).filter((d) => GA4_DIMS.includes(d)).slice(0, 3);
  const mets = (input.metrics ?? []).filter((m) => GA4_METRICS.includes(m)).slice(0, 4);
  if (!dims.length || !mets.length) return { error: `dimensions/metrics required. Allowed dimensions: ${GA4_DIMS.join(', ')}. Allowed metrics: ${GA4_METRICS.join(', ')}` };
  const auth = getGoogleAuth();
  const analyticsdata = google.analyticsdata({ version: 'v1beta', auth });
  const body: Record<string, unknown> = {
    dateRanges: [{ startDate: input.start_date, endDate: input.end_date }],
    dimensions: dims.map((name) => ({ name })),
    metrics: mets.map((name) => ({ name })),
    limit: String(Math.min(Math.max(input.limit ?? 25, 1), 50)),
  };
  if (input.filter?.dimension && input.filter?.value) {
    body.dimensionFilter = {
      filter: {
        fieldName: input.filter.dimension,
        stringFilter: { value: input.filter.value, matchType: input.filter.match_type ?? 'EXACT', caseSensitive: false },
      },
    };
  }
  const res = await analyticsdata.properties.runReport({ property: `properties/${propertyId}`, requestBody: body });
  const dimHeaders = (res.data.dimensionHeaders ?? []).map((h) => h.name ?? '');
  const metHeaders = (res.data.metricHeaders ?? []).map((h) => h.name ?? '');
  const rows = (res.data.rows ?? []).map((row) => {
    const o: Record<string, unknown> = {};
    (row.dimensionValues ?? []).forEach((v, i) => { o[dimHeaders[i]] = v.value; });
    (row.metricValues ?? []).forEach((v, i) => { o[metHeaders[i]] = Number(v.value); });
    return o;
  });
  return { source: 'GA4 live', date_range: `${input.start_date}..${input.end_date}`, row_count: rows.length, rows };
}

const GSC_DIMS = ['date', 'query', 'page', 'country', 'device'];

async function gscLiveQuery(ctx: ToolCtx, input: {
  dimensions: string[]; start_date: string; end_date: string;
  filter?: { dimension: string; expression: string; operator?: 'equals' | 'contains' };
  row_limit?: number;
}) {
  const { siteUrl } = await googleConfig(ctx);
  if (!siteUrl) return { error: 'GSC site not configured' };
  const dims = (input.dimensions ?? []).filter((d) => GSC_DIMS.includes(d)).slice(0, 3);
  if (!dims.length) return { error: `dimensions required. Allowed: ${GSC_DIMS.join(', ')}` };
  const auth = getGoogleAuth();
  const sc = google.searchconsole({ version: 'v1', auth });
  const requestBody: Record<string, unknown> = {
    startDate: input.start_date, endDate: input.end_date,
    dimensions: dims, rowLimit: Math.min(Math.max(input.row_limit ?? 25, 1), 100),
  };
  if (input.filter?.dimension && input.filter?.expression) {
    requestBody.dimensionFilterGroups = [{
      filters: [{ dimension: input.filter.dimension, operator: input.filter.operator ?? 'equals', expression: input.filter.expression }],
    }];
  }
  const res = await sc.searchanalytics.query({ siteUrl, requestBody });
  const rows = (res.data.rows ?? []).map((r) => {
    const o: Record<string, unknown> = {};
    (r.keys ?? []).forEach((k, i) => { o[dims[i]] = k; });
    o.clicks = r.clicks ?? 0; o.impressions = r.impressions ?? 0;
    o.ctr_pct = r2(((r.ctr ?? 0) as number) * 100); o.position = r1((r.position ?? 0) as number);
    return o;
  });
  return { source: 'GSC live', date_range: `${input.start_date}..${input.end_date}`, row_count: rows.length, rows };
}

export const CHAT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'synced_breakdown',
    description: 'Sessions, conversions (demo requests), conversion rate and share by country or by channel from synced GA4 data. Fast. Window anchors on the latest synced day.',
    input_schema: { type: 'object', properties: { dimension: { type: 'string', enum: ['country', 'channel'] }, days: { type: 'integer', minimum: 1, maximum: 90 } }, required: ['dimension'] },
  },
  {
    name: 'synced_daily_trend',
    description: 'Daily sessions and conversions time series from synced GA4 data — for the whole site, one country, or one channel. Use to locate spikes/drops by date.',
    input_schema: { type: 'object', properties: { scope: { type: 'string', enum: ['site', 'country', 'channel'] }, value: { type: 'string', description: 'country or channel name exactly as GA4 stores it (required unless scope=site)' }, days: { type: 'integer', minimum: 1, maximum: 90 } }, required: [] },
  },
  {
    name: 'pages_overview',
    description: 'Per-page GA4 sessions/engagement merged with GSC clicks/impressions/avg position, from synced data.',
    input_schema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 90 }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, required: [] },
  },
  {
    name: 'gsc_queries',
    description: 'Top search queries (clicks, impressions, avg position, CTR) from synced Search Console data; optionally for one page.',
    input_schema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 90 }, page_path: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, required: [] },
  },
  {
    name: 'clarity_pages',
    description: 'Behavioral friction per page from synced Microsoft Clarity: dead/rage/quick-back click rates, JS errors, scroll depth, time — with site medians as baseline. Optionally one page.',
    input_schema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 90 }, page_path: { type: 'string' } }, required: [] },
  },
  {
    name: 'get_insight',
    description: 'Fetch a platform insight by id (title, narrative, evidence, detector, severity).',
    input_schema: { type: 'object', properties: { insight_id: { type: 'string' } }, required: ['insight_id'] },
  },
  {
    name: 'ga4_live_report',
    description: 'Run a live Google Analytics 4 report for any allowed dimension/metric combination — use when synced data lacks the needed dimension (traffic source/medium, campaign, city, device, hostname, or joint breakdowns like country x channel). Dates: YYYY-MM-DD or NdaysAgo/yesterday/today.',
    input_schema: {
      type: 'object',
      properties: {
        dimensions: { type: 'array', items: { type: 'string', enum: GA4_DIMS }, maxItems: 3 },
        metrics: { type: 'array', items: { type: 'string', enum: GA4_METRICS }, maxItems: 4 },
        start_date: { type: 'string' }, end_date: { type: 'string' },
        filter: { type: 'object', properties: { dimension: { type: 'string' }, value: { type: 'string' }, match_type: { type: 'string', enum: ['EXACT', 'CONTAINS', 'BEGINS_WITH'] } }, required: ['dimension', 'value'] },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      required: ['dimensions', 'metrics', 'start_date', 'end_date'],
    },
  },
  {
    name: 'gsc_live_query',
    description: 'Run a live Google Search Console query (clicks, impressions, CTR, position) by date/query/page/country/device, with optional filter. Use for search data beyond the synced window or finer slices.',
    input_schema: {
      type: 'object',
      properties: {
        dimensions: { type: 'array', items: { type: 'string', enum: GSC_DIMS }, maxItems: 3 },
        start_date: { type: 'string' }, end_date: { type: 'string' },
        filter: { type: 'object', properties: { dimension: { type: 'string' }, expression: { type: 'string' }, operator: { type: 'string', enum: ['equals', 'contains'] } }, required: ['dimension', 'expression'] },
        row_limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      required: ['dimensions', 'start_date', 'end_date'],
    },
  },
];

export async function runChatTool(ctx: ToolCtx, name: string, input: unknown): Promise<string> {
  const i = (input ?? {}) as Record<string, unknown>;
  let out: unknown;
  switch (name) {
    case 'synced_breakdown': out = await syncedBreakdown(ctx, i as Parameters<typeof syncedBreakdown>[1]); break;
    case 'synced_daily_trend': out = await syncedDailyTrend(ctx, i as Parameters<typeof syncedDailyTrend>[1]); break;
    case 'pages_overview': out = await pagesOverview(ctx, i as Parameters<typeof pagesOverview>[1]); break;
    case 'gsc_queries': out = await gscQueries(ctx, i as Parameters<typeof gscQueries>[1]); break;
    case 'clarity_pages': out = await clarityPages(ctx, i as Parameters<typeof clarityPages>[1]); break;
    case 'get_insight': out = await getInsight(ctx, i as Parameters<typeof getInsight>[1]); break;
    case 'ga4_live_report': out = await ga4LiveReport(ctx, i as Parameters<typeof ga4LiveReport>[1]); break;
    case 'gsc_live_query': out = await gscLiveQuery(ctx, i as Parameters<typeof gscLiveQuery>[1]); break;
    default: out = { error: `unknown tool: ${name}` };
  }
  const s = JSON.stringify(out);
  return s.length > 14000 ? s.slice(0, 14000) + '…(truncated)' : s;
}

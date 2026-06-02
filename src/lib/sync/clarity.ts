import { getSupabaseAdmin } from '../supabase';

const API = 'https://www.clarity.ms/export-data/api/v1/project-live-insights';

// Only keep production identomat.com pages; drop the Webflow staging subdomain,
// any other host, and the /admin area.
const ALLOWED_HOSTS = new Set(['www.identomat.com', 'identomat.com']);

type ClarityRow = Record<string, unknown>;
type ClarityMetric = { metricName: string; information: ClarityRow[] };

// Returns the normalized path to store, or null if the URL should be skipped.
function pathFor(rawUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!ALLOWED_HOSTS.has(u.hostname.toLowerCase())) return null; // drop webflow.io etc.
  let p = u.pathname || '/'; // pathname excludes query, so ?r=0 variants fold into the base path
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  if (p === '/admin' || p.startsWith('/admin/')) return null; // drop admin area
  return p;
}
function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
}

type Rec = {
  sessions: number;
  scroll_depth: number | null;
  avg_time: number | null;
  dead_clicks: number; rage_clicks: number; quick_backs: number; js_errors: number;
  dead_click_pct: number | null; rage_click_pct: number | null; quick_back_pct: number | null; js_error_pct: number | null;
};

export async function syncClarity(opts: {
  workspaceId: string; numOfDays?: number; date?: string;
}): Promise<{ rows: number }> {
  const token = process.env.CLARITY_API_TOKEN;
  const projectId = process.env.CLARITY_PROJECT_ID;
  if (!token) throw new Error('Missing CLARITY_API_TOKEN');
  const numOfDays = opts.numOfDays ?? 1;
  const date = opts.date ?? new Date().toISOString().slice(0, 10);

  const url =
    `${API}?numOfDays=${numOfDays}&dimension1=URL` +
    (projectId ? `&projectId=${encodeURIComponent(projectId)}` : '');
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Clarity API ${res.status}: ${body.slice(0, 300)}`);
  }
  const metrics = (await res.json()) as ClarityMetric[];
  const byName = new Map<string, ClarityRow[]>();
  for (const m of metrics) byName.set(m.metricName, m.information || []);

  const recs = new Map<string, Rec>();
  const ensure = (p: string): Rec => {
    let r = recs.get(p);
    if (!r) {
      r = {
        sessions: 0, scroll_depth: null, avg_time: null,
        dead_clicks: 0, rage_clicks: 0, quick_backs: 0, js_errors: 0,
        dead_click_pct: null, rage_click_pct: null, quick_back_pct: null, js_error_pct: null,
      };
      recs.set(p, r);
    }
    return r;
  };

  for (const row of byName.get('DeadClickCount') || []) {
    const p = pathFor(String(row['Url'] ?? ''));
    if (!p) continue;
    const r = ensure(p);
    r.dead_clicks = num(row['subTotal']);
    r.dead_click_pct = num(row['sessionsWithMetricPercentage']);
    r.sessions = Math.max(r.sessions, num(row['sessionsCount']));
  }
  for (const row of byName.get('RageClickCount') || []) {
    const p = pathFor(String(row['Url'] ?? ''));
    if (!p) continue;
    const r = ensure(p);
    r.rage_clicks = num(row['subTotal']);
    r.rage_click_pct = num(row['sessionsWithMetricPercentage']);
    r.sessions = Math.max(r.sessions, num(row['sessionsCount']));
  }
  for (const row of byName.get('QuickbackClick') || []) {
    const p = pathFor(String(row['Url'] ?? ''));
    if (!p) continue;
    const r = ensure(p);
    r.quick_backs = num(row['subTotal']);
    r.quick_back_pct = num(row['sessionsWithMetricPercentage']);
    r.sessions = Math.max(r.sessions, num(row['sessionsCount']));
  }
  for (const row of byName.get('ScriptErrorCount') || []) {
    const p = pathFor(String(row['Url'] ?? ''));
    if (!p) continue;
    const r = ensure(p);
    r.js_errors = num(row['subTotal']);
    r.js_error_pct = num(row['sessionsWithMetricPercentage']);
    r.sessions = Math.max(r.sessions, num(row['sessionsCount']));
  }
  for (const row of byName.get('ScrollDepth') || []) {
    const p = pathFor(String(row['Url'] ?? ''));
    if (!p) continue;
    ensure(p).scroll_depth = num(row['averageScrollDepth']);
  }
  for (const row of byName.get('EngagementTime') || []) {
    const p = pathFor(String(row['Url'] ?? ''));
    if (!p) continue;
    ensure(p).avg_time = num(row['activeTime']);
  }

  const supabase = getSupabaseAdmin();
  const payload = Array.from(recs.entries()).map(([page_path, r]) => ({
    workspace_id: opts.workspaceId, date, page_path, device: '(all)',
    sessions: Math.round(r.sessions),
    scroll_depth: r.scroll_depth, avg_time: r.avg_time,
    dead_clicks: Math.round(r.dead_clicks), rage_clicks: Math.round(r.rage_clicks),
    quick_backs: Math.round(r.quick_backs), js_errors: Math.round(r.js_errors),
    rage_click_pct: r.rage_click_pct, dead_click_pct: r.dead_click_pct,
    quick_back_pct: r.quick_back_pct, js_error_pct: r.js_error_pct,
  }));

  let written = 0;
  const BATCH = 500;
  for (let i = 0; i < payload.length; i += BATCH) {
    const batch = payload.slice(i, i + BATCH);
    const { error } = await supabase
      .from('clarity_daily')
      .upsert(batch, { onConflict: 'workspace_id,date,page_path,device' });
    if (error) throw new Error(`clarity_daily upsert failed: ${error.message}`);
    written += batch.length;
  }
  return { rows: written };
}

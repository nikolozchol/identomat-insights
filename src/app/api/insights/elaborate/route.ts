import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MODEL = 'claude-haiku-4-5-20251001';

function norm(p: string): string {
  let s = (p ?? '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) { try { s = new URL(s).pathname; } catch { /* keep */ } }
  if (!s.startsWith('/')) s = '/' + s;
  return s.length > 1 ? s.replace(/\/+$/, '') : s;
}
function median(xs: number[]): number {
  const v = xs.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

type Insight = {
  id: string; title: string; narrative: string | null; evidence: Record<string, unknown> | null;
  category: string; polarity: string | null; severity: string; detector: string; page_id: string | null;
};
type Row = Record<string, unknown>;

export async function POST(req: Request) {
  let insightId: string | undefined;
  try {
    const b = (await req.json()) as { insightId?: unknown };
    if (typeof b.insightId === 'string') insightId = b.insightId;
  } catch {
    /* invalid body */
  }
  if (!insightId) return NextResponse.json({ error: 'insightId is required' }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: wsData } = await supabase.from('workspaces').select('id').limit(1);
  const workspaceId = (wsData ?? [])[0]?.id as string | undefined;
  if (!workspaceId) return NextResponse.json({ error: 'no workspace' }, { status: 500 });

  const { data: insRows } = await supabase
    .from('insights')
    .select('id, title, narrative, evidence, category, polarity, severity, detector, page_id')
    .eq('workspace_id', workspaceId)
    .eq('id', insightId)
    .limit(1);
  const insight = ((insRows ?? []) as Insight[])[0];
  if (!insight) return NextResponse.json({ error: 'insight not found' }, { status: 404 });

  const { data: actRows } = await supabase
    .from('actions')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('insight_id', insightId)
    .limit(1);
  const actioned = ((actRows ?? []) as unknown[]).length > 0;

  const ev = insight.evidence ?? {};
  let pagePath = '';
  for (const k of ['page_path', 'page', 'url', 'path']) {
    const val = ev[k];
    if (typeof val === 'string' && val.trim()) { pagePath = norm(val); break; }
  }

  const cat = insight.category;
  const needGsc = ['seo', 'content', 'channels', 'traffic'].includes(cat);
  const needGa4 = ['traffic', 'channels', 'conversion', 'content'].includes(cat);
  const needClarity = ['ux', 'conversion'].includes(cat);

  let ga4: Row | null = null, gsc: Row | null = null, clarity: Row | null = null;
  let clarityBaseline: { dead: number; rage: number; quick: number } | null = null;

  const find = (rows: unknown): Row | null =>
    ((rows ?? []) as Row[]).find((r) => norm(String(r.page_path ?? '')) === pagePath) ?? null;

  if (pagePath) {
    try {
      if (needGa4) { const { data } = await supabase.rpc('ga4_page_window', { p_workspace: workspaceId, p_lookback: 28 }); ga4 = find(data); }
      if (needGsc) { const { data } = await supabase.rpc('gsc_page_window', { p_workspace: workspaceId, p_lookback: 28 }); gsc = find(data); }
      if (needClarity) {
        const { data } = await supabase.rpc('clarity_page_window', { p_workspace: workspaceId, p_window: 28 });
        clarity = find(data);
        const rows = ((data ?? []) as Row[]).filter((r) => Number(r.sessions ?? 0) > 0);
        if (rows.length) {
          clarityBaseline = {
            dead: median(rows.map((r) => Number(r.dead_click_pct ?? 0))),
            rage: median(rows.map((r) => Number(r.rage_click_pct ?? 0))),
            quick: median(rows.map((r) => Number(r.quick_back_pct ?? 0))),
          };
        }
      }
    } catch {
      /* enrichment is best-effort; fall back to evidence only */
    }
  }

  const metrics: { label: string; value: string }[] = [];
  const pct = (n: unknown) => `${Number(n ?? 0).toFixed(0)}%`;
  if (gsc) {
    if (gsc.avg_position != null) metrics.push({ label: 'Avg position', value: Number(gsc.avg_position).toFixed(1) });
    metrics.push({ label: 'Clicks (28d)', value: Number(gsc.clicks ?? 0).toLocaleString() });
    metrics.push({ label: 'Impressions', value: Number(gsc.impressions ?? 0).toLocaleString() });
    const imp = Number(gsc.impressions ?? 0), clk = Number(gsc.clicks ?? 0);
    if (imp > 0) metrics.push({ label: 'CTR', value: `${((clk / imp) * 100).toFixed(1)}%` });
  }
  if (ga4) {
    metrics.push({ label: 'Sessions (28d)', value: Number(ga4.sessions ?? 0).toLocaleString() });
    const s = Number(ga4.sessions ?? 0), e = Number(ga4.engaged_sessions ?? 0);
    if (s > 0) metrics.push({ label: 'Engaged', value: `${((e / s) * 100).toFixed(0)}%` });
  }
  if (clarity) {
    metrics.push({ label: 'Dead clicks', value: clarityBaseline ? `${pct(clarity.dead_click_pct)} · median ${pct(clarityBaseline.dead)}` : pct(clarity.dead_click_pct) });
    metrics.push({ label: 'Rage clicks', value: clarityBaseline ? `${pct(clarity.rage_click_pct)} · median ${pct(clarityBaseline.rage)}` : pct(clarity.rage_click_pct) });
    metrics.push({ label: 'Quick-back', value: pct(clarity.quick_back_pct) });
    metrics.push({ label: 'Sessions', value: Number(clarity.sessions ?? 0).toLocaleString() });
  }

  const facts = {
    insight: { title: insight.title, narrative: insight.narrative, category: cat, polarity: insight.polarity, severity: insight.severity, detector: insight.detector },
    evidence: ev,
    page: pagePath || null,
    page_metrics: { ga4, gsc, clarity, clarity_site_median: clarityBaseline },
  };

  const system = [
    'You are a marketing-analytics assistant inside an internal dashboard.',
    'You are given COMPUTED metrics for ONE insight about a website funnel. Audience: a B2B identity-verification company whose key conversion is demo requests.',
    'Write a concise, practical deep-dive that helps the team decide what to do.',
    'STRICT RULES:',
    '- Use ONLY the numbers provided. Never invent, estimate, or assume any figure that is not present.',
    '- Treat PAGES as ranking for QUERIES, never the reverse: a page ranks for a query; a query does not "rank" or "climb".',
    '- Keep every item to one clear sentence; be specific and concrete.',
    'Return ONLY a JSON object (no prose, no markdown, no code fences) with exactly these keys:',
    '{"data_shows": string[], "likely_drivers": string[], "suggestions": string[]}',
    '- data_shows: 2-4 statements of what the numbers indicate, citing the actual figures provided.',
    '- likely_drivers: 1-3 plausible explanations the data supports, phrased as possibilities to verify (use "may"/"likely"); never assert as fact.',
    '- suggestions: 2-4 concrete next steps to try or verify; these are recommendations, not guarantees.',
  ].join('\n');

  let sections: { data_shows: string[]; likely_drivers: string[]; suggestions: string[] } | null = null;
  let note = '';
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 700,
      system,
      messages: [{ role: 'user', content: 'Insight data (JSON):\n' + JSON.stringify(facts) }],
    });
    const raw = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
    note = raw;
    const clean = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
    const a = clean.indexOf('{'), z = clean.lastIndexOf('}');
    const parsed = JSON.parse(a >= 0 && z >= 0 ? clean.slice(a, z + 1) : clean) as {
      data_shows?: unknown; likely_drivers?: unknown; suggestions?: unknown;
    };
    const arr = (x: unknown, n: number): string[] => (Array.isArray(x) ? x.map((v) => String(v)).filter(Boolean).slice(0, n) : []);
    sections = {
      data_shows: arr(parsed.data_shows, 5),
      likely_drivers: arr(parsed.likely_drivers, 4),
      suggestions: arr(parsed.suggestions, 5),
    };
  } catch {
    return NextResponse.json({ ok: true, metrics, actioned, sections: null, note: note || 'Could not generate a deep dive right now — please try again.' });
  }

  return NextResponse.json({ ok: true, metrics, actioned, sections });
}

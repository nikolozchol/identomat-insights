import { getSupabaseAdmin } from '../../lib/supabase';
import { PagesTable, type PageRow, type PageClarity, type PageInsight } from '../../components/pages/PagesTable';

export const revalidate = 60;

function norm(p: string): string {
  let s = (p ?? '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) { try { s = new URL(s).pathname; } catch { /* keep */ } }
  if (!s.startsWith('/')) s = '/' + s;
  return s.length > 1 ? s.replace(/\/+$/, '') : s;
}

export default async function PagesPage() {
  const supabase = getSupabaseAdmin();

  const { data: wsData } = await supabase.from('workspaces').select('id').limit(1);
  const workspaceId = (wsData ?? [])[0]?.id as string | undefined;
  if (!workspaceId) {
    return <div className="p-10 text-[14px] text-fg-2">No workspace found.</div>;
  }
  const nowIso = new Date().toISOString();

  const [{ data: ga4 }, { data: gsc }, { data: clarity }, { data: insRows }] = await Promise.all([
    supabase.rpc('ga4_page_window', { p_workspace: workspaceId, p_lookback: 28 }),
    supabase.rpc('gsc_page_window', { p_workspace: workspaceId, p_lookback: 28 }),
    supabase.rpc('clarity_page_window', { p_workspace: workspaceId, p_window: 28 }),
    supabase
      .from('insights')
      .select('id, severity, polarity, category, detector, title, narrative, evidence, page_id')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .is('dismissed_at', null)
      .or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`),
  ]);

  const { data: actData } = await supabase.from('actions').select('insight_id').eq('workspace_id', workspaceId);
  const actionedInsightIds = ((actData ?? []) as Array<{ insight_id: string | null }>)
    .map((a) => a.insight_id)
    .filter((x): x is string => !!x);

  const clarityByPath = new Map<string, PageClarity>();
  for (const c of (clarity ?? []) as Array<Record<string, unknown>>) {
    const path = norm(String(c.page_path ?? ''));
    if (!path) continue;
    clarityByPath.set(path, {
      sessions: Number(c.sessions ?? 0),
      ragePct: Number(c.rage_click_pct ?? 0),
      deadPct: Number(c.dead_click_pct ?? 0),
      quickBackPct: Number(c.quick_back_pct ?? 0),
      jsErrorPct: Number(c.js_error_pct ?? 0),
      scrollDepth: Number(c.avg_scroll_depth ?? 0),
      avgTime: Number(c.avg_time ?? 0),
    });
  }

  const insByPath = new Map<string, PageInsight[]>();
  for (const r of (insRows ?? []) as Array<{
    id: string; severity: string; polarity: string | null; title: string; narrative: string | null; evidence: Record<string, unknown> | null;
  }>) {
    const ev = r.evidence ?? {};
    let path = '';
    for (const k of ['page_path', 'page', 'url', 'path']) {
      const v = ev[k];
      if (typeof v === 'string' && v.trim()) { path = norm(v); break; }
    }
    if (!path) continue;
    const arr = insByPath.get(path) ?? [];
    arr.push({ id: r.id, severity: r.severity, polarity: r.polarity ?? 'issue', title: r.title, narrative: r.narrative });
    insByPath.set(path, arr);
  }

  const map = new Map<string, PageRow>();
  for (const r of (ga4 ?? []) as Array<{ page_path: string; sessions: unknown; engaged_sessions: unknown }>) {
    const np = norm(r.page_path);
    const sessions = Number(r.sessions ?? 0);
    const engaged = Number(r.engaged_sessions ?? 0);
    map.set(np, {
      page_path: r.page_path,
      sessions,
      engagedPct: sessions > 0 ? (engaged / sessions) * 100 : 0,
      clicks: 0,
      impressions: 0,
      avgPosition: null,
      clarity: clarityByPath.get(np) ?? null,
      insights: insByPath.get(np) ?? [],
    });
  }
  for (const r of (gsc ?? []) as Array<{ page_path: string; clicks: unknown; impressions: unknown; avg_position: unknown }>) {
    const np = norm(r.page_path);
    const cur = map.get(np) ?? {
      page_path: r.page_path, sessions: 0, engagedPct: 0, clicks: 0, impressions: 0, avgPosition: null,
      clarity: clarityByPath.get(np) ?? null, insights: insByPath.get(np) ?? [],
    };
    cur.clicks = Number(r.clicks ?? 0);
    cur.impressions = Number(r.impressions ?? 0);
    cur.avgPosition = r.avg_position == null ? null : Number(r.avg_position);
    map.set(np, cur);
  }

  const pages = [...map.values()].sort((a, b) => b.sessions - a.sessions);

  const { data: hiddenData } = await supabase.rpc('excluded_page_paths', { p_workspace: workspaceId });
  const hiddenPaths = ((hiddenData ?? []) as Array<{ page_path: string }>).map((r) => r.page_path);

  return <PagesTable pages={pages} actionedInsightIds={actionedInsightIds} hiddenPaths={hiddenPaths} />;
}

import { getSupabaseAdmin } from '../supabase';
import { writeInsights, InsightInsert, DetectorResult } from './util';

type Row = {
  page_path: string; sessions: number | string;
  rage_click_pct: number | string; dead_click_pct: number | string;
  quick_back_pct: number | string; js_error_pct: number | string;
  avg_scroll_depth: number | string; avg_time: number | string;
};

export async function detectDeadClicksOnStatic(opts: {
  workspaceId: string; windowDays?: number; minSessions?: number; pctThreshold?: number;
}): Promise<DetectorResult> {
  const supabase = getSupabaseAdmin();
  const windowDays = opts.windowDays ?? 28;
  const minSessions = opts.minSessions ?? 20;
  const pctThreshold = opts.pctThreshold ?? 10;

  const { data, error } = await supabase.rpc('clarity_page_window', { p_workspace: opts.workspaceId, p_window: windowDays });
  if (error) throw new Error(`clarity_page_window RPC failed: ${error.message}`);

  const rows: InsightInsert[] = [];
  for (const r of (data ?? []) as Row[]) {
    const sessions = Number(r.sessions);
    const pct = Number(r.dead_click_pct);
    if (sessions < minSessions || pct < pctThreshold) continue;
    const severity = pct >= 25 ? 'high' : pct >= 15 ? 'medium' : 'low';
    rows.push({
      workspace_id: opts.workspaceId,
      detector: 'dead_clicks_on_static',
      category: 'ux',
      severity,
      polarity: 'issue',
      title: `${pct.toFixed(1)}% of sessions had dead clicks on ${r.page_path}`,
      evidence: { page_path: r.page_path, dead_click_pct: pct, sessions, window_days: windowDays },
      sources: ['Clarity'],
      dedupe_key: `dead_clicks_on_static:${r.page_path}`,
    });
  }
  return writeInsights({ workspaceId: opts.workspaceId, detector: 'dead_clicks_on_static', rows });
}

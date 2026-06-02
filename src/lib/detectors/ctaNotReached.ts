import { getSupabaseAdmin } from '../supabase';
import { writeInsights, InsightInsert, DetectorResult } from './util';

type Row = {
  page_path: string; sessions: number | string;
  rage_click_pct: number | string; dead_click_pct: number | string;
  quick_back_pct: number | string; js_error_pct: number | string;
  avg_scroll_depth: number | string; avg_time: number | string;
};

export async function detectCtaNotReached(opts: {
  workspaceId: string; windowDays?: number; minSessions?: number; scrollThreshold?: number;
}): Promise<DetectorResult> {
  const supabase = getSupabaseAdmin();
  const windowDays = opts.windowDays ?? 28;
  const minSessions = opts.minSessions ?? 20;
  const scrollThreshold = opts.scrollThreshold ?? 50;

  const { data, error } = await supabase.rpc('clarity_page_window', { p_workspace: opts.workspaceId, p_window: windowDays });
  if (error) throw new Error(`clarity_page_window RPC failed: ${error.message}`);

  const rows: InsightInsert[] = [];
  for (const r of (data ?? []) as Row[]) {
    const sessions = Number(r.sessions);
    const scroll = Number(r.avg_scroll_depth);
    if (sessions < minSessions || scroll <= 0 || scroll >= scrollThreshold) continue;
    const severity = scroll < 30 ? 'high' : scroll < 40 ? 'medium' : 'low';
    rows.push({
      workspace_id: opts.workspaceId,
      detector: 'cta_not_reached',
      category: 'ux',
      severity,
      polarity: 'issue',
      title: `Visitors only scroll ${scroll.toFixed(0)}% down ${r.page_path} on average`,
      evidence: { page_path: r.page_path, avg_scroll_depth: scroll, sessions, window_days: windowDays },
      sources: ['Clarity'],
      dedupe_key: `cta_not_reached:${r.page_path}`,
    });
  }
  return writeInsights({ workspaceId: opts.workspaceId, detector: 'cta_not_reached', rows });
}

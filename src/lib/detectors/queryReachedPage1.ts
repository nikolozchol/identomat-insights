import { getSupabaseAdmin } from '../supabase';
import { writeInsights, InsightInsert, DetectorResult } from './util';

type QWow = {
  query: string;
  recent_impr: number | string; prior_impr: number | string;
  recent_clicks: number | string; prior_clicks: number | string;
  recent_position: number | string | null; prior_position: number | string | null;
};

export async function detectQueryReachedPage1(opts: {
  workspaceId: string; windowDays?: number; minImpressions?: number;
}): Promise<DetectorResult> {
  const supabase = getSupabaseAdmin();
  const windowDays = opts.windowDays ?? 28;
  const minImpr = opts.minImpressions ?? 50;

  const { data, error } = await supabase.rpc('gsc_query_wow', { p_workspace: opts.workspaceId, p_window: windowDays });
  if (error) throw new Error(`gsc_query_wow RPC failed: ${error.message}`);

  const wow = (data ?? []) as QWow[];
  const rows: InsightInsert[] = [];
  for (const w of wow) {
    if (w.recent_position == null || w.prior_position == null) continue;
    const recentPos = Number(w.recent_position);
    const priorPos = Number(w.prior_position);
    const recentImpr = Number(w.recent_impr);
    if (recentImpr < minImpr) continue;
    if (!(priorPos > 10 && recentPos <= 10)) continue; // crossed onto page 1
    const severity = recentImpr >= 500 ? 'high' : recentImpr >= 150 ? 'medium' : 'low';
    rows.push({
      workspace_id: opts.workspaceId,
      detector: 'query_reached_page_1',
      category: 'seo',
      severity,
      polarity: 'win',
      title: `"${w.query}" climbed to page 1 (now position ${recentPos.toFixed(1)})`,
      evidence: {
        query: w.query, recent_position: recentPos, prior_position: priorPos,
        recent_impressions: recentImpr, recent_clicks: Number(w.recent_clicks), prior_clicks: Number(w.prior_clicks),
        window_days: windowDays,
      },
      sources: ['Search Console'],
      dedupe_key: `query_reached_page_1:${w.query}`,
    });
  }
  return writeInsights({ workspaceId: opts.workspaceId, detector: 'query_reached_page_1', rows });
}

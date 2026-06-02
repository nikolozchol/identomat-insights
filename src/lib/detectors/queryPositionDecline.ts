import { getSupabaseAdmin } from '../supabase';
import { writeInsights, InsightInsert, DetectorResult } from './util';

type QWow = {
  query: string;
  recent_impr: number | string; prior_impr: number | string;
  recent_clicks: number | string; prior_clicks: number | string;
  recent_position: number | string | null; prior_position: number | string | null;
};

export async function detectQueryPositionDecline(opts: {
  workspaceId: string; windowDays?: number; minImpressions?: number; minDrop?: number;
}): Promise<DetectorResult> {
  const supabase = getSupabaseAdmin();
  const windowDays = opts.windowDays ?? 28;
  const minImpr = opts.minImpressions ?? 50;
  const minDrop = opts.minDrop ?? 3;

  const { data, error } = await supabase.rpc('gsc_query_wow', { p_workspace: opts.workspaceId, p_window: windowDays });
  if (error) throw new Error(`gsc_query_wow RPC failed: ${error.message}`);

  const wow = (data ?? []) as QWow[];
  const rows: InsightInsert[] = [];
  for (const w of wow) {
    if (w.recent_position == null || w.prior_position == null) continue;
    const recentPos = Number(w.recent_position);
    const priorPos = Number(w.prior_position);
    const recentImpr = Number(w.recent_impr);
    const priorImpr = Number(w.prior_impr);
    if (recentImpr < minImpr || priorImpr < minImpr) continue;
    if (priorPos > 20) continue; // only previously well-ranked queries
    const drop = recentPos - priorPos; // positive = worse rank
    if (drop < minDrop) continue;
    const severity = recentImpr >= 500 && drop >= 5 ? 'high' : recentImpr >= 150 ? 'medium' : 'low';
    rows.push({
      workspace_id: opts.workspaceId,
      detector: 'query_position_decline',
      category: 'seo',
      severity,
      polarity: 'issue',
      title: `"${w.query}" dropped from position ${priorPos.toFixed(1)} to ${recentPos.toFixed(1)}`,
      evidence: {
        query: w.query, recent_position: recentPos, prior_position: priorPos, drop: Number(drop.toFixed(1)),
        recent_impressions: recentImpr, prior_impressions: priorImpr,
        recent_clicks: Number(w.recent_clicks), prior_clicks: Number(w.prior_clicks), window_days: windowDays,
      },
      sources: ['Search Console'],
      dedupe_key: `query_position_decline:${w.query}`,
    });
  }
  return writeInsights({ workspaceId: opts.workspaceId, detector: 'query_position_decline', rows });
}

import { getSupabaseAdmin } from '../supabase';
import { writeInsights, InsightInsert, DetectorResult } from './util';

type PWow = {
  page_path: string;
  recent_clicks: number | string; prior_clicks: number | string;
  recent_impr: number | string; prior_impr: number | string;
  clicks_pct_change: number | string | null;
};

export async function detectPageClicksLost(opts: {
  workspaceId: string; windowDays?: number; minPriorClicks?: number; dropThreshold?: number;
}): Promise<DetectorResult> {
  const supabase = getSupabaseAdmin();
  const windowDays = opts.windowDays ?? 28;
  const minPrior = opts.minPriorClicks ?? 30;
  const dropThreshold = opts.dropThreshold ?? 0.3;

  const { data, error } = await supabase.rpc('gsc_page_wow', { p_workspace: opts.workspaceId, p_window: windowDays });
  if (error) throw new Error(`gsc_page_wow RPC failed: ${error.message}`);

  const wow = (data ?? []) as PWow[];
  const rows: InsightInsert[] = [];
  for (const w of wow) {
    if (w.clicks_pct_change == null) continue;
    const prior = Number(w.prior_clicks);
    const recent = Number(w.recent_clicks);
    const pct = Number(w.clicks_pct_change);
    if (prior < minPrior || pct > -dropThreshold) continue;
    const dropPct = Math.round(Math.abs(pct) * 100);
    const severity = prior >= 200 && dropPct >= 50 ? 'high' : prior >= 80 ? 'medium' : 'low';
    rows.push({
      workspace_id: opts.workspaceId,
      detector: 'page_clicks_lost',
      category: 'seo',
      severity,
      polarity: 'issue',
      title: `${w.page_path} lost ${dropPct}% of its search clicks`,
      evidence: {
        page_path: w.page_path, recent_clicks: recent, prior_clicks: prior, drop_pct: dropPct,
        recent_impressions: Number(w.recent_impr), prior_impressions: Number(w.prior_impr), window_days: windowDays,
      },
      sources: ['Search Console'],
      dedupe_key: `page_clicks_lost:${w.page_path}`,
    });
  }
  return writeInsights({ workspaceId: opts.workspaceId, detector: 'page_clicks_lost', rows });
}

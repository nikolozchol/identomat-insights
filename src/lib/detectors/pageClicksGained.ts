import { getSupabaseAdmin } from '../supabase';
import { writeInsights, InsightInsert, DetectorResult } from './util';

type PWow = {
  page_path: string;
  recent_clicks: number | string; prior_clicks: number | string;
  recent_impr: number | string; prior_impr: number | string;
  clicks_pct_change: number | string | null;
};

function sev(recent: number): 'high' | 'medium' | 'low' {
  return recent >= 200 ? 'high' : recent >= 80 ? 'medium' : 'low';
}

export async function detectPageClicksGained(opts: {
  workspaceId: string; windowDays?: number; minRecentClicks?: number; gainThreshold?: number;
}): Promise<DetectorResult> {
  const supabase = getSupabaseAdmin();
  const windowDays = opts.windowDays ?? 28;
  const minRecent = opts.minRecentClicks ?? 30;
  const gainThreshold = opts.gainThreshold ?? 0.4;

  const { data, error } = await supabase.rpc('gsc_page_wow', { p_workspace: opts.workspaceId, p_window: windowDays });
  if (error) throw new Error(`gsc_page_wow RPC failed: ${error.message}`);

  const wow = (data ?? []) as PWow[];
  const rows: InsightInsert[] = [];
  for (const w of wow) {
    const recent = Number(w.recent_clicks);
    const prior = Number(w.prior_clicks);
    if (recent < minRecent) continue;

    if (w.clicks_pct_change == null && prior === 0) {
      rows.push({
        workspace_id: opts.workspaceId,
        detector: 'page_clicks_gained',
        category: 'seo',
        severity: sev(recent),
        polarity: 'win',
        title: `${w.page_path} is newly earning search clicks (${recent.toLocaleString()} in the last ${windowDays} days)`,
        evidence: { page_path: w.page_path, recent_clicks: recent, prior_clicks: prior, new_page: true, recent_impressions: Number(w.recent_impr), window_days: windowDays },
        sources: ['Search Console'],
        dedupe_key: `page_clicks_gained:${w.page_path}`,
      });
      continue;
    }
    if (w.clicks_pct_change == null) continue;
    const pct = Number(w.clicks_pct_change);
    if (pct < gainThreshold) continue;
    const risePct = Math.round(pct * 100);
    rows.push({
      workspace_id: opts.workspaceId,
      detector: 'page_clicks_gained',
      category: 'seo',
      severity: sev(recent),
      polarity: 'win',
      title: `${w.page_path} gained ${risePct}% more search clicks`,
      evidence: {
        page_path: w.page_path, recent_clicks: recent, prior_clicks: prior, rise_pct: risePct,
        recent_impressions: Number(w.recent_impr), prior_impressions: Number(w.prior_impr), window_days: windowDays,
      },
      sources: ['Search Console'],
      dedupe_key: `page_clicks_gained:${w.page_path}`,
    });
  }
  return writeInsights({ workspaceId: opts.workspaceId, detector: 'page_clicks_gained', rows });
}

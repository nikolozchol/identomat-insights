import { getSupabaseAdmin } from '../supabase';
import { writeInsights, InsightInsert, DetectorResult } from './util';

type WowRow = {
  page_path: string;
  recent_sessions: number | string; prior_sessions: number | string;
  recent_conversions: number | string; prior_conversions: number | string;
  pct_change: number | string | null;
};

export async function detectTrafficDropByPage(opts: {
  workspaceId: string; windowDays?: number; minPriorSessions?: number; dropThreshold?: number;
}): Promise<DetectorResult> {
  const supabase = getSupabaseAdmin();
  const windowDays = opts.windowDays ?? 7;
  const minPrior = opts.minPriorSessions ?? 30;
  const dropThreshold = opts.dropThreshold ?? 0.3;

  const { data, error } = await supabase.rpc('detect_traffic_by_page_wow', {
    p_workspace: opts.workspaceId, p_window: windowDays,
  });
  if (error) throw new Error(`detect_traffic_by_page_wow RPC failed: ${error.message}`);

  const wow = (data ?? []) as WowRow[];
  const rows: InsightInsert[] = [];
  for (const w of wow) {
    if (w.page_path === '(site)' || w.pct_change === null) continue;
    const prior = Number(w.prior_sessions);
    const recent = Number(w.recent_sessions);
    const pct = Number(w.pct_change);
    if (prior < minPrior || pct > -dropThreshold) continue;
    const dropPct = Math.round(Math.abs(pct) * 100);
    const severity = prior >= 300 && dropPct >= 50 ? 'high' : prior >= 100 ? 'medium' : 'low';
    rows.push({
      workspace_id: opts.workspaceId,
      detector: 'traffic_drop_by_page',
      category: 'traffic',
      severity,
      polarity: 'issue',
      title: `Traffic to ${w.page_path} dropped ${dropPct}% week-over-week`,
      evidence: {
        page_path: w.page_path, recent_sessions: recent, prior_sessions: prior,
        pct_change: pct, drop_pct: dropPct, window_days: windowDays,
      },
      sources: ['GA4'],
      dedupe_key: `traffic_drop_by_page:${w.page_path}`,
    });
  }
  return writeInsights({ workspaceId: opts.workspaceId, detector: 'traffic_drop_by_page', rows });
}

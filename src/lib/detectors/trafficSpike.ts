import { getSupabaseAdmin } from '../supabase';
import { writeInsights, InsightInsert, DetectorResult } from './util';

type WowRow = {
  page_path: string;
  recent_sessions: number | string; prior_sessions: number | string;
  recent_conversions: number | string; prior_conversions: number | string;
  pct_change: number | string | null;
};

export async function detectTrafficSpike(opts: {
  workspaceId: string; windowDays?: number; minRecentSessions?: number; spikeThreshold?: number;
}): Promise<DetectorResult> {
  const supabase = getSupabaseAdmin();
  const windowDays = opts.windowDays ?? 7;
  const minRecent = opts.minRecentSessions ?? 50;
  const spikeThreshold = opts.spikeThreshold ?? 0.5;

  const { data, error } = await supabase.rpc('detect_traffic_by_page_wow', {
    p_workspace: opts.workspaceId, p_window: windowDays,
  });
  if (error) throw new Error(`detect_traffic_by_page_wow RPC failed: ${error.message}`);

  const wow = (data ?? []) as WowRow[];
  const rows: InsightInsert[] = [];
  for (const w of wow) {
    if (w.page_path === '(site)') continue;
    const recent = Number(w.recent_sessions);
    const prior = Number(w.prior_sessions);
    if (recent < minRecent) continue;

    if (w.pct_change === null && prior === 0) {
      rows.push({
        workspace_id: opts.workspaceId,
        detector: 'traffic_spike',
        category: 'traffic',
        severity: 'low',
        polarity: 'win',
        title: `${w.page_path} is a new traffic source (${recent.toLocaleString()} sessions this week)`,
        evidence: { page_path: w.page_path, recent_sessions: recent, prior_sessions: prior, new_page: true, window_days: windowDays },
        sources: ['GA4'],
        dedupe_key: `traffic_spike:${w.page_path}`,
      });
      continue;
    }
    if (w.pct_change === null) continue;
    const pct = Number(w.pct_change);
    if (pct < spikeThreshold) continue;
    const risePct = Math.round(pct * 100);
    rows.push({
      workspace_id: opts.workspaceId,
      detector: 'traffic_spike',
      category: 'traffic',
      severity: 'low',
      polarity: 'win',
      title: `Traffic to ${w.page_path} jumped ${risePct}% week-over-week`,
      evidence: {
        page_path: w.page_path, recent_sessions: recent, prior_sessions: prior,
        pct_change: pct, rise_pct: risePct, window_days: windowDays,
      },
      sources: ['GA4'],
      dedupe_key: `traffic_spike:${w.page_path}`,
    });
  }
  return writeInsights({ workspaceId: opts.workspaceId, detector: 'traffic_spike', rows });
}

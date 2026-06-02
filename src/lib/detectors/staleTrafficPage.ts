import { getSupabaseAdmin } from '../supabase';
import { writeInsights, InsightInsert, DetectorResult } from './util';

type Row = { page_path: string; sessions: number | string; last_modified: string; days_old: number | string };

export async function detectStaleTrafficPage(opts: {
  workspaceId: string; lookbackDays?: number; minSessions?: number; staleDays?: number;
}): Promise<DetectorResult> {
  const supabase = getSupabaseAdmin();
  const lookback = opts.lookbackDays ?? 28;
  const minSessions = opts.minSessions ?? 80;
  const staleDays = opts.staleDays ?? 180;

  const { data, error } = await supabase.rpc('detect_stale_traffic_page', {
    p_workspace: opts.workspaceId, p_lookback: lookback, p_min_sessions: minSessions, p_stale_days: staleDays,
  });
  if (error) throw new Error(`detect_stale_traffic_page RPC failed: ${error.message}`);

  const rows: InsightInsert[] = [];
  for (const r of (data ?? []) as Row[]) {
    const sessions = Number(r.sessions);
    const daysOld = Number(r.days_old);
    const monthsOld = Math.round(daysOld / 30);
    const severity = sessions >= 1000 ? 'high' : sessions >= 300 ? 'medium' : 'low';
    rows.push({
      workspace_id: opts.workspaceId,
      detector: 'stale_traffic_page',
      category: 'content',
      severity,
      polarity: 'opportunity',
      title: `${r.page_path} still gets ${sessions.toLocaleString()} sessions but hasn't been updated in ${monthsOld} months`,
      evidence: {
        page_path: r.page_path, sessions, last_modified: r.last_modified,
        days_old: daysOld, months_old: monthsOld, lookback_days: lookback,
      },
      sources: ['GA4', 'Sitemap'],
      dedupe_key: `stale_traffic_page:${r.page_path}`,
    });
  }
  return writeInsights({ workspaceId: opts.workspaceId, detector: 'stale_traffic_page', rows });
}

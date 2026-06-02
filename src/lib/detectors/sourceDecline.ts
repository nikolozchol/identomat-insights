import { getSupabaseAdmin } from '../supabase';
import { writeInsights, InsightInsert, DetectorResult } from './util';

type CWow = {
  channel: string;
  recent_sessions: number | string; prior_sessions: number | string;
  recent_conversions: number | string; prior_conversions: number | string;
  sessions_pct_change: number | string | null;
};

export async function detectSourceDecline(opts: {
  workspaceId: string; windowDays?: number; minPriorSessions?: number; dropThreshold?: number;
}): Promise<DetectorResult> {
  const supabase = getSupabaseAdmin();
  const windowDays = opts.windowDays ?? 28;
  const minPrior = opts.minPriorSessions ?? 100;
  const dropThreshold = opts.dropThreshold ?? 0.3;

  const { data, error } = await supabase.rpc('ga4_channel_wow', { p_workspace: opts.workspaceId, p_window: windowDays });
  if (error) throw new Error(`ga4_channel_wow RPC failed: ${error.message}`);

  const wow = (data ?? []) as CWow[];
  const rows: InsightInsert[] = [];
  for (const w of wow) {
    if (w.channel === '(all)' || w.channel === '(site)' || w.sessions_pct_change == null) continue;
    const prior = Number(w.prior_sessions);
    const recent = Number(w.recent_sessions);
    const pct = Number(w.sessions_pct_change);
    if (prior < minPrior || pct > -dropThreshold) continue;
    const dropPct = Math.round(Math.abs(pct) * 100);
    const severity = prior >= 1000 && dropPct >= 40 ? 'high' : prior >= 300 ? 'medium' : 'low';
    rows.push({
      workspace_id: opts.workspaceId,
      detector: 'source_decline',
      category: 'traffic',
      severity,
      polarity: 'issue',
      title: `${w.channel} traffic dropped ${dropPct}% (last ${windowDays} days vs prior ${windowDays})`,
      evidence: { channel: w.channel, recent_sessions: recent, prior_sessions: prior, drop_pct: dropPct, window_days: windowDays },
      sources: ['GA4'],
      dedupe_key: `source_decline:${w.channel}`,
    });
  }
  return writeInsights({ workspaceId: opts.workspaceId, detector: 'source_decline', rows });
}

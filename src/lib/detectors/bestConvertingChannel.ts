import { getSupabaseAdmin } from '../supabase';
import { writeInsights, InsightInsert, DetectorResult } from './util';

type CWow = {
  channel: string;
  recent_sessions: number | string; prior_sessions: number | string;
  recent_conversions: number | string; prior_conversions: number | string;
  sessions_pct_change: number | string | null;
};

export async function detectBestConvertingChannel(opts: {
  workspaceId: string; windowDays?: number; minSessions?: number;
}): Promise<DetectorResult> {
  const supabase = getSupabaseAdmin();
  const windowDays = opts.windowDays ?? 28;
  const minSessions = opts.minSessions ?? 50;

  const { data, error } = await supabase.rpc('ga4_channel_wow', { p_workspace: opts.workspaceId, p_window: windowDays });
  if (error) throw new Error(`ga4_channel_wow RPC failed: ${error.message}`);

  const wow = (data ?? []) as CWow[];
  const totalS = wow.reduce((s, w) => s + Number(w.recent_sessions), 0);
  const totalC = wow.reduce((s, w) => s + Number(w.recent_conversions), 0);

  const rows: InsightInsert[] = [];
  if (totalS > 0 && totalC > 0) {
    const siteRate = totalC / totalS;
    let best: { channel: string; sessions: number; conv: number; rate: number } | null = null;
    for (const w of wow) {
      if (w.channel === '(all)' || w.channel === '(site)') continue;
      const sessions = Number(w.recent_sessions);
      const conv = Number(w.recent_conversions);
      if (sessions < minSessions || conv < 1) continue;
      const rate = conv / sessions;
      if (!best || rate > best.rate) best = { channel: w.channel, sessions, conv, rate };
    }
    if (best && best.rate >= siteRate * 1.5) {
      const share = best.sessions / totalS;
      const underused = share < 0.25;
      rows.push({
        workspace_id: opts.workspaceId,
        detector: 'best_converting_channel',
        category: 'channels',
        severity: underused ? 'medium' : 'low',
        polarity: 'opportunity',
        title: `${best.channel} is your best-converting channel (${(best.rate * 100).toFixed(1)}% to demo)`,
        evidence: {
          channel: best.channel, conv_rate_pct: Number((best.rate * 100).toFixed(2)),
          site_avg_conv_rate_pct: Number((siteRate * 100).toFixed(2)), share_pct: Number((share * 100).toFixed(1)),
          recent_sessions: best.sessions, recent_conversions: best.conv, underused, window_days: windowDays,
        },
        sources: ['GA4'],
        dedupe_key: 'best_converting_channel',
      });
    }
  }
  return writeInsights({ workspaceId: opts.workspaceId, detector: 'best_converting_channel', rows });
}

import { getSupabaseAdmin } from '../supabase';
import { writeInsights, InsightInsert, DetectorResult } from './util';

type CWow = {
  channel: string;
  recent_sessions: number | string; prior_sessions: number | string;
  recent_conversions: number | string; prior_conversions: number | string;
  sessions_pct_change: number | string | null;
};

// "Untracked" buckets: a surge in their SHARE usually signals UTM/tagging gaps
// (real campaign/referral/email traffic miscounted), not genuine channel growth.
const UNTRACKED = new Set(['direct', 'unassigned', '(other)']);

export async function detectChannelMixShift(opts: {
  workspaceId: string; windowDays?: number; minRecentSessions?: number; minShiftPoints?: number;
}): Promise<DetectorResult> {
  const supabase = getSupabaseAdmin();
  const windowDays = opts.windowDays ?? 28;
  const minRecent = opts.minRecentSessions ?? 100;
  const minShiftPoints = opts.minShiftPoints ?? 5;

  const { data, error } = await supabase.rpc('ga4_channel_wow', { p_workspace: opts.workspaceId, p_window: windowDays });
  if (error) throw new Error(`ga4_channel_wow RPC failed: ${error.message}`);

  const wow = (data ?? []) as CWow[];
  const recentTotal = wow.reduce((s, w) => s + Number(w.recent_sessions), 0);
  const priorTotal = wow.reduce((s, w) => s + Number(w.prior_sessions), 0);

  const rows: InsightInsert[] = [];
  if (recentTotal > 0 && priorTotal > 0) {
    for (const w of wow) {
      if (w.channel === '(all)' || w.channel === '(site)') continue;
      const recent = Number(w.recent_sessions);
      const prior = Number(w.prior_sessions);
      if (recent < minRecent) continue;
      const recentShare = recent / recentTotal;
      const priorShare = prior / priorTotal;
      const shiftPts = (recentShare - priorShare) * 100;
      if (shiftPts < minShiftPoints) continue; // share growth only

      const recentSharePct = Number((recentShare * 100).toFixed(1));
      const priorSharePct = Number((priorShare * 100).toFixed(1));
      const shiftPoints = Number(shiftPts.toFixed(1));
      const isUntracked = UNTRACKED.has((w.channel || '').trim().toLowerCase());

      if (isUntracked) {
        // Direct/Unassigned share surge -> likely a tracking/UTM gap, framed as an issue to investigate.
        const severity = recentShare >= 0.6 ? 'high' : recentShare >= 0.4 ? 'medium' : 'low';
        rows.push({
          workspace_id: opts.workspaceId,
          detector: 'channel_mix_shift',
          category: 'channels',
          severity,
          polarity: 'issue',
          title: `${w.channel} surged to ${recentSharePct}% of traffic — possible tracking/UTM gap`,
          evidence: {
            channel: w.channel, recent_share_pct: recentSharePct, prior_share_pct: priorSharePct,
            shift_points: shiftPoints, recent_sessions: recent, prior_sessions: prior,
            likely_tracking_gap: true, window_days: windowDays,
          },
          sources: ['GA4'],
          dedupe_key: `channel_mix_shift:${w.channel}`,
        });
      } else {
        // A real channel growing its share is a genuine momentum opportunity.
        const severity = recent >= 1000 ? 'high' : recent >= 300 ? 'medium' : 'low';
        rows.push({
          workspace_id: opts.workspaceId,
          detector: 'channel_mix_shift',
          category: 'channels',
          severity,
          polarity: 'opportunity',
          title: `${w.channel} grew from ${priorSharePct}% to ${recentSharePct}% of traffic`,
          evidence: {
            channel: w.channel, recent_share_pct: recentSharePct, prior_share_pct: priorSharePct,
            shift_points: shiftPoints, recent_sessions: recent, prior_sessions: prior,
            likely_tracking_gap: false, window_days: windowDays,
          },
          sources: ['GA4'],
          dedupe_key: `channel_mix_shift:${w.channel}`,
        });
      }
    }
  }
  return writeInsights({ workspaceId: opts.workspaceId, detector: 'channel_mix_shift', rows });
}

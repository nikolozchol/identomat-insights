import { getSupabaseAdmin } from '../supabase';
import { writeInsights, InsightInsert, DetectorResult } from './util';

type Row = {
  country: string;
  recent_sessions: number | string; prior_sessions: number | string;
  recent_conversions: number | string; prior_conversions: number | string;
  sessions_pct_change: number | string | null;
};

export async function detectCountryShift(opts: {
  workspaceId: string; windowDays?: number; minSessions?: number; minShiftPoints?: number;
}): Promise<DetectorResult> {
  const supabase = getSupabaseAdmin();
  const windowDays = opts.windowDays ?? 28;
  const minSessions = opts.minSessions ?? 50;
  const minShiftPoints = opts.minShiftPoints ?? 5;

  const { data, error } = await supabase.rpc('ga4_country_wow', {
    p_workspace: opts.workspaceId, p_window: windowDays,
  });
  if (error) throw new Error(`ga4_country_wow RPC failed: ${error.message}`);

  const wow = (data ?? []) as Row[];
  const recentTotal = wow.reduce((s, w) => s + Number(w.recent_sessions), 0);
  const priorTotal = wow.reduce((s, w) => s + Number(w.prior_sessions), 0);

  const rows: InsightInsert[] = [];
  if (recentTotal > 0 && priorTotal > 0) {
    for (const w of wow) {
      const country = (w.country || '').trim();
      // Skip non-geographic buckets like '(not set)'.
      if (!country || country.startsWith('(')) continue;

      const recent = Number(w.recent_sessions);
      const prior = Number(w.prior_sessions);
      const recentShare = recent / recentTotal;
      const priorShare = prior / priorTotal;
      const shiftPts = (recentShare - priorShare) * 100;
      const recentSharePct = Number((recentShare * 100).toFixed(1));
      const priorSharePct = Number((priorShare * 100).toFixed(1));
      const shiftPoints = Number(shiftPts.toFixed(1));

      if (shiftPts >= minShiftPoints && recent >= minSessions) {
        // A country growing its share of traffic — an emerging market to lean into.
        const severity = recent >= 1000 ? 'high' : recent >= 300 ? 'medium' : 'low';
        rows.push({
          workspace_id: opts.workspaceId,
          detector: 'country_shift',
          category: 'traffic',
          severity,
          polarity: 'opportunity',
          title: `${country} grew from ${priorSharePct}% to ${recentSharePct}% of your traffic`,
          evidence: {
            country, recent_share_pct: recentSharePct, prior_share_pct: priorSharePct,
            shift_points: shiftPoints, recent_sessions: recent, prior_sessions: prior,
            direction: 'up', window_days: windowDays,
          },
          sources: ['GA4'],
          dedupe_key: `country_shift:${country}`,
        });
      } else if (shiftPts <= -minShiftPoints && prior >= minSessions && recent < prior) {
        // A previously material market losing share AND volume — worth investigating.
        const severity = prior >= 1000 ? 'high' : prior >= 300 ? 'medium' : 'low';
        rows.push({
          workspace_id: opts.workspaceId,
          detector: 'country_shift',
          category: 'traffic',
          severity,
          polarity: 'issue',
          title: `${country} fell from ${priorSharePct}% to ${recentSharePct}% of your traffic`,
          evidence: {
            country, recent_share_pct: recentSharePct, prior_share_pct: priorSharePct,
            shift_points: shiftPoints, recent_sessions: recent, prior_sessions: prior,
            direction: 'down', window_days: windowDays,
          },
          sources: ['GA4'],
          dedupe_key: `country_shift:${country}`,
        });
      }
    }
  }
  return writeInsights({ workspaceId: opts.workspaceId, detector: 'country_shift', rows });
}

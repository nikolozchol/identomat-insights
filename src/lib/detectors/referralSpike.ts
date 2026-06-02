import { getSupabaseAdmin } from '../supabase';
import { writeInsights, InsightInsert, DetectorResult } from './util';

type Row = {
  source: string;
  recent_sessions: number | string; prior_sessions: number | string;
  recent_conversions: number | string; prior_conversions: number | string;
  sessions_pct_change: number | string | null;
};

function sev(recent: number): 'high' | 'medium' | 'low' {
  return recent >= 100 ? 'medium' : 'low';
}

export async function detectReferralSpike(opts: {
  workspaceId: string; windowDays?: number; minRecentSessions?: number; spikeThreshold?: number;
}): Promise<DetectorResult> {
  const supabase = getSupabaseAdmin();
  const windowDays = opts.windowDays ?? 28;
  const minRecent = opts.minRecentSessions ?? 25;
  const spikeThreshold = opts.spikeThreshold ?? 0.5;

  const { data, error } = await supabase.rpc('ga4_source_wow', {
    p_workspace: opts.workspaceId, p_window: windowDays,
  });
  if (error) throw new Error(`ga4_source_wow RPC failed: ${error.message}`);

  const wow = (data ?? []) as Row[];
  const rows: InsightInsert[] = [];
  for (const w of wow) {
    const source = (w.source || '').trim();
    // Skip non-source buckets like '(not set)'.
    if (!source || source.startsWith('(')) continue;

    const recent = Number(w.recent_sessions);
    const prior = Number(w.prior_sessions);
    const recentConv = Number(w.recent_conversions);
    if (recent < minRecent) continue;

    if (w.sessions_pct_change === null && prior === 0) {
      // A brand-new referrer sending real traffic — a fresh win to capitalize on.
      rows.push({
        workspace_id: opts.workspaceId,
        detector: 'referral_spike',
        category: 'channels',
        severity: sev(recent),
        polarity: 'win',
        title: `${source} started sending you referral traffic (${recent.toLocaleString()} sessions)`,
        evidence: {
          source, recent_sessions: recent, prior_sessions: prior, recent_conversions: recentConv,
          new_source: true, window_days: windowDays,
        },
        sources: ['GA4'],
        dedupe_key: `referral_spike:${source}`,
      });
      continue;
    }
    if (w.sessions_pct_change === null) continue;
    const pct = Number(w.sessions_pct_change);
    if (pct < spikeThreshold) continue;
    const risePct = Math.round(pct * 100);
    rows.push({
      workspace_id: opts.workspaceId,
      detector: 'referral_spike',
      category: 'channels',
      severity: sev(recent),
      polarity: 'win',
      title: `Referral traffic from ${source} jumped ${risePct}%`,
      evidence: {
        source, recent_sessions: recent, prior_sessions: prior, recent_conversions: recentConv,
        rise_pct: risePct, new_source: false, window_days: windowDays,
      },
      sources: ['GA4'],
      dedupe_key: `referral_spike:${source}`,
    });
  }
  return writeInsights({ workspaceId: opts.workspaceId, detector: 'referral_spike', rows });
}

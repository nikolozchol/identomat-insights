import { getSupabaseAdmin } from '../supabase';
import { writeInsights, InsightInsert, DetectorResult } from './util';

type CWow = {
  channel: string;
  recent_sessions: number | string; prior_sessions: number | string;
  recent_conversions: number | string; prior_conversions: number | string;
  sessions_pct_change: number | string | null;
};

export async function detectDemoRequestDrop(opts: {
  workspaceId: string; windowDays?: number; minPriorConversions?: number; dropThreshold?: number;
}): Promise<DetectorResult> {
  const supabase = getSupabaseAdmin();
  const windowDays = opts.windowDays ?? 28;
  const minPrior = opts.minPriorConversions ?? 10;
  const dropThreshold = opts.dropThreshold ?? 0.2;

  const { data, error } = await supabase.rpc('ga4_channel_wow', { p_workspace: opts.workspaceId, p_window: windowDays });
  if (error) throw new Error(`ga4_channel_wow RPC failed: ${error.message}`);

  const wow = (data ?? []) as CWow[];
  let recentConv = 0;
  let priorConv = 0;
  for (const w of wow) {
    recentConv += Number(w.recent_conversions);
    priorConv += Number(w.prior_conversions);
  }

  const rows: InsightInsert[] = [];
  if (priorConv >= minPrior) {
    const pct = (recentConv - priorConv) / priorConv;
    if (pct <= -dropThreshold) {
      const dropPct = Math.round(Math.abs(pct) * 100);
      const severity = dropPct >= 40 ? 'high' : dropPct >= 20 ? 'medium' : 'low';
      rows.push({
        workspace_id: opts.workspaceId,
        detector: 'demo_request_drop',
        category: 'conversion',
        severity,
        polarity: 'issue',
        title: `Demo requests dropped ${dropPct}% (last ${windowDays} days vs prior ${windowDays})`,
        evidence: { recent_conversions: recentConv, prior_conversions: priorConv, drop_pct: dropPct, window_days: windowDays },
        sources: ['GA4'],
        dedupe_key: 'demo_request_drop:site',
      });
    }
  }
  return writeInsights({ workspaceId: opts.workspaceId, detector: 'demo_request_drop', rows });
}

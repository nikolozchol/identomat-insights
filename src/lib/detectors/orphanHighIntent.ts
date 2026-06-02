import { getSupabaseAdmin } from '../supabase';
import { writeInsights, InsightInsert, DetectorResult } from './util';

type Row = { page_path: string; sessions: number | string; inbound_internal_links: number | string };

export async function detectOrphanHighIntent(opts: {
  workspaceId: string; lookbackDays?: number; minSessions?: number; maxInbound?: number;
}): Promise<DetectorResult> {
  const supabase = getSupabaseAdmin();
  const lookback = opts.lookbackDays ?? 28;
  const minSessions = opts.minSessions ?? 50;
  const maxInbound = opts.maxInbound ?? 1;

  const { data, error } = await supabase.rpc('detect_orphan_high_intent', {
    p_workspace: opts.workspaceId, p_lookback: lookback, p_min_sessions: minSessions, p_max_inbound: maxInbound,
  });
  if (error) throw new Error(`detect_orphan_high_intent RPC failed: ${error.message}`);

  const rows: InsightInsert[] = [];
  for (const r of (data ?? []) as Row[]) {
    const sessions = Number(r.sessions);
    const inbound = Number(r.inbound_internal_links);
    const severity = sessions >= 1000 ? 'high' : sessions >= 300 ? 'medium' : 'low';
    const linkText = inbound === 0 ? 'no internal links' : `only ${inbound} internal link${inbound === 1 ? '' : 's'}`;
    rows.push({
      workspace_id: opts.workspaceId,
      detector: 'orphan_high_intent',
      category: 'seo',
      severity,
      polarity: 'opportunity',
      title: `${r.page_path} earns ${sessions.toLocaleString()} sessions but has ${linkText} pointing to it`,
      evidence: {
        page_path: r.page_path, sessions, inbound_internal_links: inbound, lookback_days: lookback,
      },
      sources: ['GA4', 'Crawl'],
      dedupe_key: `orphan_high_intent:${r.page_path}`,
    });
  }
  return writeInsights({ workspaceId: opts.workspaceId, detector: 'orphan_high_intent', rows });
}

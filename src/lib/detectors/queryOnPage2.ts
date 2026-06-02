import { getSupabaseAdmin } from '../supabase';
import { writeInsights, InsightInsert, DetectorResult } from './util';

type Candidate = {
  query: string; page_path: string;
  impressions: number | string; clicks: number | string;
  avg_position: number | string; ctr: number | string;
};

function severityFor(impr: number, pos: number): 'high' | 'medium' | 'low' {
  if (impr >= 1000 || (impr >= 400 && pos <= 13)) return 'high';
  if (impr >= 200) return 'medium';
  return 'low';
}

export async function detectQueryOnPage2(opts: {
  workspaceId: string; lookbackDays?: number; minImpressions?: number;
}): Promise<DetectorResult> {
  const supabase = getSupabaseAdmin();
  const lookback = opts.lookbackDays ?? 28;
  const minImpr = opts.minImpressions ?? 80;

  const { data, error } = await supabase.rpc('detect_query_on_page_2', {
    p_workspace: opts.workspaceId, p_lookback: lookback, p_min_impressions: minImpr,
  });
  if (error) throw new Error(`detect_query_on_page_2 RPC failed: ${error.message}`);

  const candidates = (data ?? []) as Candidate[];
  const rows: InsightInsert[] = candidates.map((c) => {
    const impressions = Number(c.impressions);
    const position = Number(c.avg_position);
    return {
      workspace_id: opts.workspaceId,
      detector: 'query_on_page_2',
      category: 'seo',
      severity: severityFor(impressions, position),
      polarity: 'opportunity',
      title: `"${c.query}" is ranking on page 2 (avg position ${position.toFixed(1)})`,
      evidence: {
        query: c.query, page_path: c.page_path, impressions,
        clicks: Number(c.clicks), ctr: Number(c.ctr), position, lookback_days: lookback,
      },
      sources: ['Search Console'],
      dedupe_key: `query_on_page_2:${c.query}`,
    };
  });
  return writeInsights({ workspaceId: opts.workspaceId, detector: 'query_on_page_2', rows });
}

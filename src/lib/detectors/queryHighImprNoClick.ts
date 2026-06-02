import { getSupabaseAdmin } from '../supabase';
import { writeInsights, InsightInsert, DetectorResult } from './util';

type Candidate = {
  query: string; page_path: string;
  impressions: number | string; clicks: number | string;
  avg_position: number | string; ctr: number | string;
};

const EXPECTED_CTR: Record<number, number> = {
  1: 0.28, 2: 0.15, 3: 0.10, 4: 0.07, 5: 0.05, 6: 0.04, 7: 0.03, 8: 0.025, 9: 0.02, 10: 0.018,
};
function expectedCtr(pos: number): number {
  const p = Math.max(1, Math.min(10, Math.round(pos)));
  return EXPECTED_CTR[p] ?? 0.02;
}

const INFO = ['what is', 'what are', 'how to', 'how do', 'meaning', 'definition', 'requirements', 'example', 'guide', ' vs ', 'difference', 'why ', 'explained', 'types of', 'list of'];
const COMMERCIAL = ['best', 'top ', 'pricing', 'price', 'cost', 'software', 'tool', 'platform', 'provider', 'vendor', 'company', 'companies', 'solution', 'service', 'api', 'buy', 'compare', 'review', 'alternative', 'cheap'];
function classifyIntent(q: string): 'informational' | 'commercial' | 'mixed' {
  const s = ` ${q.toLowerCase()} `;
  if (COMMERCIAL.some((m) => s.includes(m))) return 'commercial';
  if (INFO.some((m) => s.includes(m))) return 'informational';
  return 'mixed';
}

function severityFor(impr: number): 'high' | 'medium' | 'low' {
  if (impr >= 1000) return 'high';
  if (impr >= 500) return 'medium';
  return 'low';
}

export async function detectQueryHighImprNoClick(opts: {
  workspaceId: string; lookbackDays?: number; minImpressions?: number; maxPosition?: number;
}): Promise<DetectorResult> {
  const supabase = getSupabaseAdmin();
  const lookback = opts.lookbackDays ?? 28;
  const minImpr = opts.minImpressions ?? 200; // tightened: was 80
  const maxPosition = opts.maxPosition ?? 5;   // tightened: only top-5 positions

  const { data, error } = await supabase.rpc('detect_query_high_impr_no_click', {
    p_workspace: opts.workspaceId, p_lookback: lookback, p_min_impressions: minImpr,
  });
  if (error) throw new Error(`detect_query_high_impr_no_click RPC failed: ${error.message}`);

  const candidates = (data ?? []) as Candidate[];
  const rows: InsightInsert[] = [];
  for (const c of candidates) {
    const impressions = Number(c.impressions);
    const clicks = Number(c.clicks);
    const position = Number(c.avg_position);
    const ctr = Number(c.ctr);
    if (position > maxPosition) continue;        // only strongly-visible positions
    const exp = expectedCtr(position);
    if (ctr >= exp * 0.5) continue;              // only genuine underperformers
    const intent = classifyIntent(c.query);
    const likelyZeroClick = intent === 'informational';
    rows.push({
      workspace_id: opts.workspaceId,
      detector: 'query_high_impressions_no_click',
      category: 'seo',
      severity: severityFor(impressions),
      polarity: likelyZeroClick ? 'opportunity' : 'issue',
      title: `"${c.query}" gets ${impressions.toLocaleString()} impressions but few clicks (position ${position.toFixed(1)})`,
      evidence: {
        query: c.query, page_path: c.page_path, impressions, clicks, ctr, position,
        expected_ctr: Number(exp.toFixed(4)), intent, likely_zero_click: likelyZeroClick,
        ctr_pct: `${(ctr * 100).toFixed(1)}%`, expected_ctr_pct: `${(exp * 100).toFixed(1)}%`,
        lookback_days: lookback,
      },
      sources: ['Search Console'],
      dedupe_key: `query_high_impressions_no_click:${c.query}`,
    });
  }
  return writeInsights({ workspaceId: opts.workspaceId, detector: 'query_high_impressions_no_click', rows });
}

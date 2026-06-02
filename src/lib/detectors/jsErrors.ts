import { getSupabaseAdmin } from '../supabase';
import { writeInsights, InsightInsert, DetectorResult } from './util';

type Row = {
  page_path: string; sessions: number | string;
  rage_click_pct: number | string; dead_click_pct: number | string;
  quick_back_pct: number | string; js_error_pct: number | string;
  avg_scroll_depth: number | string; avg_time: number | string;
};

export async function detectJsErrors(opts: {
  workspaceId: string; windowDays?: number; minSessions?: number; pctThreshold?: number;
}): Promise<DetectorResult> {
  const supabase = getSupabaseAdmin();
  const windowDays = opts.windowDays ?? 28;
  const minSessions = opts.minSessions ?? 15;
  const pctThreshold = opts.pctThreshold ?? 5;

  const { data, error } = await supabase.rpc('clarity_page_window', { p_workspace: opts.workspaceId, p_window: windowDays });
  if (error) throw new Error(`clarity_page_window RPC failed: ${error.message}`);

  const rows: InsightInsert[] = [];
  for (const r of (data ?? []) as Row[]) {
    const sessions = Number(r.sessions);
    const pct = Number(r.js_error_pct);
    if (sessions < minSessions || pct < pctThreshold) continue;
    // A JS-error RATE alone does not establish user impact (much is third-party / extension
    // noise), so this never reads as 'high'. It flags a rate worth a quick check, not breakage.
    const severity = pct >= 20 ? 'medium' : 'low';
    rows.push({
      workspace_id: opts.workspaceId,
      detector: 'js_errors',
      category: 'ux',
      severity,
      polarity: 'issue',
      title: `Elevated JavaScript error rate on ${r.page_path} (${pct.toFixed(1)}% of sessions)`,
      evidence: { page_path: r.page_path, js_error_pct: pct, sessions, window_days: windowDays },
      sources: ['Clarity'],
      dedupe_key: `js_errors:${r.page_path}`,
    });
  }
  return writeInsights({ workspaceId: opts.workspaceId, detector: 'js_errors', rows });
}

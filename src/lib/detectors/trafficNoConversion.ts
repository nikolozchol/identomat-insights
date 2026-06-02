import { getSupabaseAdmin } from '../supabase';
import { writeInsights, InsightInsert, DetectorResult } from './util';

type Row = { page_path: string; sessions: number | string; conversions: number | string };

// Pages where a conversion is *recorded* (e.g. a post-redirect thank-you / confirmation page).
// In the multi-tenant product this becomes a per-workspace setting, seeded by auto-detection
// (URL patterns + the statistical tell that conversions concentrate on one page). For the
// internal Identomat workspace we seed it directly.
const CONFIRMATION_PAGES = new Set<string>(['/demo-booked-thank-you']);

function pathKey(p: string): string {
  const t = (p ?? '').trim();
  return t.length > 1 ? t.replace(/\/+$/, '') : t;
}

// Does this workspace record conversions on a confirmation page? If so, GA4 attributes the
// conversion to that page rather than the page that drove it, so page-level "0 conversions"
// on an ordinary page is an attribution artifact -- not a real failure to convert.
async function usesRedirectConversion(workspaceId: string): Promise<boolean> {
  if (CONFIRMATION_PAGES.size === 0) return false;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('ga4_daily')
    .select('conversions')
    .eq('workspace_id', workspaceId)
    .in('page_path', [...CONFIRMATION_PAGES])
    .eq('channel', '(all)')
    .eq('country', '(all)');
  if (error) throw new Error(`confirmation-page check failed: ${error.message}`);
  const total = ((data ?? []) as Array<{ conversions: number | string }>).reduce(
    (sum, r) => sum + Number(r.conversions ?? 0),
    0,
  );
  return total > 0;
}

export async function detectTrafficNoConversion(opts: {
  workspaceId: string; lookbackDays?: number; minSessions?: number;
}): Promise<DetectorResult> {
  const supabase = getSupabaseAdmin();
  const lookback = opts.lookbackDays ?? 28;
  const minSessions = opts.minSessions ?? 100;

  // If conversions are attributed to a confirmation page, page-level "no conversions" is
  // unreliable for every other page -- we can't tell which page actually drove the conversion.
  // Emit nothing in that case (any previously-flagged pages auto-resolve) to avoid false alarms.
  if (await usesRedirectConversion(opts.workspaceId)) {
    return writeInsights({ workspaceId: opts.workspaceId, detector: 'traffic_no_conversion', rows: [] });
  }

  const { data, error } = await supabase.rpc('detect_traffic_no_conversion', {
    p_workspace: opts.workspaceId, p_lookback: lookback, p_min_sessions: minSessions,
  });
  if (error) throw new Error(`detect_traffic_no_conversion RPC failed: ${error.message}`);

  const cands = (data ?? []) as Row[];
  const rows: InsightInsert[] = [];
  for (const c of cands) {
    if (c.page_path === '(site)') continue;
    if (CONFIRMATION_PAGES.has(pathKey(c.page_path))) continue; // never flag a confirmation page
    const sessions = Number(c.sessions);
    const severity = sessions >= 1000 ? 'high' : sessions >= 300 ? 'medium' : 'low';
    rows.push({
      workspace_id: opts.workspaceId,
      detector: 'traffic_no_conversion',
      category: 'conversion',
      severity,
      polarity: 'issue',
      title: `${c.page_path} has ${sessions.toLocaleString()} sessions but no conversions`,
      evidence: { page_path: c.page_path, sessions, conversions: 0, lookback_days: lookback },
      sources: ['GA4'],
      dedupe_key: `traffic_no_conversion:${c.page_path}`,
    });
  }
  return writeInsights({ workspaceId: opts.workspaceId, detector: 'traffic_no_conversion', rows });
}

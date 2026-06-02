import { getSupabaseAdmin } from '../../lib/supabase';
import { HeatmapsView, type BehaviorRow, type BehaviorInsight } from '../../components/heatmaps/HeatmapsView';

export const revalidate = 60;

export default async function HeatmapsPage() {
  const supabase = getSupabaseAdmin();

  const { data: wsData } = await supabase.from('workspaces').select('id').limit(1);
  const workspaceId = (wsData ?? [])[0]?.id as string | undefined;
  if (!workspaceId) {
    return <div className="p-10 text-[14px] text-fg-2">No workspace found.</div>;
  }
  const nowIso = new Date().toISOString();

  const [{ data: clarity }, { data: insRows }, { data: actData }] = await Promise.all([
    supabase.rpc('clarity_page_window', { p_workspace: workspaceId, p_window: 28 }),
    supabase
      .from('insights')
      .select('id, severity, polarity, title, narrative, category')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .eq('category', 'ux')
      .is('dismissed_at', null)
      .or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`),
    supabase.from('actions').select('insight_id').eq('workspace_id', workspaceId),
  ]);

  const rows: BehaviorRow[] = ((clarity ?? []) as Array<Record<string, unknown>>)
    .map((c) => ({
      page_path: String(c.page_path ?? ''),
      sessions: Number(c.sessions ?? 0),
      ragePct: Number(c.rage_click_pct ?? 0),
      deadPct: Number(c.dead_click_pct ?? 0),
      quickBackPct: Number(c.quick_back_pct ?? 0),
      jsErrorPct: Number(c.js_error_pct ?? 0),
      scrollDepth: Number(c.avg_scroll_depth ?? 0),
      avgTime: Number(c.avg_time ?? 0),
    }))
    .filter((r) => r.page_path && r.page_path !== '(site)')
    .sort((a, b) => b.sessions - a.sessions);

  const findings: BehaviorInsight[] = ((insRows ?? []) as Array<{
    id: string; severity: string; polarity: string | null; title: string; narrative: string | null;
  }>).map((r) => ({ id: r.id, severity: r.severity, polarity: r.polarity ?? 'issue', title: r.title, narrative: r.narrative }));

  const actionedIds = new Set(
    ((actData ?? []) as Array<{ insight_id: string | null }>).map((a) => a.insight_id).filter((x): x is string => !!x),
  );

  const pagePaths = rows.map((r) => r.page_path);

  return (
    <HeatmapsView
      rows={rows}
      findings={findings}
      actionedIds={actionedIds}
      pagePaths={pagePaths}
    />
  );
}

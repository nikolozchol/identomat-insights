import { getSupabaseAdmin } from '../lib/supabase';
import { InsightsFeed } from '../components/insights/InsightsFeed';
import type { InsightRow, SummaryRow } from '../components/insights/types';

export const revalidate = 60; // data changes ~daily; cache renders, revalidate on writes

export default async function InsightsPage() {
  const supabase = getSupabaseAdmin();
  const nowIso = new Date().toISOString();

  const { data: wsData } = await supabase.from('workspaces').select('id').limit(1);
  const workspaceId = (wsData ?? [])[0]?.id as string | undefined;

  if (!workspaceId) {
    return <div className="p-10 text-[14px] text-fg-2">No workspace found.</div>;
  }

  const [{ data: sumData }, { data: insData }, { data: actData }] = await Promise.all([
    supabase
      .from('summaries')
      .select('headline, body, trajectory, stories, active_insight_count, generated_at')
      .eq('workspace_id', workspaceId)
      .order('generated_at', { ascending: false })
      .limit(1),
    supabase
      .from('insights')
      .select('id, detector, category, severity, polarity, title, narrative, evidence, sources, page_id, detected_at')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .is('dismissed_at', null)
      .or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`),
    supabase.from('actions').select('insight_id').eq('workspace_id', workspaceId),
  ]);

  const summary = ((sumData ?? []) as SummaryRow[])[0] ?? null;
  const insights = (insData ?? []) as InsightRow[];
  const actionedInsightIds = ((actData ?? []) as Array<{ insight_id: string | null }>)
    .map((a) => a.insight_id)
    .filter((x): x is string => !!x);

  return <InsightsFeed summary={summary} insights={insights} actionedInsightIds={actionedInsightIds} />;
}

import { getSupabaseAdmin } from '../../lib/supabase';
import { ExclusionsManager, type ExclusionRow } from '../../components/settings/ExclusionsManager';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const supabase = getSupabaseAdmin();
  const { data: wsData } = await supabase.from('workspaces').select('id').limit(1);
  const workspaceId = (wsData ?? [])[0]?.id as string | undefined;

  let rules: ExclusionRow[] = [];
  let hiddenCount = 0;
  if (workspaceId) {
    const { data: ruleData } = await supabase
      .from('page_exclusions')
      .select('id, pattern, match_type, note, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true });
    rules = ((ruleData ?? []) as ExclusionRow[]);

    const { data: hiddenData } = await supabase.rpc('excluded_page_paths', { p_workspace: workspaceId });
    hiddenCount = ((hiddenData ?? []) as unknown[]).length;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-6">
      <div>
        <h1 className="text-[18px] font-medium tracking-[-0.01em] text-fg">Settings</h1>
        <p className="mt-1 text-[13px] text-fg-2">Manage how Identomat Insights reads your data.</p>
      </div>
      <ExclusionsManager initialRules={rules} hiddenCount={hiddenCount} />
    </div>
  );
}

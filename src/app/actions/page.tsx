import { getSupabaseAdmin } from '../../lib/supabase';
import { ActionCard, type ActionRow } from '../../components/actions/ActionCard';

export const revalidate = 60; // data changes ~daily; cache renders, revalidate on writes

type Status = 'new' | 'in_progress' | 'done';

const COLUMNS: { key: Status; label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'done', label: 'Done' },
];

export default async function ActionsPage() {
  const supabase = getSupabaseAdmin();

  const { data: wsData } = await supabase.from('workspaces').select('id').limit(1);
  const workspaceId = (wsData ?? [])[0]?.id as string | undefined;
  if (!workspaceId) {
    return <div className="p-10 text-[14px] text-fg-2">No workspace found.</div>;
  }

  const { data } = await supabase
    .from('actions')
    .select('id, title, brief, category, owner, effort, expected_impact, success_metric, status, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });
  const actions = (data ?? []) as ActionRow[];

  const byStatus = (s: Status) => actions.filter((a) => (a.status as Status) === s);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-6">
      <div className="flex items-baseline gap-2">
        <h1 className="text-[18px] font-medium tracking-[-0.01em] text-fg">Action queue</h1>
        <span className="font-mono text-[12px] text-fg-3">{actions.length} total</span>
      </div>

      {actions.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-6 text-center text-[14px] text-fg-2">
          No actions yet. Open the Insights feed and use “Convert to action” on a finding to add one here.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {COLUMNS.map((col) => {
            const items = byStatus(col.key);
            return (
              <div key={col.key} className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-[13px] font-medium uppercase tracking-wider text-fg-2">{col.label}</h2>
                  <span className="font-mono text-[12px] text-fg-3">{items.length}</span>
                </div>
                {items.length === 0 ? (
                  <div className="rounded-[var(--radius-card)] border border-dashed border-border p-4 text-center text-[12px] text-fg-3">
                    Nothing here
                  </div>
                ) : (
                  items.map((a) => <ActionCard key={a.id} a={a} />)
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

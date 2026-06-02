import { getSupabaseAdmin } from '../../lib/supabase';
import { createSupabaseServer } from '../../lib/supabase/server';
import { ActionsBoard } from '../../components/actions/ActionsBoard';
import type { ActionRow } from '../../components/actions/ActionCard';

export const revalidate = 60; // data changes ~daily; cache renders, revalidate on writes

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

  let currentUserEmail = '';
  try {
    const auth = await createSupabaseServer();
    const {
      data: { user },
    } = await auth.auth.getUser();
    currentUserEmail = user?.email ?? '';
  } catch {
    /* no session in this context — show all */
  }

  // Registered teammates, for the assignment dropdown.
  let members: string[] = [];
  try {
    const { data: list } = await supabase.auth.admin.listUsers();
    members = Array.from(
      new Set((list?.users ?? []).map((u) => u.email).filter((e): e is string => !!e)),
    ).sort();
  } catch {
    /* listing users is best-effort; dropdown falls back to current owner only */
  }

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
        <ActionsBoard actions={actions} currentUserEmail={currentUserEmail} members={members} />
      )}
    </div>
  );
}

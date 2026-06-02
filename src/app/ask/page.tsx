import { getSupabaseAdmin } from '../../lib/supabase';
import { AskPanel, type RecentQuestion } from '../../components/ask/AskPanel';

export const revalidate = 60;

export default async function AskPage() {
  const supabase = getSupabaseAdmin();
  const { data: wsData } = await supabase.from('workspaces').select('id').limit(1);
  const workspaceId = (wsData ?? [])[0]?.id as string | undefined;

  let recent: RecentQuestion[] = [];
  if (workspaceId) {
    const { data } = await supabase
      .from('questions')
      .select('id, question, answer, confidence, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(6);
    recent = (data ?? []) as RecentQuestion[];
  }

  return <AskPanel recent={recent} />;
}

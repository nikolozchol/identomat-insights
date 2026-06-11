import { getSupabaseAdmin } from '../../lib/supabase';
import { createSupabaseServer } from '../../lib/supabase/server';
import { ChatView, type ThreadMeta, type ChatMsg } from '../../components/ask/ChatView';

export const dynamic = 'force-dynamic';

export default async function AskPage({ searchParams }: { searchParams: Promise<{ chat?: string; insight?: string }> }) {
  const sp = await searchParams;
  const supabase = getSupabaseAdmin();

  let email: string | null = null;
  try {
    const auth = await createSupabaseServer();
    const { data: { user } } = await auth.auth.getUser();
    email = user?.email ?? null;
  } catch {
    /* no session */
  }

  const { data: wsData } = await supabase.from('workspaces').select('id').limit(1);
  const workspaceId = (wsData ?? [])[0]?.id as string | undefined;
  if (!workspaceId || !email) {
    return <div className="p-10 text-[14px] text-fg-2">Sign in to use Ask AI.</div>;
  }

  const { data: threadData } = await supabase
    .from('chats')
    .select('id, title, insight_id, updated_at')
    .eq('workspace_id', workspaceId)
    .eq('user_email', email)
    .order('updated_at', { ascending: false })
    .limit(50);
  const threads = (threadData ?? []) as ThreadMeta[];

  let activeChatId: string | null = null;
  let initialMessages: ChatMsg[] = [];
  if (sp.chat && threads.some((t) => t.id === sp.chat)) {
    activeChatId = sp.chat;
    const { data: msgData } = await supabase
      .from('chat_messages')
      .select('id, role, content, tools')
      .eq('chat_id', sp.chat)
      .order('created_at', { ascending: true })
      .limit(200);
    initialMessages = (msgData ?? []) as ChatMsg[];
  }

  let insightSeed: { id: string; title: string } | null = null;
  if (!activeChatId && sp.insight) {
    const { data: insData } = await supabase
      .from('insights').select('id, title')
      .eq('workspace_id', workspaceId).eq('id', sp.insight).limit(1);
    const ins = ((insData ?? []) as Array<{ id: string; title: string }>)[0];
    if (ins) insightSeed = ins;
  }

  return (
    <ChatView
      key={activeChatId ?? insightSeed?.id ?? 'new'}
      threads={threads}
      activeChatId={activeChatId}
      initialMessages={initialMessages}
      insightSeed={insightSeed}
    />
  );
}

import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSupabaseAdmin } from '../../../../lib/supabase';
import { createSupabaseServer } from '../../../../lib/supabase/server';
import { CHAT_TOOLS, runChatTool, type ToolTrace } from '../../../../lib/aiTools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MODEL = process.env.CHAT_MODEL || 'claude-sonnet-4-6';
const MAX_TOOL_ROUNDS = 4;

type ChatRow = { id: string; user_email: string; title: string; insight_id: string | null };
type MsgRow = { role: 'user' | 'assistant'; content: string };

function buildSystem(insightBlock: string | null): string {
  const today = new Date().toISOString().slice(0, 10);
  const parts = [
    `You are the analytics assistant inside Identomat Insights, an internal marketing-analytics platform for Identomat (B2B identity verification / KYC). The key conversion is demo requests. Today is ${today}.`,
    'You answer questions about the company\'s website funnel using TOOLS that return real, computed data from GA4, Google Search Console, and Microsoft Clarity.',
    'STRICT RULES:',
    '- Every number in your answer must come from a tool result in this conversation. Never invent, estimate, or extrapolate figures.',
    '- Check data before answering. Prefer synced tools (fast); use ga4_live_report / gsc_live_query when the question needs dimensions the synced data lacks (source/medium, campaign, device, city, hostname, or joint slices like country x channel).',
    '- Synced data lags: GA4 about 1 day, Search Console 3-4 days. Live tools reach fresher and historical data.',
    '- Pages rank for queries; queries do not rank or climb. Never phrase it backwards.',
    '- When you cite figures, state the date or window they cover.',
    '- Copy dates exactly as YYYY-MM-DD from tool results; when writing a date in words, re-derive the month from the ISO string. Never cite a date later than today - if tool data seems to contain one, call it out as a data-quality problem instead of using it.',
    '- Before finalizing, verify every figure and date in your answer matches the tool results exactly.',
    '- Name the source for every figure (GA4, Search Console, or Clarity). Sources measure different things: Search Console counts clicks from Google Search only, while GA4 Organic Search counts sessions from all search engines (Google, Bing, DuckDuckGo, etc.) - so zero Search Console clicks alongside some GA4 organic sessions is normal, not a contradiction. Query-level Search Console data also excludes anonymized long-tail queries, so per-query sums can undercount the page total.',
    '- If figures from two sources appear to conflict, never place them side by side without a one-sentence reconciliation explaining why both can be true.',
    '- If no available tool can answer, say so plainly and tell the user exactly where to look instead (GA4, Search Console, or Clarity dashboard - Clarity element-level detail like which element was clicked is dashboard-only).',
    '- Be concise and practical. Plain text only, no markdown headers or bullets unless asked. Suggestions are recommendations to verify, not guarantees.',
  ];
  if (insightBlock) parts.push('THIS THREAD IS ABOUT A SPECIFIC PLATFORM INSIGHT:\n' + insightBlock);
  return parts.join('\n');
}

export async function POST(req: Request) {
  let chatId: string | undefined, message = '', insightId: string | undefined;
  try {
    const b = (await req.json()) as { chatId?: unknown; message?: unknown; insightId?: unknown };
    if (typeof b.chatId === 'string') chatId = b.chatId;
    if (typeof b.message === 'string') message = b.message.trim().slice(0, 2000);
    if (typeof b.insightId === 'string') insightId = b.insightId;
  } catch {
    /* invalid body */
  }
  if (!message) return NextResponse.json({ error: 'message is required' }, { status: 400 });

  let email: string | null = null;
  try {
    const auth = await createSupabaseServer();
    const { data: { user } } = await auth.auth.getUser();
    email = user?.email ?? null;
  } catch {
    /* no session */
  }
  if (!email) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const supabase = getSupabaseAdmin();
  const { data: wsData } = await supabase.from('workspaces').select('id').limit(1);
  const workspaceId = (wsData ?? [])[0]?.id as string | undefined;
  if (!workspaceId) return NextResponse.json({ error: 'no workspace' }, { status: 500 });

  let chat: ChatRow | null = null;
  if (chatId) {
    const { data } = await supabase
      .from('chats').select('id, user_email, title, insight_id')
      .eq('workspace_id', workspaceId).eq('id', chatId).limit(1);
    chat = ((data ?? []) as ChatRow[])[0] ?? null;
    if (!chat) return NextResponse.json({ error: 'chat not found' }, { status: 404 });
    if (chat.user_email !== email) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  } else {
    const { data, error } = await supabase
      .from('chats')
      .insert({ workspace_id: workspaceId, user_email: email, title: message.slice(0, 80), insight_id: insightId ?? null })
      .select('id, user_email, title, insight_id');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    chat = ((data ?? []) as ChatRow[])[0] ?? null;
    if (!chat) return NextResponse.json({ error: 'could not create chat' }, { status: 500 });
  }

  const { data: histData } = await supabase
    .from('chat_messages').select('role, content')
    .eq('chat_id', chat.id).order('created_at', { ascending: false }).limit(14);
  const history = (((histData ?? []) as MsgRow[])).reverse();

  await supabase.from('chat_messages').insert({ chat_id: chat.id, role: 'user', content: message });

  let insightBlock: string | null = null;
  if (chat.insight_id) {
    const { data } = await supabase
      .from('insights')
      .select('title, narrative, evidence, category, severity, polarity, detector')
      .eq('workspace_id', workspaceId).eq('id', chat.insight_id).limit(1);
    const ins = ((data ?? []) as Array<Record<string, unknown>>)[0];
    if (ins) insightBlock = JSON.stringify(ins);
  }

  const msgs: Anthropic.MessageParam[] = [
    ...history.map((m) => ({ role: m.role, content: m.content } as Anthropic.MessageParam)),
    { role: 'user', content: message },
  ];

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const system = buildSystem(insightBlock);
  const trace: ToolTrace[] = [];
  let finalText = '';

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const lastRound = round === MAX_TOOL_ROUNDS;
      const resp = await client.messages.create({
        model: MODEL,
        max_tokens: 1600,
        temperature: 0,
        system,
        messages: msgs,
        ...(lastRound ? {} : { tools: CHAT_TOOLS }),
      });

      const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      const text = resp.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();

      if (resp.stop_reason !== 'tool_use' || toolUses.length === 0) {
        finalText = text;
        break;
      }

      msgs.push({ role: 'assistant', content: resp.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        let result = '';
        let isError = false;
        try {
          result = await runChatTool({ supabase, workspaceId }, tu.name, tu.input);
        } catch (e) {
          isError = true;
          result = JSON.stringify({ error: e instanceof Error ? e.message : 'tool failed' });
        }
        trace.push({ name: tu.name, args: JSON.stringify(tu.input).slice(0, 160), result: result.slice(0, 6000) });
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: result, ...(isError ? { is_error: true } : {}) });
      }
      msgs.push({ role: 'user', content: results });
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'model call failed';
    return NextResponse.json({ error: detail }, { status: 500 });
  }

  if (!finalText) finalText = 'I could not finish analyzing that within the time limit - try asking a narrower question.';

  await supabase.from('chat_messages').insert({
    chat_id: chat.id, role: 'assistant', content: finalText, tools: trace.length ? trace : null,
  });
  await supabase.from('chats').update({ updated_at: new Date().toISOString() }).eq('id', chat.id);

  return NextResponse.json({ ok: true, chatId: chat.id, reply: finalText, tools: trace, title: chat.title });
}

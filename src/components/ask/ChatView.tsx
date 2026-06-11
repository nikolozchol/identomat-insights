'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Plus, Trash2, Check, X, Send, Sparkles } from 'lucide-react';

export type ThreadMeta = { id: string; title: string; insight_id: string | null; updated_at: string };
export type ChatMsg = {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  tools?: { name: string; args: string; result?: string }[] | null;
};

const SUGGESTIONS = [
  'Which channels drove the most demo requests in the last 28 days?',
  'Did any country spike unusually recently — and what caused it?',
  'What are our top search queries, and which pages do they land on?',
];

function prettyResult(r?: string): string {
  if (!r) return '(no result stored)';
  try { return JSON.stringify(JSON.parse(r), null, 1); } catch { return r; }
}

function ToolChips({ tools }: { tools?: { name: string; args: string; result?: string }[] | null }) {
  const [showRaw, setShowRaw] = useState(false);
  if (!tools || tools.length === 0) return null;
  const names = [...new Set(tools.map((t) => t.name))];
  const hasRaw = tools.some((t) => t.result);
  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10.5px] uppercase tracking-wide text-fg-3">data checked</span>
        {names.map((n) => (
          <span key={n} className="rounded-[6px] bg-surface-2 px-1.5 py-0.5 font-mono text-[10.5px] text-fg-3">{n}</span>
        ))}
        {hasRaw && (
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="text-[10.5px] text-fg-3 underline underline-offset-2 transition-colors hover:text-fg-2"
          >
            {showRaw ? 'hide raw data' : 'view raw data'}
          </button>
        )}
      </div>
      {showRaw && (
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-[8px] border border-border bg-canvas p-2.5 font-mono text-[10.5px] leading-relaxed text-fg-3">
{tools.map((t) => `# ${t.name}  ${t.args}\n${prettyResult(t.result)}`).join('\n\n')}
        </pre>
      )}
    </div>
  );
}

function Bubble({ m }: { m: ChatMsg }) {
  const mine = m.role === 'user';
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-[var(--radius-card)] border px-3.5 py-2.5 text-[13.5px] leading-relaxed ${
          mine ? 'border-iris-border bg-iris-dim text-fg' : 'border-border bg-surface text-fg-2'
        }`}
      >
        <div className="whitespace-pre-wrap">{m.content}</div>
        {!mine && <ToolChips tools={m.tools} />}
      </div>
    </div>
  );
}

export function ChatView({
  threads,
  activeChatId,
  initialMessages,
  insightSeed,
}: {
  threads: ThreadMeta[];
  activeChatId: string | null;
  initialMessages: ChatMsg[];
  insightSeed: { id: string; title: string } | null;
}) {
  const router = useRouter();
  const [chatId, setChatId] = useState<string | null>(activeChatId);
  const [localThreads, setLocalThreads] = useState<ThreadMeta[]>(threads);
  const [messages, setMessages] = useState<ChatMsg[]>(initialMessages);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, busy]);

  async function send(text: string) {
    const msg = text.trim();
    if (!msg || busy) return;
    setError(null);
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: msg }]);
    setBusy(true);
    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId: chatId ?? undefined,
          message: msg,
          insightId: !chatId && insightSeed ? insightSeed.id : undefined,
        }),
      });
      const d = (await res.json()) as { ok?: boolean; chatId?: string; reply?: string; tools?: { name: string; args: string }[]; title?: string; error?: string };
      if (res.ok && d.ok && d.reply) {
        if (!chatId && d.chatId) {
          setChatId(d.chatId);
          window.history.replaceState(null, '', `/ask?chat=${d.chatId}`);
          setLocalThreads((t) => [
            { id: d.chatId as string, title: d.title ?? msg.slice(0, 80), insight_id: insightSeed?.id ?? null, updated_at: new Date().toISOString() },
            ...t,
          ]);
        }
        setMessages((m) => [...m, { role: 'assistant', content: d.reply as string, tools: d.tools ?? null }]);
      } else {
        setError(d.error ?? 'Something went wrong — try again.');
      }
    } catch {
      setError('Something went wrong — try again.');
    } finally {
      setBusy(false);
    }
  }

  async function removeThread(id: string) {
    try {
      const res = await fetch('/api/chat/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const d = (await res.json()) as { ok?: boolean };
      if (res.ok && d.ok) {
        setLocalThreads((t) => t.filter((x) => x.id !== id));
        setConfirmDel(null);
        if (id === chatId) {
          router.push('/ask');
          router.refresh();
        }
      }
    } catch {
      setConfirmDel(null);
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl gap-5 px-6 py-6">
      <aside className="hidden w-60 flex-none flex-col gap-2 sm:flex">
        <Link
          href="/ask"
          className="inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-ctl)] border border-iris-border bg-iris-dim px-3 py-2 text-[12.5px] font-medium text-iris-bright transition-colors hover:bg-[rgba(124,108,255,0.22)]"
        >
          <Plus size={14} strokeWidth={2} /> New chat
        </Link>
        <div className="flex flex-col gap-0.5">
          {localThreads.map((t) => {
            const active = t.id === chatId;
            return (
              <div
                key={t.id}
                className={`group flex items-center gap-1.5 rounded-[var(--radius-ctl)] px-2.5 py-2 text-[12.5px] transition-colors ${
                  active ? 'bg-iris-dim text-fg' : 'text-fg-2 hover:bg-surface hover:text-fg'
                }`}
              >
                <Link href={`/ask?chat=${t.id}`} className="min-w-0 flex-1 truncate" title={t.title}>
                  {t.title}
                </Link>
                {confirmDel === t.id ? (
                  <span className="flex flex-none items-center gap-1">
                    <button type="button" aria-label="Confirm delete" onClick={() => void removeThread(t.id)} className="rounded p-0.5 text-down hover:text-fg">
                      <Check size={12} strokeWidth={2.5} />
                    </button>
                    <button type="button" aria-label="Cancel delete" onClick={() => setConfirmDel(null)} className="rounded p-0.5 text-fg-3 hover:text-fg">
                      <X size={12} strokeWidth={2.5} />
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    aria-label={`Delete ${t.title}`}
                    onClick={() => setConfirmDel(t.id)}
                    className="flex-none rounded p-0.5 text-fg-3 opacity-0 transition-opacity hover:text-down group-hover:opacity-100"
                  >
                    <Trash2 size={12} strokeWidth={2} />
                  </button>
                )}
              </div>
            );
          })}
          {localThreads.length === 0 && (
            <div className="px-2.5 py-2 text-[12px] text-fg-3">No chats yet.</div>
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex items-baseline gap-2">
          <h1 className="text-[18px] font-medium tracking-[-0.01em] text-fg">Ask AI</h1>
          <span className="font-mono text-[12px] text-fg-3">answers computed from your data</span>
        </div>

        {insightSeed && !chatId && (
          <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-iris-border bg-iris-dim px-3.5 py-2.5 text-[12.5px] text-fg">
            <Sparkles size={13} strokeWidth={2} className="flex-none text-iris-bright" />
            <span className="truncate">About insight: {insightSeed.title}</span>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {messages.length === 0 && !busy && (
            <div className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
              <div className="text-[13.5px] text-fg-2">
                Ask anything about traffic, search, conversions, or page behavior. I check your synced data first and can query GA4 and Search Console live for deeper slices.
              </div>
              <div className="mt-3 flex flex-col items-start gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className="rounded-[var(--radius-ctl)] border border-border bg-surface-2 px-2.5 py-1.5 text-left text-[12.5px] text-fg-2 transition-colors hover:border-iris-border hover:text-fg"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <Bubble key={m.id ?? i} m={m} />
          ))}

          {busy && (
            <div className="flex justify-start">
              <div className="rounded-[var(--radius-card)] border border-border bg-surface px-3.5 py-2.5 text-[12.5px] text-fg-3">
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-iris" />
                  Checking your data — live GA4/GSC questions can take up to a minute.
                </span>
              </div>
            </div>
          )}

          {error && <div className="text-[12.5px] text-down">{error}</div>}
          <div ref={endRef} />
        </div>

        <div className="sticky bottom-4">
          <div className="relative rounded-[var(--radius-card)] border border-border bg-surface-2 shadow-lg">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              rows={2}
              placeholder={insightSeed && !chatId ? 'Ask anything about this insight…' : 'Ask about your traffic, search, or conversions…'}
              aria-label="Message"
              className="w-full resize-none bg-transparent py-3 pl-3.5 pr-12 text-[13.5px] text-fg outline-none placeholder:text-fg-3"
            />
            <button
              type="button"
              onClick={() => void send(input)}
              disabled={busy || !input.trim()}
              aria-label="Send"
              className="absolute bottom-2.5 right-2.5 rounded-[var(--radius-ctl)] border border-iris-border bg-iris-dim p-2 text-iris-bright transition-colors hover:bg-[rgba(124,108,255,0.22)] disabled:opacity-50"
            >
              <Send size={14} strokeWidth={2} />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

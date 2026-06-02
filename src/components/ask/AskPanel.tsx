'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Sparkles, ListChecks, Check, ArrowUpRight } from 'lucide-react';
import type { AskResult } from '../../lib/ask';

export type RecentQuestion = {
  id: string;
  question: string;
  answer: string | null;
  confidence: string | null;
  created_at: string;
};

type CitedInsight = { id: string; title: string; severity: string; polarity: string; category: string };
type AskResponse = AskResult & { citedInsights: CitedInsight[] };
type Suggestion = AskResult['actionSuggestions'][number];

const EXAMPLES = [
  'What are my biggest opportunities right now?',
  'Why might conversions be dropping?',
  'How is the pricing page performing?',
  'Which search queries are losing clicks?',
];

const INTENT_LABEL: Record<string, string> = {
  page_diagnosis: 'Page diagnosis',
  biggest_opportunities: 'Opportunities',
  page_metrics: 'Page metrics',
  query_performance: 'Query performance',
  unknown: 'General',
};

const SEV_COLOR: Record<string, string> = {
  critical: 'var(--color-crit)',
  high: 'var(--color-high)',
  medium: 'var(--color-med)',
  low: 'var(--color-low)',
};

function ConfidencePill({ c }: { c: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    high: { label: 'High confidence', cls: 'text-up bg-[rgba(67,192,138,0.12)]' },
    medium: { label: 'Medium confidence', cls: 'text-med bg-[rgba(217,192,78,0.12)]' },
    low: { label: 'Low confidence', cls: 'text-high bg-[rgba(240,161,66,0.12)]' },
    'n/a': { label: 'Unrated', cls: 'text-fg-3 bg-surface-2' },
  };
  const m = map[c] ?? map['n/a'];
  return <span className={`flex-none rounded-full px-2 py-0.5 text-[11px] font-medium ${m.cls}`}>{m.label}</span>;
}

export function AskPanel({ recent }: { recent: RecentQuestion[] }) {
  const router = useRouter();
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AskResponse | null>(null);

  const [converted, setConverted] = useState<Set<string>>(new Set());
  const [converting, setConverting] = useState<Set<string>>(new Set());
  const [convertFailed, setConvertFailed] = useState<Set<string>>(new Set());

  async function ask(q: string) {
    const query = q.trim();
    if (!query || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: query }),
      });
      const data = (await res.json()) as AskResponse & { error?: string };
      if (res.ok && !data.error) {
        setResult(data);
        router.refresh();
      } else {
        setError(data.error || 'Something went wrong.');
      }
    } catch {
      setError('Network error — please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function convert(insightId: string) {
    setConvertFailed((prev) => {
      const n = new Set(prev);
      n.delete(insightId);
      return n;
    });
    setConverting((prev) => new Set(prev).add(insightId));
    try {
      const res = await fetch('/api/actions/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ insightId }),
      });
      const data = (await res.json()) as { ok?: boolean; noop?: boolean };
      if (res.ok && (data.ok || data.noop)) {
        setConverted((prev) => new Set(prev).add(insightId));
      } else {
        setConvertFailed((prev) => new Set(prev).add(insightId));
      }
    } catch {
      setConvertFailed((prev) => new Set(prev).add(insightId));
    } finally {
      setConverting((prev) => {
        const n = new Set(prev);
        n.delete(insightId);
        return n;
      });
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-6 py-6">
      <div>
        <h1 className="text-[18px] font-medium tracking-[-0.01em] text-fg">Ask AI</h1>
        <p className="mt-1 text-[13px] text-fg-2">
          Ask about your traffic, pages, queries, or conversions — answers are grounded in your own data.
        </p>
      </div>

      <div className="rounded-[var(--radius-card)] border border-border bg-surface p-3">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              ask(question);
            }
          }}
          rows={2}
          placeholder="e.g. Why did demo requests drop last week?"
          className="w-full resize-none bg-transparent px-2 py-1 text-[14px] text-fg placeholder:text-fg-3 focus:outline-none"
        />
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="px-2 text-[11px] text-fg-3">Enter to ask · Shift+Enter for a new line</span>
          <button
            type="button"
            onClick={() => ask(question)}
            disabled={loading || !question.trim()}
            className="inline-flex flex-none items-center gap-1.5 rounded-[var(--radius-ctl)] bg-iris px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-iris-bright disabled:opacity-50"
          >
            <Sparkles size={14} strokeWidth={2} />
            {loading ? 'Thinking…' : 'Ask'}
          </button>
        </div>
      </div>

      {!result && !loading && (
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => {
                setQuestion(ex);
                ask(ex);
              }}
              className="rounded-full border border-border bg-surface px-3 py-1.5 text-[12.5px] text-fg-2 transition-colors hover:border-border-strong hover:text-fg"
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-4 text-[13px] text-down">{error}</div>
      )}

      {loading && (
        <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-5">
          <div className="h-3 w-1/3 animate-pulse rounded bg-surface-2" />
          <div className="h-3 w-full animate-pulse rounded bg-surface-2" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-surface-2" />
        </div>
      )}

      {result && (
        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
          <div className="flex items-center gap-2">
            <Sparkles size={14} strokeWidth={2} className="text-iris-bright" />
            <span className="text-[11px] font-medium uppercase tracking-wider text-fg-3">
              {INTENT_LABEL[result.intent] ?? 'Answer'}
            </span>
            <span className="ml-auto" />
            <ConfidencePill c={result.confidence} />
          </div>

          <p className="mt-3 whitespace-pre-wrap text-[14px] leading-relaxed text-fg">{result.answer}</p>

          {!result.found && (
            <p className="mt-2 text-[12px] text-fg-3">
              I couldn’t find specific figures for this, so this is a best-effort answer from what’s available.
            </p>
          )}

          {result.citedInsights.length > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <div className="text-[11px] font-medium uppercase tracking-wider text-fg-3">Grounded in</div>
              <div className="mt-2 flex flex-col gap-1">
                {result.citedInsights.map((ci) => (
                  <Link
                    key={ci.id}
                    href={`/#insight-${ci.id}`}
                    className="group flex items-center gap-2.5 rounded-[var(--radius-ctl)] px-2 py-1.5 transition-colors hover:bg-surface-2"
                  >
                    <span
                      className="h-2 w-2 flex-none rounded-full"
                      style={{ backgroundColor: SEV_COLOR[ci.severity] ?? 'var(--color-low)' }}
                    />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-fg-2 group-hover:text-fg">{ci.title}</span>
                    <ArrowUpRight size={13} strokeWidth={2} className="flex-none text-fg-3 opacity-0 group-hover:opacity-100" />
                  </Link>
                ))}
              </div>
            </div>
          )}

          {result.actionSuggestions.length > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <div className="text-[11px] font-medium uppercase tracking-wider text-fg-3">Suggested actions</div>
              <div className="mt-2 flex flex-col gap-2">
                {result.actionSuggestions.map((s: Suggestion) => {
                  const isConverted = converted.has(s.insight_id);
                  const isConverting = converting.has(s.insight_id);
                  const isFailed = convertFailed.has(s.insight_id);
                  return (
                    <div key={s.insight_id} className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 flex-none rounded-full"
                        style={{ backgroundColor: SEV_COLOR[s.severity] ?? 'var(--color-low)' }}
                      />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-fg-2">{s.title}</span>
                      {isConverted ? (
                        <span className="inline-flex flex-none items-center gap-1.5 text-[12px] font-medium text-up">
                          <Check size={13} strokeWidth={2.5} /> In queue
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => convert(s.insight_id)}
                          disabled={isConverting}
                          className="inline-flex flex-none items-center gap-1.5 rounded-[var(--radius-ctl)] border border-iris-border bg-iris-dim px-2.5 py-1 text-[12px] font-medium text-iris-bright transition-colors hover:bg-[rgba(124,108,255,0.22)] disabled:opacity-60"
                        >
                          <ListChecks size={12} strokeWidth={2} />
                          {isConverting ? 'Adding…' : isFailed ? 'Retry' : 'Convert to action'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {recent.length > 0 && (
        <div className="mt-2">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-fg-3">Recent questions</div>
          <div className="flex flex-col gap-2">
            {recent.map((q) => (
              <button
                key={q.id}
                type="button"
                onClick={() => {
                  setQuestion(q.question);
                  ask(q.question);
                }}
                className="rounded-[var(--radius-card)] border border-border bg-surface p-3 text-left transition-colors hover:border-border-strong"
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">{q.question}</span>
                  {q.confidence && <ConfidencePill c={q.confidence} />}
                </div>
                {q.answer && <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-fg-3">{q.answer}</p>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

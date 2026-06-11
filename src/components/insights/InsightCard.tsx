'use client';

import { useState } from 'react';
import { Check, ListChecks, MoreHorizontal, Clock, X } from 'lucide-react';
import type { InsightRow, Polarity } from './types';
import { SEV_VAR } from './types';
import { InsightElaborate } from './InsightElaborate';

export type MuteKind = 'snooze' | 'dismiss';

const POL_STYLE: Record<Polarity, { label: string; cls: string }> = {
  issue: { label: 'Issue', cls: 'text-crit bg-[rgba(255,107,107,0.12)]' },
  opportunity: { label: 'Opportunity', cls: 'text-iris-bright bg-iris-dim' },
  win: { label: 'Win', cls: 'text-up bg-[rgba(67,192,138,0.12)]' },
};

function fmt(v: unknown): string {
  if (typeof v === 'number') {
    return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (typeof v === 'string') return v;
  if (v == null) return '—';
  return JSON.stringify(v);
}

// Mirrors generateActions' selection: issue/opportunity at high/medium severity.
export function qualifiesForAction(i: InsightRow): boolean {
  return (i.polarity === 'issue' || i.polarity === 'opportunity') && (i.severity === 'high' || i.severity === 'medium');
}

export function InsightCard({
  i,
  highlighted,
  converted,
  converting,
  failed,
  onConvert,
  onMute,
}: {
  i: InsightRow;
  highlighted: boolean;
  converted: boolean;
  converting: boolean;
  failed: boolean;
  onConvert: (id: string) => void;
  onMute: (id: string, kind: MuteKind) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const sevVar = SEV_VAR[i.severity] ?? 'var(--color-low)';
  const pol = POL_STYLE[i.polarity ?? 'issue'];
  const ev = Object.entries(i.evidence ?? {}).slice(0, 4);

  return (
    <article
      id={`insight-${i.id}`}
      style={{ borderLeftColor: sevVar }}
      className={`scroll-mt-20 rounded-[var(--radius-card)] border border-l-2 border-border bg-surface p-4 transition-all ${
        highlighted ? 'ring-2 ring-iris-border' : ''
      }`}
    >
      <div className="flex items-center gap-2 text-[11px]">
        <span className={`rounded-full px-2 py-0.5 font-medium ${pol.cls}`}>{pol.label}</span>
        <span className="text-fg-3">{i.category}</span>
        <span className="text-fg-3">·</span>
        <span className="font-mono text-fg-3">{i.detector}</span>
        <div className="relative ml-auto flex items-center gap-1.5">
          <span className="font-medium uppercase tracking-wide" style={{ color: sevVar }}>
            {i.severity}
          </span>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="More options"
            className="rounded p-0.5 text-fg-3 transition-colors hover:text-fg-2"
          >
            <MoreHorizontal size={15} strokeWidth={2} />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-6 z-20 w-40 overflow-hidden rounded-[var(--radius-ctl)] border border-border-strong bg-elevated py-1 shadow-lg">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onMute(i.id, 'snooze');
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg"
                >
                  <Clock size={13} strokeWidth={2} /> Snooze 7 days
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onMute(i.id, 'dismiss');
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg"
                >
                  <X size={13} strokeWidth={2} /> Dismiss
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      <h3 className="mt-2 text-[14.5px] font-medium leading-snug text-fg">{i.title}</h3>
      {i.narrative && <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg-2">{i.narrative}</p>}
      {ev.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {ev.map(([k, v]) => (
            <span key={k} className="rounded-[6px] bg-surface-2 px-2 py-1 font-mono text-[11px] text-fg-2">
              {k}: {fmt(v)}
            </span>
          ))}
        </div>
      )}
      {i.sources && i.sources.length > 0 && <div className="mt-2 text-[11px] text-fg-3">via {i.sources.join(', ')}</div>}

      <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
        {qualifiesForAction(i) && (
          <div className="flex items-center gap-2">
            {converted ? (
              <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-up">
                <Check size={13} strokeWidth={2.5} /> In action queue
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onConvert(i.id)}
                disabled={converting}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-ctl)] border border-iris-border bg-iris-dim px-2.5 py-1.5 text-[12px] font-medium text-iris-bright transition-colors hover:bg-[rgba(124,108,255,0.22)] disabled:opacity-60"
              >
                <ListChecks size={13} strokeWidth={2} />
                {converting ? 'Adding…' : failed ? 'Retry — convert to action' : 'Convert to action'}
              </button>
            )}
            {failed && !converting && <span className="text-[11px] text-down">Something went wrong</span>}
          </div>
        )}
        <InsightElaborate
          insightId={i.id}
          offerConvert={(i.polarity === 'issue' || i.polarity === 'opportunity') && !qualifiesForAction(i)}
          askHref={`/ask?insight=${i.id}`}
        />
      </div>
    </article>
  );
}

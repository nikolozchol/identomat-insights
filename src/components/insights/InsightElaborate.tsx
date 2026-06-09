'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, ChevronDown, Database, Lightbulb, Wrench, ListChecks, Check } from 'lucide-react';

type Sections = { data_shows: string[]; likely_drivers: string[]; suggestions: string[] };
type Result = {
  ok: boolean;
  metrics: { label: string; value: string }[];
  actioned: boolean;
  sections: Sections | null;
  note?: string;
};
type ConvertState = 'idle' | 'converting' | 'converted' | 'failed';

function Section({ icon, title, items }: { icon: React.ReactNode; title: string; items: string[] }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-3">
        {icon}
        {title}
      </div>
      <ul className="flex flex-col gap-1">
        {items.map((t, i) => (
          <li key={i} className="flex gap-1.5 text-[12.5px] leading-relaxed text-fg-2">
            <span className="select-none text-fg-3">–</span>
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function InsightElaborate({ insightId, offerConvert }: { insightId: string; offerConvert: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState(false);
  const [convert, setConvert] = useState<ConvertState>('idle');

  async function load() {
    setLoading(true);
    setError(false);
    setData(null);
    try {
      const res = await fetch('/api/insights/elaborate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ insightId }),
      });
      const d = (await res.json()) as Result;
      if (res.ok && d.ok) {
        setData(d);
        setConvert(d.actioned ? 'converted' : 'idle');
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    if (open) {
      setOpen(false);
      setData(null);
      setError(false);
      return;
    }
    setOpen(true);
    void load();
  }

  async function onConvert() {
    setConvert('converting');
    try {
      const res = await fetch('/api/actions/from-insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ insightId }),
      });
      const d = (await res.json()) as { ok?: boolean; already?: boolean };
      if (res.ok && d.ok) {
        setConvert('converted');
        router.refresh();
      } else {
        setConvert('failed');
      }
    } catch {
      setConvert('failed');
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-[12px] font-medium text-fg-2 transition-colors hover:text-fg"
      >
        <Sparkles size={13} strokeWidth={2} className="text-iris-bright" />
        {open ? 'Hide details' : 'Go deeper'}
        <ChevronDown size={13} strokeWidth={2} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-3">
          {loading && (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-4 animate-pulse rounded bg-surface-2" />
              ))}
            </div>
          )}

          {error && (
            <p className="text-[12.5px] text-down">
              Couldn’t generate a deep dive.{' '}
              <button type="button" onClick={load} className="underline underline-offset-2 hover:text-fg-2">
                Try again
              </button>
              .
            </p>
          )}

          {data && (
            <div className="flex flex-col gap-3.5">
              {data.metrics.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {data.metrics.map((m) => (
                    <span key={m.label} className="rounded-[6px] bg-surface-2 px-2 py-1 font-mono text-[11px] text-fg-3">
                      {m.label}: <span className="text-fg-2">{m.value}</span>
                    </span>
                  ))}
                </div>
              )}

              {data.sections ? (
                <>
                  {data.sections.data_shows.length > 0 && (
                    <Section icon={<Database size={13} strokeWidth={2} className="text-iris-bright" />} title="What the data shows" items={data.sections.data_shows} />
                  )}
                  {data.sections.likely_drivers.length > 0 && (
                    <Section icon={<Lightbulb size={13} strokeWidth={2} className="text-high" />} title="Likely drivers — to verify" items={data.sections.likely_drivers} />
                  )}
                  {data.sections.suggestions.length > 0 && (
                    <Section icon={<Wrench size={13} strokeWidth={2} className="text-up" />} title="What to try" items={data.sections.suggestions} />
                  )}
                </>
              ) : (
                <p className="text-[12.5px] leading-relaxed text-fg-2">{data.note}</p>
              )}

              {offerConvert && (
                <div>
                  {convert === 'converted' ? (
                    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-up">
                      <Check size={13} strokeWidth={2.5} /> In action queue
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={onConvert}
                      disabled={convert === 'converting'}
                      className="inline-flex items-center gap-1.5 rounded-[var(--radius-ctl)] border border-iris-border bg-iris-dim px-2.5 py-1.5 text-[12px] font-medium text-iris-bright transition-colors hover:bg-[rgba(124,108,255,0.22)] disabled:opacity-60"
                    >
                      <ListChecks size={13} strokeWidth={2} />
                      {convert === 'converting' ? 'Adding…' : convert === 'failed' ? 'Retry — convert to action' : 'Convert to action'}
                    </button>
                  )}
                  {convert === 'failed' && <span className="ml-2 text-[11px] text-down">Something went wrong</span>}
                </div>
              )}

              <p className="text-[10.5px] leading-relaxed text-fg-3">
                Metrics are computed from your data. Drivers and suggestions are AI-generated from those metrics — verify before acting.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

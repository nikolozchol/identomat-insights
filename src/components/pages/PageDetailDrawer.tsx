'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import type { PageRow } from './PagesTable';
import { ConvertActionButton, actionQualifies } from '../insights/ConvertActionButton';

const SEV_COLOR: Record<string, string> = {
  critical: 'var(--color-crit)', high: 'var(--color-high)', medium: 'var(--color-med)', low: 'var(--color-low)',
};

function fmtTime(s: number): string {
  if (!s || s < 1) return '0s';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-ctl)] border border-border bg-surface px-3 py-2.5">
      <div className="text-[10.5px] uppercase tracking-wider text-fg-3">{label}</div>
      <div className="mt-0.5 text-[16px] font-semibold text-fg">{value}</div>
    </div>
  );
}

export function PageDetailDrawer({
  page,
  onClose,
  actionedIds,
}: {
  page: PageRow;
  onClose: () => void;
  actionedIds?: Set<string>;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const c = page.clarity;

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute right-0 top-0 z-50 flex h-full w-full max-w-[480px] flex-col overflow-y-auto border-l border-border bg-canvas">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-canvas px-5 py-4">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-fg-3">Page</div>
            <div className="mt-0.5 break-all font-mono text-[13px] text-fg">{page.page_path}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex-none rounded p-1 text-fg-3 transition-colors hover:text-fg">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-5 px-5 py-5">
          <section>
            <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-fg-3">Traffic &amp; search</h3>
            <div className="grid grid-cols-2 gap-2">
              <Metric label="Sessions" value={page.sessions.toLocaleString()} />
              <Metric label="Engaged %" value={`${page.engagedPct.toFixed(0)}%`} />
              <Metric label="Search clicks" value={page.clicks.toLocaleString()} />
              <Metric label="Impressions" value={page.impressions.toLocaleString()} />
              <Metric label="Avg position" value={page.avgPosition == null ? '—' : page.avgPosition.toFixed(1)} />
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-fg-3">Behavior · Microsoft Clarity</h3>
            {c ? (
              <div className="grid grid-cols-2 gap-2">
                <Metric label="Rage clicks" value={`${c.ragePct.toFixed(1)}%`} />
                <Metric label="Dead clicks" value={`${c.deadPct.toFixed(1)}%`} />
                <Metric label="Quick-back" value={`${c.quickBackPct.toFixed(1)}%`} />
                <Metric label="JS errors" value={`${c.jsErrorPct.toFixed(1)}%`} />
                <Metric label="Avg scroll depth" value={`${c.scrollDepth.toFixed(0)}%`} />
                <Metric label="Avg time" value={fmtTime(c.avgTime)} />
              </div>
            ) : (
              <p className="text-[13px] text-fg-3">No Clarity data recorded for this page in the window.</p>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-fg-3">Insights ({page.insights.length})</h3>
            {page.insights.length ? (
              <div className="flex flex-col gap-2">
                {page.insights.map((i) => (
                  <div key={i.id} className="rounded-[var(--radius-ctl)] border border-border bg-surface p-3">
                    <Link href={`/#insight-${i.id}`} className="block transition-opacity hover:opacity-90">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 flex-none rounded-full" style={{ backgroundColor: SEV_COLOR[i.severity] ?? 'var(--color-low)' }} />
                        <span className="text-[13px] font-medium text-fg">{i.title}</span>
                      </div>
                      {i.narrative && <p className="mt-1 text-[12.5px] leading-relaxed text-fg-2">{i.narrative}</p>}
                    </Link>
                    {actionQualifies(i.polarity, i.severity) && (
                      <div className="mt-2.5 border-t border-border pt-2.5">
                        <ConvertActionButton
                          insightId={i.id}
                          polarity={i.polarity}
                          severity={i.severity}
                          initiallyConverted={actionedIds?.has(i.id) ?? false}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-fg-3">No active findings for this page.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

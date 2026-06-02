'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ConvertActionButton, actionQualifies } from '../insights/ConvertActionButton';
import { HeatmapStudio } from './HeatmapStudio';

export type BehaviorRow = {
  page_path: string;
  sessions: number;
  ragePct: number;
  deadPct: number;
  quickBackPct: number;
  jsErrorPct: number;
  scrollDepth: number;
  avgTime: number;
};
export type BehaviorInsight = { id: string; severity: string; polarity: string; title: string; narrative: string | null };

type SortKey = 'sessions' | 'ragePct' | 'deadPct' | 'quickBackPct' | 'jsErrorPct' | 'scrollDepth' | 'avgTime';
const FRICTION: SortKey[] = ['ragePct', 'deadPct', 'quickBackPct', 'jsErrorPct'];

const SEV_COLOR: Record<string, string> = {
  critical: 'var(--color-crit)', high: 'var(--color-high)', medium: 'var(--color-med)', low: 'var(--color-low)',
};

function fmtTime(s: number): string {
  if (!s || s < 1) return '0s';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-fg-3">{label}</div>
      <div className="mt-1 text-[20px] font-semibold tracking-[-0.01em] text-fg">{value}</div>
    </div>
  );
}

function SortTh({ label, k, sortKey, dir, onSort }: {
  label: string; k: SortKey; sortKey: SortKey; dir: 'asc' | 'desc'; onSort: (k: SortKey) => void;
}) {
  const active = k === sortKey;
  return (
    <th className="px-3 py-2.5 text-right font-medium">
      <button type="button" onClick={() => onSort(k)} className={`inline-flex items-center gap-1 transition-colors ${active ? 'text-fg-2' : 'hover:text-fg-2'}`}>
        {label}
        <span className="text-[9px] leading-none">{active ? (dir === 'desc' ? '▼' : '▲') : ''}</span>
      </button>
    </th>
  );
}

// Warm shading scaled to the worst value in each friction column.
function heat(v: number, max: number): string | undefined {
  if (!max || v <= 0) return undefined;
  const t = Math.min(1, v / max);
  return `rgba(255, 107, 107, ${(0.07 + 0.42 * t).toFixed(3)})`;
}

export function HeatmapsView({
  rows,
  findings,
  actionedIds,
  pagePaths,
}: {
  rows: BehaviorRow[];
  findings: BehaviorInsight[];
  actionedIds?: Set<string>;
  pagePaths: string[];
}) {
  const [sortKey, setSortKey] = useState<SortKey>('sessions');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');

  function onSort(k: SortKey) {
    if (k === sortKey) setDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setSortKey(k); setDir('desc'); }
  }

  const sorted = [...rows].sort((a, b) => (dir === 'desc' ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey]));
  const max: Record<SortKey, number> = {
    sessions: 0, ragePct: 0, deadPct: 0, quickBackPct: 0, jsErrorPct: 0, scrollDepth: 0, avgTime: 0,
  };
  for (const r of rows) for (const k of FRICTION) max[k] = Math.max(max[k], r[k]);

  const totalSessions = rows.reduce((s, r) => s + r.sessions, 0);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-6 py-6">
      <div>
        <h1 className="text-[18px] font-medium tracking-[-0.01em] text-fg">Heatmaps</h1>
        <p className="mt-1 text-[13px] text-fg-2">
          Behavioral friction across your pages, from Microsoft Clarity — warmer cells mean more friction.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Pages" value={rows.length.toLocaleString()} />
        <Stat label="Flagged behaviors" value={findings.length.toLocaleString()} />
        <Stat label="Sessions" value={totalSessions.toLocaleString()} />
      </div>

      <HeatmapStudio pagePaths={pagePaths} />

      {findings.length > 0 && (
        <section>
          <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-fg-3">Flagged behavior</h2>
          <div className="flex flex-col gap-2">
            {findings.map((f) => (
              <div key={f.id} className="rounded-[var(--radius-card)] border border-border bg-surface p-3">
                <Link href={`/#insight-${f.id}`} className="block transition-opacity hover:opacity-90">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 flex-none rounded-full" style={{ backgroundColor: SEV_COLOR[f.severity] ?? 'var(--color-low)' }} />
                    <span className="text-[13px] font-medium text-fg">{f.title}</span>
                  </div>
                  {f.narrative && <p className="mt-1 text-[12.5px] leading-relaxed text-fg-2">{f.narrative}</p>}
                </Link>
                {actionQualifies(f.polarity, f.severity) && (
                  <div className="mt-2.5 border-t border-border pt-2.5">
                    <ConvertActionButton
                      insightId={f.id}
                      polarity={f.polarity}
                      severity={f.severity}
                      initiallyConverted={actionedIds?.has(f.id) ?? false}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-fg-3">Per-page signals</h2>
        {rows.length === 0 ? (
          <div className="rounded-[var(--radius-card)] border border-border bg-surface p-6 text-center text-[14px] text-fg-2">
            No Clarity behavioral data for this period yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface text-left text-[11px] uppercase tracking-wider text-fg-3">
                  <th className="px-3 py-2.5 font-medium">Page</th>
                  <SortTh label="Sessions" k="sessions" sortKey={sortKey} dir={dir} onSort={onSort} />
                  <SortTh label="Rage" k="ragePct" sortKey={sortKey} dir={dir} onSort={onSort} />
                  <SortTh label="Dead" k="deadPct" sortKey={sortKey} dir={dir} onSort={onSort} />
                  <SortTh label="Quick-back" k="quickBackPct" sortKey={sortKey} dir={dir} onSort={onSort} />
                  <SortTh label="JS err" k="jsErrorPct" sortKey={sortKey} dir={dir} onSort={onSort} />
                  <SortTh label="Scroll" k="scrollDepth" sortKey={sortKey} dir={dir} onSort={onSort} />
                  <SortTh label="Avg time" k="avgTime" sortKey={sortKey} dir={dir} onSort={onSort} />
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.page_path} className="border-b border-border last:border-0">
                    <td className="px-3 py-2.5">
                      <div className="max-w-[240px] truncate font-mono text-[12px] text-fg" title={r.page_path}>{r.page_path}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-fg-2">{r.sessions.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-fg-2" style={{ backgroundColor: heat(r.ragePct, max.ragePct) }}>{r.ragePct.toFixed(1)}%</td>
                    <td className="px-3 py-2.5 text-right font-mono text-fg-2" style={{ backgroundColor: heat(r.deadPct, max.deadPct) }}>{r.deadPct.toFixed(1)}%</td>
                    <td className="px-3 py-2.5 text-right font-mono text-fg-2" style={{ backgroundColor: heat(r.quickBackPct, max.quickBackPct) }}>{r.quickBackPct.toFixed(1)}%</td>
                    <td className="px-3 py-2.5 text-right font-mono text-fg-2" style={{ backgroundColor: heat(r.jsErrorPct, max.jsErrorPct) }}>{r.jsErrorPct.toFixed(1)}%</td>
                    <td className="px-3 py-2.5 text-right font-mono text-fg-2">{r.scrollDepth.toFixed(0)}%</td>
                    <td className="px-3 py-2.5 text-right font-mono text-fg-2">{fmtTime(r.avgTime)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

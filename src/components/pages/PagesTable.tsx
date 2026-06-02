'use client';

import { useState } from 'react';
import { PageDetailDrawer } from './PageDetailDrawer';

export type PageClarity = {
  sessions: number; ragePct: number; deadPct: number; quickBackPct: number; jsErrorPct: number; scrollDepth: number; avgTime: number;
};
export type PageInsight = { id: string; severity: string; polarity: string; title: string; narrative: string | null };
export type PageRow = {
  page_path: string;
  sessions: number;
  engagedPct: number;
  clicks: number;
  impressions: number;
  avgPosition: number | null;
  clarity: PageClarity | null;
  insights: PageInsight[];
};
type SortKey = 'sessions' | 'engagedPct' | 'clicks' | 'impressions' | 'avgPosition';

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
    <th className="px-4 py-2.5 text-right font-medium">
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 transition-colors ${active ? 'text-fg-2' : 'hover:text-fg-2'}`}
      >
        {label}
        <span className="text-[9px] leading-none">{active ? (dir === 'desc' ? '▼' : '▲') : ''}</span>
      </button>
    </th>
  );
}

export function PagesTable({ pages, actionedInsightIds = [] }: { pages: PageRow[]; actionedInsightIds?: string[] }) {
  const actionedIds = new Set(actionedInsightIds);
  const [sortKey, setSortKey] = useState<SortKey>('sessions');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [selected, setSelected] = useState<PageRow | null>(null);

  function onSort(k: SortKey) {
    if (k === sortKey) setDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setSortKey(k); setDir('desc'); }
  }

  const sorted = [...pages].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return dir === 'desc' ? bv - av : av - bv;
  });

  const totalSessions = pages.reduce((s, p) => s + p.sessions, 0);
  const totalClicks = pages.reduce((s, p) => s + p.clicks, 0);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-6 py-6">
      <div className="flex items-baseline gap-2">
        <h1 className="text-[18px] font-medium tracking-[-0.01em] text-fg">Pages</h1>
        <span className="font-mono text-[12px] text-fg-3">last 28 days</span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Pages" value={pages.length.toLocaleString()} />
        <Stat label="Sessions" value={totalSessions.toLocaleString()} />
        <Stat label="Search clicks" value={totalClicks.toLocaleString()} />
      </div>

      {pages.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-6 text-center text-[14px] text-fg-2">
          No page data for this period.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border bg-surface text-left text-[11px] uppercase tracking-wider text-fg-3">
                <th className="px-4 py-2.5 font-medium">Page</th>
                <SortTh label="Sessions" k="sessions" sortKey={sortKey} dir={dir} onSort={onSort} />
                <SortTh label="Engaged %" k="engagedPct" sortKey={sortKey} dir={dir} onSort={onSort} />
                <SortTh label="Clicks" k="clicks" sortKey={sortKey} dir={dir} onSort={onSort} />
                <SortTh label="Impressions" k="impressions" sortKey={sortKey} dir={dir} onSort={onSort} />
                <SortTh label="Avg pos." k="avgPosition" sortKey={sortKey} dir={dir} onSort={onSort} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr
                  key={p.page_path}
                  onClick={() => setSelected(p)}
                  className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-surface-2"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="max-w-[300px] truncate font-mono text-[12.5px] text-fg" title={p.page_path}>{p.page_path}</div>
                      {p.insights.length > 0 && (
                        <span className="flex-none rounded-full bg-iris-dim px-1.5 py-0.5 text-[10px] font-medium text-iris-bright">
                          {p.insights.length}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-fg-2">{p.sessions.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-mono text-fg-2">{p.engagedPct.toFixed(0)}%</td>
                  <td className="px-4 py-3 text-right font-mono text-fg-2">{p.clicks.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-mono text-fg-2">{p.impressions.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-mono text-fg-2">{p.avgPosition == null ? '—' : p.avgPosition.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <PageDetailDrawer page={selected} onClose={() => setSelected(null)} actionedIds={actionedIds} />}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { Search, X, EyeOff } from 'lucide-react';
import Link from 'next/link';
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

export function PagesTable({ pages, actionedInsightIds = [], hiddenPaths = [] }: { pages: PageRow[]; actionedInsightIds?: string[]; hiddenPaths?: string[] }) {
  const actionedIds = new Set(actionedInsightIds);
  const [sortKey, setSortKey] = useState<SortKey>('sessions');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [selected, setSelected] = useState<PageRow | null>(null);
  const [query, setQuery] = useState('');
  const [showHidden, setShowHidden] = useState(false);

  function onSort(k: SortKey) {
    if (k === sortKey) setDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setSortKey(k); setDir('desc'); }
  }

  const totalSessions = pages.reduce((s, p) => s + p.sessions, 0);
  const totalClicks = pages.reduce((s, p) => s + p.clicks, 0);

  // Filter by URL/slug substring (case-insensitive), then sort.
  const q = query.trim().toLowerCase();
  const filtered = q ? pages.filter((p) => p.page_path.toLowerCase().includes(q)) : pages;

  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return dir === 'desc' ? bv - av : av - bv;
  });

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

      {hiddenPaths.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-[12px] text-fg-3">
            <EyeOff size={13} strokeWidth={2} />
            <span>{hiddenPaths.length.toLocaleString()} pages hidden by exclusion rules</span>
            <button
              type="button"
              onClick={() => setShowHidden((v) => !v)}
              className="text-fg-2 underline underline-offset-2 transition-colors hover:text-fg"
            >
              {showHidden ? 'hide' : 'show'}
            </button>
            <span>·</span>
            <Link href="/settings" className="text-fg-2 underline underline-offset-2 transition-colors hover:text-fg">
              manage
            </Link>
          </div>
          {showHidden && (
            <div className="max-h-64 overflow-y-auto rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3">
              <div className="flex flex-col gap-1">
                {hiddenPaths.map((h) => (
                  <div key={h} className="truncate font-mono text-[11.5px] text-fg-3" title={h}>{h}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {pages.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-6 text-center text-[14px] text-fg-2">
          No page data for this period.
        </div>
      ) : (
        <>
          <div className="relative">
            <Search size={15} strokeWidth={2} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by URL or slug…"
              aria-label="Filter pages by URL or slug"
              className="w-full rounded-[var(--radius-ctl)] border border-border bg-surface-2 py-2.5 pl-9 pr-9 text-[13px] text-fg outline-none placeholder:text-fg-3 focus:border-iris-border"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear filter"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-fg-3 transition-colors hover:text-fg-2"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {q && (
            <div className="-mt-2 text-[12px] text-fg-3">
              Showing {filtered.length.toLocaleString()} of {pages.length.toLocaleString()} pages
            </div>
          )}

          {filtered.length === 0 ? (
            <div className="rounded-[var(--radius-card)] border border-border bg-surface p-6 text-center text-[14px] text-fg-2">
              No pages match “{query.trim()}”.
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
        </>
      )}

      {selected && <PageDetailDrawer page={selected} onClose={() => setSelected(null)} actionedIds={actionedIds} />}
    </div>
  );
}

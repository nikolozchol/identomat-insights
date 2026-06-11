'use client';

import { useState } from 'react';

export type CountryRow = { country: string; sessions: number; conversions: number; convRate: number; share: number };
type SortKey = 'sessions' | 'conversions' | 'convRate';

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

export function CountriesView({ countries, totals, windowLabel }: {
  countries: CountryRow[];
  totals: { sessions: number; conversions: number; convRate: number };
  windowLabel: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('sessions');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');

  function onSort(k: SortKey) {
    if (k === sortKey) setDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setSortKey(k); setDir('desc'); }
  }

  const sorted = [...countries].sort((a, b) => (dir === 'desc' ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey]));

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-6 py-6">
      <div className="flex items-baseline gap-2">
        <h1 className="text-[18px] font-medium tracking-[-0.01em] text-fg">Countries</h1>
        <span className="font-mono text-[12px] text-fg-3">{windowLabel}</span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Sessions" value={totals.sessions.toLocaleString()} />
        <Stat label="Conversions" value={totals.conversions.toLocaleString()} />
        <Stat label="Conversion rate" value={`${totals.convRate.toFixed(2)}%`} />
      </div>

      {countries.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-6 text-center text-[14px] text-fg-2">
          No country data for this period.
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-border">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border bg-surface text-left text-[11px] uppercase tracking-wider text-fg-3">
                <th className="px-4 py-2.5 font-medium">Country</th>
                <SortTh label="Sessions" k="sessions" sortKey={sortKey} dir={dir} onSort={onSort} />
                <SortTh label="Conversions" k="conversions" sortKey={sortKey} dir={dir} onSort={onSort} />
                <SortTh label="Conv. rate" k="convRate" sortKey={sortKey} dir={dir} onSort={onSort} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => (
                <tr key={c.country} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-fg">{c.country}</div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-2">
                        <div className="h-full rounded-full bg-iris" style={{ width: `${Math.min(100, c.share)}%` }} />
                      </div>
                      <span className="font-mono text-[11px] text-fg-3">{c.share.toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-fg-2">{c.sessions.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-mono text-fg-2">{c.conversions.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-mono text-fg-2">{c.convRate.toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

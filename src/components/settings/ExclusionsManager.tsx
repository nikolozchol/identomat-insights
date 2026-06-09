'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Lock, EyeOff } from 'lucide-react';

export type ExclusionRow = {
  id: string;
  pattern: string;
  match_type: 'contains' | 'prefix' | 'exact' | 'glob';
  note: string | null;
  created_at: string;
};

const MATCH_LABEL: Record<ExclusionRow['match_type'], string> = {
  contains: 'Contains',
  prefix: 'Starts with',
  exact: 'Exact',
  glob: 'Pattern',
};

export function ExclusionsManager({ initialRules, hiddenCount }: { initialRules: ExclusionRow[]; hiddenCount: number }) {
  const router = useRouter();
  const [rules, setRules] = useState<ExclusionRow[]>(initialRules);
  const [pattern, setPattern] = useState('');
  const [matchType, setMatchType] = useState<ExclusionRow['match_type']>('contains');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function add() {
    const p = pattern.trim();
    if (!p) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/exclusions/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pattern: p, matchType }),
      });
      const d = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && d.ok) {
        setPattern('');
        setMatchType('contains');
        router.refresh();
        setRules((r) => [
          ...r,
          { id: `tmp-${Date.now()}`, pattern: p, match_type: matchType, note: null, created_at: new Date().toISOString() },
        ]);
      } else {
        setError(d.error ?? 'Could not add rule');
      }
    } catch {
      setError('Could not add rule');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setPendingId(id);
    setError(null);
    try {
      const res = await fetch('/api/exclusions/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const d = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && d.ok) {
        setRules((r) => r.filter((x) => x.id !== id));
        router.refresh();
      } else {
        setError(d.error ?? 'Could not delete rule');
      }
    } catch {
      setError('Could not delete rule');
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-[15px] font-medium text-fg">Excluded pages</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-fg-2">
          Hide unwanted URLs from Pages and stop insights being generated for them. Rules apply across all history and can be
          removed at any time.
          {hiddenCount > 0 && (
            <>
              {' '}
              <span className="inline-flex items-center gap-1 text-fg-3">
                <EyeOff size={12} strokeWidth={2} /> {hiddenCount.toLocaleString()} pages currently hidden.
              </span>
            </>
          )}
        </p>
      </div>

      <div className="flex items-start gap-2.5 rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3">
        <Lock size={14} strokeWidth={2} className="mt-0.5 flex-none text-fg-3" />
        <div>
          <div className="text-[13px] font-medium text-fg">Built-in: technical assets</div>
          <div className="mt-0.5 text-[12px] leading-relaxed text-fg-3">
            Stylesheets, scripts and fonts (.css, .js, .map, .woff, .ico, .xml) are always hidden. PDFs and images are kept.
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void add(); }}
            placeholder="e.g. /wp-  or  /category/"
            aria-label="URL pattern to exclude"
            className="flex-1 rounded-[var(--radius-ctl)] border border-border bg-surface-2 px-3 py-2.5 text-[13px] text-fg outline-none placeholder:text-fg-3 focus:border-iris-border"
          />
          <select
            value={matchType}
            onChange={(e) => setMatchType(e.target.value as ExclusionRow['match_type'])}
            aria-label="Match type"
            className="rounded-[var(--radius-ctl)] border border-border bg-surface-2 px-3 py-2.5 text-[13px] text-fg outline-none focus:border-iris-border"
          >
            <option value="contains">Contains</option>
            <option value="prefix">Starts with</option>
            <option value="exact">Exact</option>
          </select>
          <button
            type="button"
            onClick={add}
            disabled={busy || !pattern.trim()}
            className="inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-ctl)] border border-iris-border bg-iris-dim px-3 py-2.5 text-[13px] font-medium text-iris-bright transition-colors hover:bg-[rgba(124,108,255,0.22)] disabled:opacity-60"
          >
            <Plus size={14} strokeWidth={2} />
            {busy ? 'Adding…' : 'Add'}
          </button>
        </div>
        {error && <div className="text-[12px] text-down">{error}</div>}
      </div>

      {rules.length > 0 ? (
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-border">
          {rules.map((r, idx) => (
            <div
              key={r.id}
              className={`flex items-center gap-3 bg-surface px-4 py-3 ${idx > 0 ? 'border-t border-border' : ''}`}
            >
              <span className="rounded-[6px] bg-surface-2 px-2 py-1 font-mono text-[12px] text-fg">{r.pattern}</span>
              <span className="text-[11px] uppercase tracking-wide text-fg-3">{MATCH_LABEL[r.match_type]}</span>
              {r.note && <span className="truncate text-[12px] text-fg-3" title={r.note}>{r.note}</span>}
              <button
                type="button"
                onClick={() => remove(r.id)}
                disabled={pendingId === r.id}
                aria-label={`Remove rule ${r.pattern}`}
                className="ml-auto flex-none rounded p-1 text-fg-3 transition-colors hover:text-down disabled:opacity-50"
              >
                <Trash2 size={14} strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-[var(--radius-card)] border border-border bg-surface px-4 py-6 text-center text-[13px] text-fg-3">
          No custom rules yet. Technical assets are still hidden by the built-in default above.
        </div>
      )}
    </section>
  );
}

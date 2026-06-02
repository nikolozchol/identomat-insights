'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Play, Check, RotateCcw } from 'lucide-react';

export type ActionRow = {
  id: string;
  title: string;
  brief: string | null;
  category: string | null;
  owner: string | null;
  effort: string | null;
  expected_impact: string | null;
  success_metric: string | null;
  status: string;
  created_at: string;
};

type NextStatus = 'new' | 'in_progress' | 'done';

const EFFORT_LABEL: Record<string, string> = { S: 'Small', M: 'Medium', L: 'Large' };

function StatusButton({
  status,
  pending,
  onSet,
}: {
  status: string;
  pending: boolean;
  onSet: (s: NextStatus) => void;
}) {
  if (status === 'done') {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => onSet('in_progress')}
        className="inline-flex flex-none items-center gap-1 rounded-[var(--radius-ctl)] px-2 py-1 text-[11.5px] text-fg-3 transition-colors hover:text-fg-2 disabled:opacity-50"
      >
        <RotateCcw size={12} strokeWidth={2} /> Reopen
      </button>
    );
  }
  if (status === 'in_progress') {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => onSet('done')}
        className="inline-flex flex-none items-center gap-1.5 rounded-[var(--radius-ctl)] border border-[rgba(67,192,138,0.32)] bg-[rgba(67,192,138,0.12)] px-2.5 py-1.5 text-[12px] font-medium text-up transition-colors hover:bg-[rgba(67,192,138,0.2)] disabled:opacity-50"
      >
        <Check size={13} strokeWidth={2.5} /> Mark done
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => onSet('in_progress')}
      className="inline-flex flex-none items-center gap-1.5 rounded-[var(--radius-ctl)] border border-iris-border bg-iris-dim px-2.5 py-1.5 text-[12px] font-medium text-iris-bright transition-colors hover:bg-[rgba(124,108,255,0.22)] disabled:opacity-50"
    >
      <Play size={12} strokeWidth={2.5} /> Start
    </button>
  );
}

export function ActionCard({ a }: { a: ActionRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const hasDetails = !!(a.brief || a.expected_impact || a.success_metric || a.owner || a.category);

  async function setStatus(next: NextStatus) {
    setFailed(false);
    setPending(true);
    try {
      const res = await fetch('/api/actions/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: a.id, status: next }),
      });
      const data = (await res.json()) as { ok?: boolean };
      if (res.ok && data.ok) {
        router.refresh(); // re-render moves the card to its new column
      } else {
        setFailed(true);
        setPending(false);
      }
    } catch {
      setFailed(true);
      setPending(false);
    }
  }

  return (
    <article className="rounded-[var(--radius-card)] border border-border bg-surface">
      <div className="flex items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <ChevronDown
            size={15}
            strokeWidth={2}
            className={`flex-none text-fg-3 transition-transform duration-200 ${open ? '' : '-rotate-90'}`}
          />
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-fg">{a.title}</span>
        </button>
        {a.effort && (
          <span className="flex-none rounded-[6px] border border-border px-1.5 py-0.5 font-mono text-[11px] text-fg-3">
            {EFFORT_LABEL[a.effort] ?? a.effort}
          </span>
        )}
        {failed && !pending && <span className="flex-none text-[11px] text-down">Failed</span>}
        <StatusButton status={a.status} pending={pending} onSet={setStatus} />
      </div>

      {open && hasDetails && (
        <div className="border-t border-border py-3 pl-10 pr-4">
          {a.category && <div className="mb-2 text-[11px] uppercase tracking-wide text-fg-3">{a.category}</div>}
          {a.brief && <p className="text-[13px] leading-relaxed text-fg-2">{a.brief}</p>}
          <div className="mt-3 flex flex-col gap-1.5 text-[12px]">
            {a.expected_impact && (
              <div className="text-fg-2">
                <span className="text-fg-3">Impact: </span>
                {a.expected_impact}
              </div>
            )}
            {a.success_metric && (
              <div className="text-fg-2">
                <span className="text-fg-3">Success metric: </span>
                {a.success_metric}
              </div>
            )}
            {a.owner && (
              <div className="text-fg-2">
                <span className="text-fg-3">Owner: </span>
                {a.owner}
              </div>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

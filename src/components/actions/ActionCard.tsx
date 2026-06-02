'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Play, Check, RotateCcw, Trash2, X } from 'lucide-react';

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

function ownerInitials(email: string): string {
  const local = (email.split('@')[0] ?? '').trim();
  const parts = local.replace(/[^a-zA-Z]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const ini = parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : local.slice(0, 2);
  return (ini || '?').toUpperCase();
}

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

export function ActionCard({ a, members }: { a: ActionRow; members: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [assigning, setAssigning] = useState(false);

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

  async function remove() {
    setFailed(false);
    setDeleting(true);
    try {
      const res = await fetch('/api/actions/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: a.id }),
      });
      const data = (await res.json()) as { ok?: boolean };
      if (res.ok && data.ok) {
        router.refresh(); // card disappears
      } else {
        setFailed(true);
        setDeleting(false);
        setConfirming(false);
      }
    } catch {
      setFailed(true);
      setDeleting(false);
      setConfirming(false);
    }
  }

  async function assign(owner: string) {
    setFailed(false);
    setAssigning(true);
    try {
      const res = await fetch('/api/actions/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: a.id, owner: owner || null }),
      });
      const data = (await res.json()) as { ok?: boolean };
      if (res.ok && data.ok) {
        router.refresh();
      } else {
        setFailed(true);
        setAssigning(false);
      }
    } catch {
      setFailed(true);
      setAssigning(false);
    }
  }

  // Current owner may not be in the registered list (e.g. left the team) — keep it selectable.
  const ownerOptions = a.owner && !members.includes(a.owner) ? [a.owner, ...members] : members;

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

        {a.owner && (
          <span
            title={a.owner}
            className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full bg-iris-dim font-mono text-[9px] font-medium text-iris-bright"
          >
            {ownerInitials(a.owner)}
          </span>
        )}
        {a.effort && (
          <span className="flex-none rounded-[6px] border border-border px-1.5 py-0.5 font-mono text-[11px] text-fg-3">
            {EFFORT_LABEL[a.effort] ?? a.effort}
          </span>
        )}
        {failed && !pending && !deleting && !assigning && <span className="flex-none text-[11px] text-down">Failed</span>}

        {confirming ? (
          <span className="inline-flex flex-none items-center gap-1 text-[11.5px] text-fg-2">
            Delete?
            <button
              type="button"
              onClick={remove}
              disabled={deleting}
              aria-label="Confirm delete"
              className="rounded p-1 text-down transition-colors hover:bg-[rgba(255,107,107,0.14)] disabled:opacity-50"
            >
              <Check size={13} strokeWidth={2.5} />
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={deleting}
              aria-label="Cancel delete"
              className="rounded p-1 text-fg-3 transition-colors hover:text-fg-2 disabled:opacity-50"
            >
              <X size={13} strokeWidth={2.5} />
            </button>
          </span>
        ) : (
          <>
            <StatusButton status={a.status} pending={pending} onSet={setStatus} />
            <button
              type="button"
              onClick={() => {
                setConfirming(true);
                setFailed(false);
              }}
              aria-label="Delete action"
              className="flex-none rounded-[var(--radius-ctl)] p-1.5 text-fg-3 transition-colors hover:bg-surface-2 hover:text-down"
            >
              <Trash2 size={14} strokeWidth={1.9} />
            </button>
          </>
        )}
      </div>

      {open && (
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
            <div className="flex items-center gap-2 pt-0.5 text-fg-2">
              <span className="text-fg-3">Owner</span>
              <select
                value={a.owner ?? ''}
                disabled={assigning}
                onChange={(e) => assign(e.target.value)}
                className="min-w-0 flex-1 rounded-[var(--radius-ctl)] border border-border bg-surface-2 px-2 py-1 text-[12px] text-fg outline-none focus:border-iris-border disabled:opacity-50"
              >
                <option value="">Unassigned</option>
                {ownerOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

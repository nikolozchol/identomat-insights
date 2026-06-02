'use client';

import { useState } from 'react';
import { ActionCard, type ActionRow } from './ActionCard';

type Status = 'new' | 'in_progress' | 'done';

const COLUMNS: { key: Status; label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'done', label: 'Done' },
];

export function ActionsBoard({
  actions,
  currentUserEmail,
  members,
}: {
  actions: ActionRow[];
  currentUserEmail: string;
  members: string[];
}) {
  const [scope, setScope] = useState<'all' | 'mine'>('all');
  const me = currentUserEmail.toLowerCase();
  const mineCount = me ? actions.filter((a) => (a.owner ?? '').toLowerCase() === me).length : 0;
  const visible = scope === 'mine' && me ? actions.filter((a) => (a.owner ?? '').toLowerCase() === me) : actions;
  const byStatus = (s: Status) => visible.filter((a) => (a.status as Status) === s);

  const tab = (active: boolean) =>
    `rounded-[7px] px-3 py-1 transition-colors ${active ? 'bg-elevated text-fg' : 'text-fg-3 hover:text-fg-2'}`;

  return (
    <div className="flex flex-col gap-4">
      {me && (
        <div className="inline-flex w-fit items-center gap-0.5 rounded-[var(--radius-ctl)] border border-border bg-surface p-0.5 text-[12.5px]">
          <button type="button" onClick={() => setScope('all')} className={tab(scope === 'all')}>
            All
          </button>
          <button type="button" onClick={() => setScope('mine')} className={tab(scope === 'mine')}>
            Mine{mineCount > 0 ? ` · ${mineCount}` : ''}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {COLUMNS.map((col) => {
          const items = byStatus(col.key);
          return (
            <div key={col.key} className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <h2 className="text-[13px] font-medium uppercase tracking-wider text-fg-2">{col.label}</h2>
                <span className="font-mono text-[12px] text-fg-3">{items.length}</span>
              </div>
              {items.length === 0 ? (
                <div className="rounded-[var(--radius-card)] border border-dashed border-border p-4 text-center text-[12px] text-fg-3">
                  Nothing here
                </div>
              ) : (
                items.map((a) => <ActionCard key={a.id} a={a} members={members} />)
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

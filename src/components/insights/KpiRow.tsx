import type { Trajectory } from './types';

export type KpiTarget = 'all' | 'critical' | 'issue' | 'opportunity' | 'win';

function Tile({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  tone?: 'crit' | 'win' | 'iris';
  onClick?: () => void;
}) {
  const color =
    tone === 'crit' ? 'text-crit' : tone === 'win' ? 'text-up' : tone === 'iris' ? 'text-iris-bright' : 'text-fg';
  const interactive = !!onClick && value > 0;
  return (
    <button
      type="button"
      onClick={interactive ? onClick : undefined}
      disabled={!interactive}
      aria-label={interactive ? `Jump to ${label}` : undefined}
      className={`flex flex-col gap-1 rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3 text-left transition-colors ${
        interactive ? 'cursor-pointer hover:border-border-strong hover:bg-surface-2' : 'cursor-default'
      }`}
    >
      <span className={`font-mono text-2xl ${color}`}>{value}</span>
      <span className="text-[11px] uppercase tracking-wide text-fg-3">{label}</span>
    </button>
  );
}

export function KpiRow({ t, onJump }: { t: Trajectory; onJump?: (target: KpiTarget) => void }) {
  const j = (target: KpiTarget) => (onJump ? () => onJump(target) : undefined);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Tile label="Active findings" value={t.active_total} onClick={j('all')} />
      <Tile label="Critical" value={t.by_severity.critical ?? 0} tone="crit" onClick={j('critical')} />
      <Tile label="Issues" value={t.issues} onClick={j('issue')} />
      <Tile label="Opportunities" value={t.opportunities} tone="iris" onClick={j('opportunity')} />
      <Tile label="Wins" value={t.wins} tone="win" onClick={j('win')} />
    </div>
  );
}

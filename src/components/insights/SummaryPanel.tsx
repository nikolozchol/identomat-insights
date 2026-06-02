import { Sparkles } from 'lucide-react';
import type { SummaryRow, Severity } from './types';
import { SEV_VAR } from './types';

export function SummaryPanel({ summary, onFocusStory }: { summary: SummaryRow; onFocusStory: (ids: string[]) => void }) {
  const stories = (summary.stories ?? []).filter((s) => s.insight_ids.length >= 2).slice(0, 8);
  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-iris-bright">
        <Sparkles size={13} strokeWidth={2} /> Big picture
      </div>
      <h2 className="mt-2 text-[19px] font-medium leading-snug tracking-[-0.01em] text-fg">{summary.headline}</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-fg-2">{summary.body}</p>
      {stories.length > 0 && (
        <div className="mt-4 border-t border-border pt-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-fg-3">Reconciled stories</div>
          <div className="mt-2 flex flex-col gap-1">
            {stories.map((s) => {
              const dot: Severity = s.worst_severity in SEV_VAR ? s.worst_severity : 'low';
              return (
                <button
                  key={s.group_key}
                  onClick={() => onFocusStory(s.insight_ids)}
                  className="group flex items-center gap-2.5 rounded-[var(--radius-ctl)] border border-transparent px-2.5 py-2 text-left transition-colors hover:border-border hover:bg-surface-2"
                >
                  <span className="h-2 w-2 flex-none rounded-full" style={{ backgroundColor: SEV_VAR[dot] }} />
                  <span className="flex-1 truncate text-[13.5px] text-fg-2 group-hover:text-fg">{s.label}</span>
                  <span className="font-mono text-[11px] text-fg-3">{s.insight_ids.length} findings</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

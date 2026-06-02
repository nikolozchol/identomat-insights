import type { LucideIcon } from 'lucide-react';

export function Placeholder({ icon: Icon, title, blurb }: { icon: LucideIcon; title: string; blurb: string }) {
  return (
    <div className="flex h-full items-center justify-center p-10">
      <div className="max-w-md text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[var(--radius-card)] border border-border bg-surface">
          <Icon size={22} strokeWidth={1.75} className="text-iris-bright" />
        </div>
        <h2 className="mt-4 text-[17px] font-medium text-fg">{title}</h2>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg-2">{blurb}</p>
        <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-iris-border bg-iris-dim px-3 py-1 text-[12px] text-iris-bright">
          Coming up in this build
        </div>
      </div>
    </div>
  );
}

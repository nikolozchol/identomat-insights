export function SectionSkeleton() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-6 py-6">
      <div className="h-6 w-40 animate-pulse rounded bg-surface-2" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-[68px] animate-pulse rounded-[var(--radius-card)] border border-border bg-surface" />
        ))}
      </div>
      <div className="flex flex-col gap-2.5">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-[var(--radius-card)] border border-border bg-surface" />
        ))}
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-[68px] animate-pulse rounded-[var(--radius-card)] border border-border bg-surface" />
        ))}
      </div>
      <div className="h-40 animate-pulse rounded-[var(--radius-card)] border border-border bg-surface" />
      <div className="flex flex-col gap-2.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-[var(--radius-card)] border border-border bg-surface" />
        ))}
      </div>
    </div>
  );
}

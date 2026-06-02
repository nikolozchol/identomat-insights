'use client';

import { usePathname } from 'next/navigation';

const TITLES: Record<string, string> = {
  '/': 'Insights',
  '/pages': 'Pages',
  '/channels': 'Channels',
  '/ask': 'Ask AI',
  '/actions': 'Actions',
  '/heatmaps': 'Heatmaps',
  '/settings': 'Settings',
};

function titleFor(pathname: string): string {
  if (pathname === '/') return TITLES['/'];
  const key = Object.keys(TITLES).find((k) => k !== '/' && pathname.startsWith(k));
  return key ? TITLES[key] : 'Insights';
}

export function TopBar() {
  const pathname = usePathname();
  return (
    <header className="flex h-14 flex-none items-center justify-between border-b border-border px-6">
      <h1 className="text-[15px] font-medium tracking-[-0.01em] text-fg">{titleFor(pathname)}</h1>
      <div className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-[12px] text-fg-2">
        <span className="h-1.5 w-1.5 rounded-full bg-up" />
        identomat.com
      </div>
    </header>
  );
}

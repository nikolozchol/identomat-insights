'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, FileText, Radio, Globe, Sparkles, ListChecks, Flame, Settings, LogOut, type LucideIcon } from 'lucide-react';

type NavItem = { href: string; label: string; icon: LucideIcon };

const NAV: NavItem[] = [
  { href: '/', label: 'Insights', icon: LayoutDashboard },
  { href: '/pages', label: 'Pages', icon: FileText },
  { href: '/channels', label: 'Channels', icon: Radio },
  { href: '/countries', label: 'Countries', icon: Globe },
  { href: '/ask', label: 'Ask AI', icon: Sparkles },
  { href: '/actions', label: 'Actions', icon: ListChecks },
  { href: '/heatmaps', label: 'Heatmaps', icon: Flame },
];

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

function NavLink({ item, active, badge }: { item: NavItem; active: boolean; badge?: number }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={`flex items-center gap-2.5 rounded-[var(--radius-ctl)] px-2.5 py-2 text-[13.5px] transition-colors ${
        active ? 'bg-iris-dim text-fg' : 'text-fg-2 hover:bg-surface hover:text-fg'
      }`}
    >
      <Icon size={17} strokeWidth={1.75} className={active ? 'text-iris-bright' : 'text-fg-3'} />
      <span className="flex-1">{item.label}</span>
      {typeof badge === 'number' && badge > 0 && (
        <span className="flex-none rounded-full bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] leading-none text-fg-2">
          {badge}
        </span>
      )}
    </Link>
  );
}

export function Sidebar({ actionCount = 0, userEmail }: { actionCount?: number; userEmail?: string }) {
  const pathname = usePathname();
  return (
    <aside className="flex flex-col border-r border-border bg-canvas px-3 py-3.5">
      <div className="flex items-center gap-2.5 rounded-[var(--radius-ctl)] p-2 transition-colors hover:bg-surface">
        <div className="flex h-7 w-7 flex-none items-center justify-center rounded-[7px] bg-gradient-to-br from-iris to-[#5a48d6] text-sm font-semibold text-white">
          I
        </div>
        <div className="leading-tight">
          <div className="text-[13.5px] font-medium tracking-[-0.01em] text-fg">Identomat</div>
          <div className="-mt-0.5 text-[11px] text-fg-3">Insights</div>
        </div>
      </div>

      <div className="mt-4 px-2 text-[10.5px] font-medium uppercase tracking-wider text-fg-3">Workspace</div>
      <nav className="mt-1.5 flex flex-col gap-0.5">
        {NAV.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={isActive(pathname, item.href)}
            badge={item.href === '/actions' ? actionCount : undefined}
          />
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-0.5">
        <NavLink item={{ href: '/settings', label: 'Settings', icon: Settings }} active={isActive(pathname, '/settings')} />
        {userEmail && (
          <div className="mt-2 border-t border-border px-2.5 pt-2.5">
            <div className="truncate text-[11.5px] text-fg-3" title={userEmail}>{userEmail}</div>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="mt-1 inline-flex items-center gap-1.5 text-[12px] text-fg-2 transition-colors hover:text-fg"
              >
                <LogOut size={13} strokeWidth={1.75} /> Sign out
              </button>
            </form>
          </div>
        )}
      </div>
    </aside>
  );
}

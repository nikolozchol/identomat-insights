'use client';

import { useEffect, useState } from 'react';
import { X, LayoutDashboard, FileText, Sparkles, ListChecks, Flame, type LucideIcon } from 'lucide-react';

const SEEN_KEY = 'identomat_onboarding_seen_v1';

const ITEMS: { icon: LucideIcon; title: string; desc: string }[] = [
  { icon: LayoutDashboard, title: 'Insights', desc: 'What changed in your funnel, ranked by severity. The numbers are computed; the explanations are written for you.' },
  { icon: FileText, title: 'Pages & Channels', desc: 'Per-page and per-channel performance from GA4 and Search Console. Click any page for the full detail.' },
  { icon: Sparkles, title: 'Ask AI', desc: 'Ask a question in plain language — answers cite the insights and data behind them.' },
  { icon: Flame, title: 'Heatmaps', desc: 'Behavioral friction from Clarity, plus upload a heatmap screenshot for an AI reading.' },
  { icon: ListChecks, title: 'Actions', desc: 'Convert any finding into a tracked task, then move it from New to Done.' },
];

export function Onboarding() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(SEEN_KEY)) setShow(true);
    } catch {
      /* localStorage unavailable — skip */
    }
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* ignore */
    }
    setShow(false);
  }

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={dismiss} />
      <div className="relative z-10 w-full max-w-[460px] overflow-hidden rounded-[var(--radius-card)] border border-border-strong bg-surface shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-fg">Welcome to Identomat Insights</h2>
            <p className="mt-0.5 text-[12.5px] text-fg-2">A quick tour of what is where.</p>
          </div>
          <button type="button" onClick={dismiss} aria-label="Close" className="flex-none rounded p-1 text-fg-3 transition-colors hover:text-fg">
            <X size={17} />
          </button>
        </div>

        <div className="flex flex-col gap-3 px-5 py-4">
          {ITEMS.map((it) => {
            const Icon = it.icon;
            return (
              <div key={it.title} className="flex items-start gap-3">
                <div className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-[7px] bg-iris-dim">
                  <Icon size={15} strokeWidth={1.9} className="text-iris-bright" />
                </div>
                <div>
                  <div className="text-[13px] font-medium text-fg">{it.title}</div>
                  <div className="mt-0.5 text-[12.5px] leading-relaxed text-fg-2">{it.desc}</div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t border-border px-5 py-3.5">
          <button
            type="button"
            onClick={dismiss}
            className="w-full rounded-[var(--radius-ctl)] bg-iris px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-iris-bright"
          >
            Get started
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { InsightRow, SummaryRow, Severity, Polarity } from './types';
import type { MuteKind } from './InsightCard';
import { KpiRow, type KpiTarget } from './KpiRow';
import { SummaryPanel } from './SummaryPanel';
import { SeveritySection } from './SeveritySection';

const SEV_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];

export function InsightsFeed({
  summary,
  insights,
  actionedInsightIds,
}: {
  summary: SummaryRow | null;
  insights: InsightRow[];
  actionedInsightIds: string[];
}) {
  const router = useRouter();
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  const [converted, setConverted] = useState<Set<string>>(() => new Set(actionedInsightIds));
  const [converting, setConverting] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  function focusStory(ids: string[]) {
    setHighlighted(new Set(ids));
    const first = ids[0];
    if (first) document.getElementById(`insight-${first}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => setHighlighted(new Set()), 2500);
  }

  // Cross-tab deep link: /#insight-<id> from Pages/Heatmaps scrolls to + highlights the card.
  useEffect(() => {
    function focusFromHash() {
      const m = window.location.hash.match(/^#insight-(.+)$/);
      if (!m) return;
      const id = m[1];
      const el = document.getElementById(`insight-${id}`);
      if (!el) return;
      setHighlighted(new Set([id]));
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      window.setTimeout(() => setHighlighted(new Set()), 2500);
    }
    const t = window.setTimeout(focusFromHash, 80);
    window.addEventListener('hashchange', focusFromHash);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('hashchange', focusFromHash);
    };
  }, []);

  // KPI tiles scroll to the first matching finding.
  function jumpTo(target: KpiTarget) {
    const list = [...insights]
      .filter((i) => !hidden.has(i.id))
      .sort((a, b) => b.detected_at.localeCompare(a.detected_at));
    let match: InsightRow | undefined;
    if (target === 'all') match = list[0];
    else if (target === 'critical') match = list.find((i) => i.severity === 'critical');
    else match = list.find((i) => i.polarity === (target as Polarity));
    if (match) focusStory([match.id]);
  }

  async function onConvert(id: string) {
    setFailed((prev) => {
      const n = new Set(prev);
      n.delete(id);
      return n;
    });
    setConverting((prev) => new Set(prev).add(id));
    try {
      const res = await fetch('/api/actions/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ insightId: id }),
      });
      const data = (await res.json()) as { ok?: boolean; noop?: boolean };
      if (res.ok && (data.ok || data.noop)) {
        setConverted((prev) => new Set(prev).add(id));
        router.refresh();
      } else {
        setFailed((prev) => new Set(prev).add(id));
      }
    } catch {
      setFailed((prev) => new Set(prev).add(id));
    } finally {
      setConverting((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    }
  }

  async function onMute(id: string, kind: MuteKind) {
    setHidden((prev) => new Set(prev).add(id)); // optimistic hide
    try {
      const res = await fetch('/api/insights/mute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: kind }),
      });
      const data = (await res.json()) as { ok?: boolean };
      if (res.ok && data.ok) {
        router.refresh();
      } else {
        setHidden((prev) => {
          const n = new Set(prev);
          n.delete(id);
          return n;
        });
      }
    } catch {
      setHidden((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    }
  }

  const visible = [...insights]
    .filter((i) => !hidden.has(i.id))
    .sort((a, b) => b.detected_at.localeCompare(a.detected_at));
  const groups = SEV_ORDER.map((sev) => ({ sev, items: visible.filter((i) => i.severity === sev) }));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-6">
      {summary ? (
        <>
          <KpiRow t={summary.trajectory} onJump={jumpTo} />
          <SummaryPanel summary={summary} onFocusStory={focusStory} />
        </>
      ) : (
        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-5 text-[14px] text-fg-2">
          No summary yet — run the pipeline to generate one.
        </div>
      )}

      {visible.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-6 text-center text-[14px] text-fg-2">
          No active findings right now.
        </div>
      ) : (
        <div className="flex flex-col gap-7">
          {groups.map((g) => (
            <SeveritySection
              key={g.sev}
              severity={g.sev}
              items={g.items}
              highlighted={highlighted}
              converted={converted}
              converting={converting}
              failed={failed}
              onConvert={onConvert}
              onMute={onMute}
            />
          ))}
        </div>
      )}
    </div>
  );
}

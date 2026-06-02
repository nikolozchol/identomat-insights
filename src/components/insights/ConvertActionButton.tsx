'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ListChecks } from 'lucide-react';

// Same selection rule as generateActions / InsightCard.qualifiesForAction.
export function actionQualifies(polarity: string | null | undefined, severity: string): boolean {
  return (polarity === 'issue' || polarity === 'opportunity') && (severity === 'high' || severity === 'medium');
}

type State = 'idle' | 'converting' | 'converted' | 'failed';

export function ConvertActionButton({
  insightId,
  polarity,
  severity,
  initiallyConverted = false,
}: {
  insightId: string;
  polarity: string | null | undefined;
  severity: string;
  initiallyConverted?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<State>(initiallyConverted ? 'converted' : 'idle');

  if (!actionQualifies(polarity, severity)) return null;

  async function onClick() {
    setState('converting');
    try {
      const res = await fetch('/api/actions/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ insightId }),
      });
      const data = (await res.json()) as { ok?: boolean; noop?: boolean };
      if (res.ok && (data.ok || data.noop)) {
        setState('converted');
        router.refresh();
      } else {
        setState('failed');
      }
    } catch {
      setState('failed');
    }
  }

  if (state === 'converted') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-up">
        <Check size={13} strokeWidth={2.5} /> In action queue
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={state === 'converting'}
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-ctl)] border border-iris-border bg-iris-dim px-2.5 py-1.5 text-[12px] font-medium text-iris-bright transition-colors hover:bg-[rgba(124,108,255,0.22)] disabled:opacity-60"
      >
        <ListChecks size={13} strokeWidth={2} />
        {state === 'converting' ? 'Adding…' : state === 'failed' ? 'Retry — convert to action' : 'Convert to action'}
      </button>
      {state === 'failed' && <span className="text-[11px] text-down">Something went wrong</span>}
    </span>
  );
}

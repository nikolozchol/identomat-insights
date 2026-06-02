import type { InsightRow, Severity } from './types';
import { SEV_VAR, SEV_LABEL } from './types';
import { InsightCard, type MuteKind } from './InsightCard';

export function SeveritySection({
  severity,
  items,
  highlighted,
  converted,
  converting,
  failed,
  onConvert,
  onMute,
}: {
  severity: Severity;
  items: InsightRow[];
  highlighted: Set<string>;
  converted: Set<string>;
  converting: Set<string>;
  failed: Set<string>;
  onConvert: (id: string) => void;
  onMute: (id: string, kind: MuteKind) => void;
}) {
  if (!items.length) return null;
  return (
    <section>
      <div className="mb-2.5 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: SEV_VAR[severity] }} />
        <h2 className="text-[13px] font-medium uppercase tracking-wider text-fg-2">{SEV_LABEL[severity]}</h2>
        <span className="font-mono text-[12px] text-fg-3">{items.length}</span>
      </div>
      <div className="flex flex-col gap-2.5">
        {items.map((i) => (
          <InsightCard
            key={i.id}
            i={i}
            highlighted={highlighted.has(i.id)}
            converted={converted.has(i.id)}
            converting={converting.has(i.id)}
            failed={failed.has(i.id)}
            onConvert={onConvert}
            onMute={onMute}
          />
        ))}
      </div>
    </section>
  );
}

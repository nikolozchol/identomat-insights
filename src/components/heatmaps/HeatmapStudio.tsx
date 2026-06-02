'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, Loader2, Sparkles, ListChecks, Check } from 'lucide-react';

type Finding = { area: string; finding: string; severity: string; suggestion: string };
type ConvertState = 'idle' | 'converting' | 'done' | 'failed';

const SEV_COLOR: Record<string, string> = {
  high: 'var(--color-high)', medium: 'var(--color-med)', low: 'var(--color-low)',
};
const MAP_TYPES = ['Click map', 'Scroll map', 'Area map', 'Other'];

// Downscale + re-encode to JPEG in the browser so the upload (and vision cost) stay small.
async function downscale(file: File, maxDim = 1568): Promise<{ base64: string; mediaType: string }> {
  const dataUrl: string = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error('Could not read file'));
    r.readAsDataURL(file);
  });
  const img: HTMLImageElement = await new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('Could not decode image'));
    im.src = dataUrl;
  });
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(img, 0, 0, w, h);
  const out = canvas.toDataURL('image/jpeg', 0.82);
  return { base64: out.split(',')[1] ?? '', mediaType: 'image/jpeg' };
}

export function HeatmapStudio({ pagePaths }: { pagePaths: string[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [pagePath, setPagePath] = useState<string>('');
  const [mapType, setMapType] = useState<string>(MAP_TYPES[0]);
  const [status, setStatus] = useState<'idle' | 'analyzing' | 'error'>('idle');
  const [error, setError] = useState<string>('');
  const [pending, setPending] = useState<{ base64: string; mediaType: string } | null>(null);
  const [result, setResult] = useState<{ summary: string; findings: Finding[]; pagePath: string | null; mapType: string } | null>(null);
  const [convert, setConvert] = useState<Record<number, ConvertState>>({});

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus('idle');
    setError('');
    try {
      const out = await downscale(file);
      if (!out.base64) throw new Error('Empty image');
      setPending(out);
      setPreview(`data:${out.mediaType};base64,${out.base64}`);
      setFileName(file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not process image');
      setStatus('error');
    }
  }

  function clearImage() {
    setPreview(null);
    setFileName('');
    setPending(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function analyze() {
    if (!pending) return;
    setStatus('analyzing');
    setError('');
    setResult(null);
    setConvert({});
    try {
      const res = await fetch('/api/heatmaps/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: pending.base64,
          mediaType: pending.mediaType,
          pagePath: pagePath || null,
          mapType,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; summary?: string; findings?: Finding[]; error?: string };
      if (res.ok && data.ok) {
        setResult({
          summary: data.summary ?? '',
          findings: Array.isArray(data.findings) ? data.findings : [],
          pagePath: pagePath || null,
          mapType,
        });
        setStatus('idle');
      } else {
        setStatus('error');
        setError(data.error || 'Analysis failed');
      }
    } catch {
      setStatus('error');
      setError('Network error');
    }
  }

  async function convertOne(idx: number, f: Finding) {
    if (!result) return;
    setConvert((p) => ({ ...p, [idx]: 'converting' }));
    try {
      const res = await fetch('/api/heatmaps/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ finding: f, pagePath: result.pagePath, mapType: result.mapType }),
      });
      const data = (await res.json()) as { ok?: boolean };
      if (res.ok && data.ok) {
        setConvert((p) => ({ ...p, [idx]: 'done' }));
        router.refresh();
      } else {
        setConvert((p) => ({ ...p, [idx]: 'failed' }));
      }
    } catch {
      setConvert((p) => ({ ...p, [idx]: 'failed' }));
    }
  }

  const busy = status === 'analyzing';

  return (
    <section>
      <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-fg-3">Heatmap image analysis</h2>
      <p className="mb-3 text-[12.5px] leading-relaxed text-fg-3">
        Upload a screenshot of a Clarity click, scroll, or area map. Claude reads the image into findings — convert any that
        are worth attention into an action. Nothing is stored unless you convert it.
      </p>

      <div className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="flex-1">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={onPick}
              className="hidden"
            />
            {preview ? (
              <div className="flex items-start gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="heatmap preview" className="h-24 w-auto rounded-[var(--radius-ctl)] border border-border object-cover" />
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] text-fg">{fileName}</div>
                  <button type="button" onClick={clearImage} className="mt-1 text-[12px] text-fg-3 underline transition-colors hover:text-fg-2">
                    Choose a different image
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-ctl)] border border-dashed border-border-strong bg-surface-2 px-4 py-6 text-[13px] text-fg-2 transition-colors hover:border-iris-border hover:text-fg"
              >
                <Upload size={15} strokeWidth={2} /> Choose a heatmap screenshot
              </button>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:w-[200px]">
            <select
              value={mapType}
              onChange={(e) => setMapType(e.target.value)}
              className="rounded-[var(--radius-ctl)] border border-border bg-surface-2 px-2.5 py-2 text-[12.5px] text-fg outline-none focus:border-iris-border"
            >
              {MAP_TYPES.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <input
              list="heatmap-page-paths"
              value={pagePath}
              onChange={(e) => setPagePath(e.target.value)}
              placeholder="Page (optional)"
              className="rounded-[var(--radius-ctl)] border border-border bg-surface-2 px-2.5 py-2 font-mono text-[12px] text-fg outline-none placeholder:font-sans placeholder:text-fg-3 focus:border-iris-border"
            />
            <datalist id="heatmap-page-paths">
              {pagePaths.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            <button
              type="button"
              onClick={analyze}
              disabled={!pending || busy}
              className="inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-ctl)] border border-iris-border bg-iris-dim px-3 py-2 text-[12.5px] font-medium text-iris-bright transition-colors hover:bg-[rgba(124,108,255,0.22)] disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} strokeWidth={2} className="animate-spin" /> : <Sparkles size={14} strokeWidth={2} />}
              {busy ? 'Analyzing…' : 'Analyze heatmap'}
            </button>
          </div>
        </div>
        {status === 'error' && <p className="mt-2 text-[12px] text-down">{error}</p>}
      </div>

      {result && (
        <div className="mt-4">
          {result.summary && <p className="mb-3 text-[13px] leading-relaxed text-fg-2">{result.summary}</p>}
          {result.findings.length === 0 ? (
            <div className="rounded-[var(--radius-card)] border border-border bg-surface p-4 text-[13px] text-fg-3">
              No clear findings in this image.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {result.findings.map((f, idx) => {
                const st = convert[idx] ?? 'idle';
                return (
                  <div key={idx} className="rounded-[var(--radius-card)] border border-border bg-surface p-3">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 flex-none rounded-full" style={{ backgroundColor: SEV_COLOR[f.severity] ?? 'var(--color-low)' }} />
                      <span className="text-[13px] font-medium text-fg">{f.area || 'Finding'}</span>
                      <span className="text-[12.5px] text-fg-3">— {f.finding}</span>
                    </div>
                    {f.suggestion && <p className="mt-1 pl-4 text-[12.5px] leading-relaxed text-fg-2">{f.suggestion}</p>}
                    <div className="mt-2.5 border-t border-border pt-2.5">
                      {st === 'done' ? (
                        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-up">
                          <Check size={13} strokeWidth={2.5} /> In action queue
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => convertOne(idx, f)}
                            disabled={st === 'converting'}
                            className="inline-flex items-center gap-1.5 rounded-[var(--radius-ctl)] border border-iris-border bg-iris-dim px-2.5 py-1.5 text-[12px] font-medium text-iris-bright transition-colors hover:bg-[rgba(124,108,255,0.22)] disabled:opacity-60"
                          >
                            <ListChecks size={13} strokeWidth={2} />
                            {st === 'converting' ? 'Adding…' : st === 'failed' ? 'Retry — convert to action' : 'Convert to action'}
                          </button>
                          {st === 'failed' && <span className="text-[11px] text-down">Something went wrong</span>}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

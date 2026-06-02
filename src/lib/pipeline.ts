import { getSupabaseAdmin } from './supabase';

// Derive the client type from the factory so we don't depend on a named export.
type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;
import { syncGa4 } from './sync/ga4';
import { syncGa4Slices } from './sync/ga4Slices';
import { syncGsc } from './sync/gsc';
import { syncClarity } from './sync/clarity';
import { detectors } from './detectors';
import { narrateInsights } from './narrate';
import { generateSummary } from './summarize';

export type StepResult = { step: string; ok: boolean; detail: string; ms: number };
export type PipelineReport = {
  ok: boolean;
  workspaceId: string;
  window: { start: string; end: string };
  startedAt: string;
  finishedAt: string;
  totalMs: number;
  steps: StepResult[];
};

function isoDaysAgo(end: Date, days: number): string {
  const d = new Date(end.getTime());
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function resolveWorkspace(supabase: SupabaseAdmin): Promise<string> {
  const { data, error } = await supabase.from('workspaces').select('id').limit(1).single();
  if (error || !data) throw new Error(`No workspace: ${error?.message ?? 'empty'}`);
  return String((data as { id: string }).id);
}

async function loadConfig(supabase: SupabaseAdmin, wsId: string, type: string, key: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('data_sources')
    .select('config')
    .eq('workspace_id', wsId)
    .eq('type', type)
    .limit(1);
  if (error) return null;
  const row = ((data ?? []) as Array<{ config: Record<string, unknown> | null }>)[0];
  const v = row?.config?.[key];
  return typeof v === 'string' && v ? v : null;
}

async function safeLog(
  supabase: SupabaseAdmin,
  row: { workspace_id: string; source: string; status: 'success' | 'error'; rows_written: number; message: string; started_at: string; finished_at: string },
): Promise<void> {
  try {
    await supabase.from('sync_log').insert(row);
  } catch {
    /* logging must never break the pipeline */
  }
}

// Runs one step: times it, logs success/failure to sync_log, and never throws
// (a single step failing must not abort the rest of the chain).
async function runStep(
  supabase: SupabaseAdmin,
  wsId: string,
  step: string,
  fn: () => Promise<{ rows: number; detail: string }>,
): Promise<StepResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  try {
    const { rows, detail } = await fn();
    const ms = Date.now() - t0;
    await safeLog(supabase, { workspace_id: wsId, source: step, status: 'success', rows_written: rows, message: detail, started_at: startedAt, finished_at: new Date().toISOString() });
    return { step, ok: true, detail, ms };
  } catch (err) {
    const ms = Date.now() - t0;
    const message = err instanceof Error ? err.message : String(err);
    await safeLog(supabase, { workspace_id: wsId, source: step, status: 'error', rows_written: 0, message, started_at: startedAt, finished_at: new Date().toISOString() });
    return { step, ok: false, detail: message, ms };
  }
}

/**
 * The nightly chain: incremental syncs -> detect -> narrate -> summarize.
 * Each step is logged to sync_log; a failed step is recorded but does not abort
 * the others. Actions and Ask AI are intentionally NOT here (they are on-demand).
 */
export async function runDailyPipeline(opts: { workspaceId?: string; incrementalDays?: number } = {}): Promise<PipelineReport> {
  const supabase = getSupabaseAdmin();
  const startedAtIso = new Date().toISOString();
  const t0 = Date.now();
  const incDays = opts.incrementalDays ?? 7;

  const workspaceId = opts.workspaceId ?? (await resolveWorkspace(supabase));
  const propertyId = await loadConfig(supabase, workspaceId, 'ga4', 'property_id');
  const siteUrl = await loadConfig(supabase, workspaceId, 'gsc', 'site_url');

  const end = new Date();
  const endIso = end.toISOString().slice(0, 10);
  const startIso = isoDaysAgo(end, incDays - 1);
  const window = { start: startIso, end: endIso };

  const steps: StepResult[] = [];

  // 1 — GA4 channel + page slices (incremental)
  steps.push(
    await runStep(supabase, workspaceId, 'sync_ga4', async () => {
      if (!propertyId) throw new Error('GA4 data source has no property_id');
      const rows = await syncGa4({ workspaceId, propertyId, startDate: startIso, endDate: endIso });
      return { rows, detail: `${rows} rows (channel+page, ${startIso}..${endIso})` };
    }),
  );

  // 2 — GA4 country + source slices (incremental)
  steps.push(
    await runStep(supabase, workspaceId, 'sync_ga4_slices', async () => {
      if (!propertyId) throw new Error('GA4 data source has no property_id');
      const r = await syncGa4Slices({ workspaceId, propertyId, startDate: startIso, endDate: endIso });
      return { rows: r.country + r.source, detail: `${r.country} country + ${r.source} source rows` };
    }),
  );

  // 3 — Search Console (incremental)
  steps.push(
    await runStep(supabase, workspaceId, 'sync_gsc', async () => {
      if (!siteUrl) throw new Error('GSC data source has no site_url');
      const rows = await syncGsc({ workspaceId, siteUrl, startDate: startIso, endDate: endIso });
      return { rows, detail: `${rows} rows (${startIso}..${endIso})` };
    }),
  );

  // 4 — Clarity (env-credentialed; last 3 days, within the 10-req/day budget)
  steps.push(
    await runStep(supabase, workspaceId, 'sync_clarity', async () => {
      const r = await syncClarity({ workspaceId, numOfDays: 3 });
      return { rows: r.rows, detail: `${r.rows} rows (last 3 days)` };
    }),
  );

  // 5 — detectors (all 22; per-detector errors are tolerated)
  steps.push(
    await runStep(supabase, workspaceId, 'detect', async () => {
      let active = 0;
      let resolved = 0;
      const errs: string[] = [];
      for (const d of detectors) {
        try {
          const r = await d.run({ workspaceId });
          active += r.found;
          resolved += r.resolved;
        } catch (e) {
          errs.push(`${d.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (detectors.length > 0 && errs.length === detectors.length) {
        throw new Error(`all detectors failed (first: ${errs[0]})`);
      }
      const errNote = errs.length ? `; ${errs.length} detector error(s): ${errs.slice(0, 3).join(' | ')}` : '';
      return { rows: active, detail: `${active} active across ${detectors.length} detectors, ${resolved} resolved${errNote}` };
    }),
  );

  // 6 — narrate (hash-gated; only new/changed insights cost anything)
  steps.push(
    await runStep(supabase, workspaceId, 'narrate', async () => {
      const r = await narrateInsights({ workspaceId, limit: 200 });
      return { rows: r.narrated, detail: `checked ${r.checked}, narrated ${r.narrated}, skipped ${r.skipped}, failed ${r.failed}` };
    }),
  );

  // 7 — big-picture summary (hash-gated)
  steps.push(
    await runStep(supabase, workspaceId, 'summarize', async () => {
      const r = await generateSummary({ workspaceId });
      const detail = r.status === 'created' ? `created (${r.activeCount} findings, ${r.storyCount} stories)` : `skipped: ${r.reason}`;
      return { rows: r.status === 'created' ? 1 : 0, detail };
    }),
  );

  return {
    ok: steps.every((s) => s.ok),
    workspaceId,
    window,
    startedAt: startedAtIso,
    finishedAt: new Date().toISOString(),
    totalMs: Date.now() - t0,
    steps,
  };
}

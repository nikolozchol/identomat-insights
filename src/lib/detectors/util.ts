import { getSupabaseAdmin } from '../supabase';

export type InsightInsert = {
  workspace_id: string;
  detector: string;
  category: string;
  severity: string;
  polarity: string;
  title: string;
  evidence: Record<string, unknown>;
  sources: string[];
  dedupe_key: string;
};

export type DetectorResult = { found: number; written: number; resolved: number; reactivated: number };

type ExistingRow = { id: string; dedupe_key: string; status: string };

// Writes a detector's current findings and manages the full insight lifecycle:
// - upserts current matches (status omitted, so manual dismiss/snooze is preserved)
// - reactivates an insight that was auto-resolved but now matches again
// - resolves insights that were active but are no longer detected (fixed / no longer qualifying)
export async function writeInsights(opts: {
  workspaceId: string;
  detector: string;
  rows: InsightInsert[];
}): Promise<DetectorResult> {
  const supabase = getSupabaseAdmin();
  const { workspaceId, detector, rows } = opts;
  const BATCH = 500;

  const { data: existingData, error: exErr } = await supabase
    .from('insights')
    .select('id, dedupe_key, status')
    .eq('workspace_id', workspaceId)
    .eq('detector', detector);
  if (exErr) throw new Error(`load existing failed: ${exErr.message}`);
  const existing = (existingData ?? []) as ExistingRow[];

  const currentKeys = new Set(rows.map((r) => r.dedupe_key));

  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from('insights')
      .upsert(batch, { onConflict: 'workspace_id,dedupe_key' });
    if (error) throw new Error(`insights upsert failed: ${error.message}`);
    written += batch.length;
  }

  const reactivateIds = existing
    .filter((e) => currentKeys.has(e.dedupe_key) && e.status === 'resolved')
    .map((e) => e.id);
  let reactivated = 0;
  for (let i = 0; i < reactivateIds.length; i += BATCH) {
    const chunk = reactivateIds.slice(i, i + BATCH);
    const { error } = await supabase.from('insights').update({ status: 'active' }).in('id', chunk);
    if (error) throw new Error(`reactivate failed: ${error.message}`);
    reactivated += chunk.length;
  }

  const staleIds = existing
    .filter((e) => !currentKeys.has(e.dedupe_key) && e.status === 'active')
    .map((e) => e.id);
  let resolved = 0;
  for (let i = 0; i < staleIds.length; i += BATCH) {
    const chunk = staleIds.slice(i, i + BATCH);
    const { error } = await supabase.from('insights').update({ status: 'resolved' }).in('id', chunk);
    if (error) throw new Error(`resolve stale failed: ${error.message}`);
    resolved += chunk.length;
  }

  return { found: rows.length, written, resolved, reactivated };
}

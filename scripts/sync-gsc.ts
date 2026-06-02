import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getSupabaseAdmin } from '../src/lib/supabase';
import { syncGsc } from '../src/lib/sync/gsc';

async function main() {
  const supabase = getSupabaseAdmin();

  const { data: ws, error: wsErr } = await supabase
    .from('workspaces').select('id, name').limit(1).single();
  if (wsErr || !ws) throw new Error(`No workspace found: ${wsErr?.message ?? 'empty'}`);

  const { data: ds, error: dsErr } = await supabase
    .from('data_sources').select('config').eq('workspace_id', ws.id).eq('type', 'gsc').single();
  if (dsErr || !ds) throw new Error(`No GSC data source: ${dsErr?.message ?? 'empty'}`);

  const cfg = ds.config as { site_url?: string };
  const siteUrl = cfg?.site_url;
  if (!siteUrl) throw new Error('GSC data source config has no site_url');

  const startedAt = new Date().toISOString();
  console.log(`Syncing Search Console for ${siteUrl}, workspace "${ws.name}" (last 90 days)...`);

  try {
    const rows = await syncGsc({ workspaceId: ws.id, siteUrl });
    console.log(`\n✅ GSC sync complete — ${rows} rows upserted into gsc_daily.`);
    await supabase.from('sync_log').insert({
      workspace_id: ws.id, source: 'gsc', status: 'success',
      rows_written: rows, started_at: startedAt, finished_at: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ GSC sync failed: ${msg}`);
    await supabase.from('sync_log').insert({
      workspace_id: ws.id, source: 'gsc', status: 'error',
      message: msg, started_at: startedAt, finished_at: new Date().toISOString(),
    });
    process.exitCode = 1;
  }
}

main();

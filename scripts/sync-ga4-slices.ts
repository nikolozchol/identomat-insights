import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getSupabaseAdmin } from '../src/lib/supabase';
import { syncGa4Slices } from '../src/lib/sync/ga4Slices';

async function main() {
  const supabase = getSupabaseAdmin();

  const { data: ws, error: wsErr } = await supabase
    .from('workspaces').select('id, name').limit(1).single();
  if (wsErr || !ws) throw new Error(`No workspace found: ${wsErr?.message ?? 'empty'}`);

  const { data: ds, error: dsErr } = await supabase
    .from('data_sources').select('config').eq('workspace_id', ws.id).eq('type', 'ga4').single();
  if (dsErr || !ds) throw new Error(`No GA4 data source: ${dsErr?.message ?? 'empty'}`);

  const cfg = ds.config as { property_id?: string };
  const propertyId = cfg?.property_id;
  if (!propertyId) throw new Error('GA4 data source config has no property_id');

  const startedAt = new Date().toISOString();
  console.log(`Syncing GA4 country + referral-source slices for "${ws.name}" (last 90 days)...`);

  try {
    const { country, source } = await syncGa4Slices({ workspaceId: ws.id, propertyId });
    console.log(`\n✅ GA4 slices synced — ${country} country rows, ${source} referral-source rows upserted.`);
    await supabase.from('sync_log').insert({
      workspace_id: ws.id, source: 'ga4', status: 'success',
      rows_written: country + source, message: 'ga4 country+source slices',
      started_at: startedAt, finished_at: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ GA4 slices sync failed: ${msg}`);
    await supabase.from('sync_log').insert({
      workspace_id: ws.id, source: 'ga4', status: 'error',
      message: `slices: ${msg}`, started_at: startedAt, finished_at: new Date().toISOString(),
    });
    process.exitCode = 1;
  }
}

main();

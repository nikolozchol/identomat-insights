import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getSupabaseAdmin } from '../src/lib/supabase';
import { syncClarity } from '../src/lib/sync/clarity';

async function main() {
  const supabase = getSupabaseAdmin();
  const { data: ws, error } = await supabase
    .from('workspaces').select('id, name').limit(1).single();
  if (error || !ws) throw new Error(`No workspace: ${error?.message ?? 'empty'}`);

  const today = new Date().toISOString().slice(0, 10);
  console.log(`Syncing Clarity for "${ws.name}" (${today})...`);
  const started = new Date().toISOString();
  try {
    const r = await syncClarity({ workspaceId: ws.id, numOfDays: 1 });
    console.log(`Clarity sync: ${r.rows} page-rows upserted for ${today}.`);
    await supabase.from('sync_log').insert({
      workspace_id: ws.id, source: 'clarity', status: 'success',
      rows_written: r.rows, started_at: started, finished_at: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Clarity sync failed: ${msg}`);
    await supabase.from('sync_log').insert({
      workspace_id: ws.id, source: 'clarity', status: 'error',
      message: msg, started_at: started, finished_at: new Date().toISOString(),
    });
    process.exitCode = 1;
  }
}
main();

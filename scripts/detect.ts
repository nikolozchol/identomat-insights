import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getSupabaseAdmin } from '../src/lib/supabase';
import { detectors } from '../src/lib/detectors';

async function main() {
  const supabase = getSupabaseAdmin();
  const { data: ws, error } = await supabase
    .from('workspaces').select('id, name').limit(1).single();
  if (error || !ws) throw new Error(`No workspace: ${error?.message ?? 'empty'}`);

  console.log(`Running ${detectors.length} detectors for "${ws.name}"...\n`);
  let active = 0;
  let resolvedTotal = 0;
  for (const d of detectors) {
    try {
      const r = await d.run({ workspaceId: ws.id });
      const extra = r.resolved || r.reactivated
        ? ` (${r.resolved} resolved, ${r.reactivated} reactivated)`
        : '';
      console.log(`  ${d.name.padEnd(34)} ${r.found} active${extra}`);
      active += r.found;
      resolvedTotal += r.resolved;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ${d.name.padEnd(34)} ERROR: ${msg}`);
    }
  }
  console.log(`\nDone. ${active} active insights across ${detectors.length} detectors; ${resolvedTotal} resolved this run.`);
}

main();

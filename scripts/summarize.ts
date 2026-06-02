import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getSupabaseAdmin } from '../src/lib/supabase';
import { generateSummary } from '../src/lib/summarize';

async function main() {
  const supabase = getSupabaseAdmin();
  const { data: ws, error } = await supabase
    .from('workspaces')
    .select('id, name')
    .limit(1)
    .single();
  if (error || !ws) throw new Error(`No workspace: ${error?.message ?? 'empty'}`);

  const force = process.argv.includes('--force');
  console.log(`Generating big-picture summary for "${ws.name}"${force ? ' (forced)' : ''}...\n`);

  const r = await generateSummary({ workspaceId: ws.id, force });
  if (r.status === 'skipped') {
    console.log(`Skipped: ${r.reason}. Latest summary is still current — no API spend.`);
  } else {
    console.log(`Created summary · ${r.activeCount} active findings · ${r.storyCount} stories · model ${r.model}.`);
    console.log(`\nHeadline: ${r.headline}`);
  }
}

main();

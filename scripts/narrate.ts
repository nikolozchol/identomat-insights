import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getSupabaseAdmin } from '../src/lib/supabase';
import { narrateInsights } from '../src/lib/narrate';

async function main() {
  const supabase = getSupabaseAdmin();
  const { data: ws, error } = await supabase
    .from('workspaces').select('id, name').limit(1).single();
  if (error || !ws) throw new Error(`No workspace: ${error?.message ?? 'empty'}`);

  console.log(`Narrating active insights for "${ws.name}"...\n`);
  const r = await narrateInsights({ workspaceId: ws.id, limit: 100 });
  console.log(`\nChecked ${r.checked} · narrated ${r.narrated} · skipped ${r.skipped} (already current) · failed ${r.failed}.`);
}

main();

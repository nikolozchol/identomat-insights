import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getSupabaseAdmin } from '../src/lib/supabase';
import { generateActions } from '../src/lib/actions';

async function main() {
  const supabase = getSupabaseAdmin();
  const { data: ws, error } = await supabase
    .from('workspaces').select('id, name').limit(1).single();
  if (error || !ws) throw new Error(`No workspace: ${error?.message ?? 'empty'}`);

  console.log(`Generating action briefs for "${ws.name}"...\n`);
  const r = await generateActions({ workspaceId: ws.id, limit: 50 });
  console.log(`\nCandidates ${r.candidates} · created ${r.created} · failed ${r.failed}.`);
}
main();

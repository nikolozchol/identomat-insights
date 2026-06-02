import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getSupabaseAdmin } from '../src/lib/supabase';
import { crawlSite } from '../src/lib/crawl/site';

async function main() {
  const supabase = getSupabaseAdmin();
  const { data: ws, error: wsErr } = await supabase
    .from('workspaces').select('id, name').limit(1).single();
  if (wsErr || !ws) throw new Error(`No workspace found: ${wsErr?.message ?? 'empty'}`);

  const { data: ds, error: dsErr } = await supabase
    .from('data_sources').select('config').eq('workspace_id', ws.id).eq('type', 'gsc').single();
  if (dsErr || !ds) throw new Error(`No GSC data source (needed for site_url): ${dsErr?.message ?? 'empty'}`);
  const siteUrl = (ds.config as { site_url?: string })?.site_url;
  if (!siteUrl) throw new Error('GSC data source config has no site_url');

  const startedAt = new Date().toISOString();
  console.log(`Crawling ${siteUrl} for "${ws.name}"...`);
  try {
    const r = await crawlSite({ workspaceId: ws.id, siteUrl });
    console.log(`\n✅ Crawl complete — ${r.crawled} pages crawled, ${r.written} upserted into pages.\n   ${r.withDate} have a last-modified date; ${r.orphans} have 0 inbound internal links.`);
    await supabase.from('sync_log').insert({
      workspace_id: ws.id, source: 'crawl', status: 'success',
      rows_written: r.written, message: `crawl: ${r.withDate} dated, ${r.orphans} orphans`,
      started_at: startedAt, finished_at: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ Crawl failed: ${msg}`);
    await supabase.from('sync_log').insert({
      workspace_id: ws.id, source: 'crawl', status: 'error',
      message: msg, started_at: startedAt, finished_at: new Date().toISOString(),
    });
    process.exitCode = 1;
  }
}
main();

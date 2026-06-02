import { google } from 'googleapis';
import { getGoogleAuth } from '../google';
import { getSupabaseAdmin } from '../supabase';

type GscRow = {
  workspace_id: string;
  date: string;
  page_path: string;
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

function pathOf(url: string): string {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return url;
  }
}

// Merge rows that collapse to the same (date, page_path, query) after normalizing URLs.
// Clicks/impressions sum; CTR and position become impression-weighted averages.
function dedupe(rows: GscRow[]): GscRow[] {
  const map = new Map<string, GscRow & { _posWeight: number }>();
  for (const r of rows) {
    const key = `${r.date}|${r.page_path}|${r.query}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...r, _posWeight: r.position * r.impressions });
    } else {
      existing.clicks += r.clicks;
      existing.impressions += r.impressions;
      existing._posWeight += r.position * r.impressions;
    }
  }
  const out: GscRow[] = [];
  for (const r of map.values()) {
    const { _posWeight, ...row } = r;
    row.ctr = row.impressions > 0 ? row.clicks / row.impressions : 0;
    row.position = row.impressions > 0 ? _posWeight / row.impressions : row.position;
    out.push(row);
  }
  return out;
}

async function upsertRows(rows: GscRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const supabase = getSupabaseAdmin();
  const BATCH = 500;
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from('gsc_daily')
      .upsert(batch, { onConflict: 'workspace_id,date,page_path,query' });
    if (error) throw new Error(`gsc_daily upsert failed: ${error.message}`);
    written += batch.length;
  }
  return written;
}

export async function syncGsc(opts: {
  workspaceId: string;
  siteUrl: string;
  startDate?: string;
  endDate?: string;
}): Promise<number> {
  const { workspaceId, siteUrl } = opts;
  const endDate = opts.endDate ?? new Date().toISOString().slice(0, 10);
  const startDate = opts.startDate ?? new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);

  const auth = getGoogleAuth();
  const sc = google.searchconsole({ version: 'v1', auth });

  const PAGE = 25000;
  const MAX_PAGES = 10;
  const all: GscRow[] = [];

  for (let p = 0; p < MAX_PAGES; p++) {
    const res = await sc.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate,
        endDate,
        dimensions: ['date', 'page', 'query'],
        rowLimit: PAGE,
        startRow: p * PAGE,
      },
    });
    const rows = res.data.rows ?? [];
    for (const r of rows) {
      const keys = r.keys ?? [];
      all.push({
        workspace_id: workspaceId,
        date: keys[0] ?? '',
        page_path: pathOf(keys[1] ?? '/'),
        query: keys[2] ?? '',
        clicks: r.clicks ?? 0,
        impressions: r.impressions ?? 0,
        ctr: r.ctr ?? 0,
        position: r.position ?? 0,
      });
    }
    if (rows.length < PAGE) break;
    if (p === MAX_PAGES - 1) {
      console.warn(`  GSC hit the ${MAX_PAGES}-page cap; some rows may be unfetched.`);
    }
  }

  return upsertRows(dedupe(all));
}

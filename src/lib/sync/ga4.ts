import { google } from 'googleapis';
import { getGoogleAuth } from '../google';
import { getSupabaseAdmin } from '../supabase';

type Ga4Row = {
  workspace_id: string;
  date: string;
  page_path: string;
  channel: string;
  country: string;
  sessions: number;
  engaged_sessions: number;
  engagement_rate: number | null;
  avg_engagement_time: number | null;
  conversions: number;
};

const ALL = '(all)';
const SITE = '(site)';

function ymdToIso(d: string): string {
  return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d;
}
function num(v: string | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function upsertRows(rows: Ga4Row[]): Promise<number> {
  if (rows.length === 0) return 0;
  const supabase = getSupabaseAdmin();
  const BATCH = 500;
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from('ga4_daily')
      .upsert(batch, { onConflict: 'workspace_id,date,page_path,channel,country' });
    if (error) throw new Error(`ga4_daily upsert failed: ${error.message}`);
    written += batch.length;
  }
  return written;
}

export async function syncGa4(opts: {
  workspaceId: string;
  propertyId: string;
  startDate?: string;
  endDate?: string;
}): Promise<number> {
  const { workspaceId, propertyId } = opts;
  const startDate = opts.startDate ?? '90daysAgo';
  const endDate = opts.endDate ?? 'today';

  const auth = getGoogleAuth();
  const analytics = google.analyticsdata({ version: 'v1beta', auth });

  const channelRows: Ga4Row[] = [];
  {
    const res = await analytics.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }],
        metrics: [
          { name: 'sessions' },
          { name: 'engagedSessions' },
          { name: 'userEngagementDuration' },
          { name: 'conversions' },
        ],
        limit: '100000',
      },
    });
    for (const r of res.data.rows ?? []) {
      const dv = r.dimensionValues ?? [];
      const mv = r.metricValues ?? [];
      const sessions = num(mv[0]?.value);
      channelRows.push({
        workspace_id: workspaceId,
        date: ymdToIso(dv[0]?.value ?? ''),
        page_path: SITE,
        channel: dv[1]?.value || '(other)',
        country: ALL,
        sessions,
        engaged_sessions: num(mv[1]?.value),
        engagement_rate: null,
        avg_engagement_time: sessions > 0 ? num(mv[2]?.value) / sessions : 0,
        conversions: num(mv[3]?.value),
      });
    }
  }

  const pageRows: Ga4Row[] = [];
  {
    const res = await analytics.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'date' }, { name: 'pagePath' }],
        metrics: [
          { name: 'sessions' },
          { name: 'engagedSessions' },
          { name: 'engagementRate' },
          { name: 'conversions' },
        ],
        limit: '100000',
      },
    });
    if (res.data.rowCount && res.data.rowCount > (res.data.rows?.length ?? 0)) {
      console.warn(`  GA4 page slice returned ${res.data.rows?.length} of ${res.data.rowCount} rows (capped).`);
    }
    for (const r of res.data.rows ?? []) {
      const dv = r.dimensionValues ?? [];
      const mv = r.metricValues ?? [];
      pageRows.push({
        workspace_id: workspaceId,
        date: ymdToIso(dv[0]?.value ?? ''),
        page_path: dv[1]?.value || '/',
        channel: ALL,
        country: ALL,
        sessions: num(mv[0]?.value),
        engaged_sessions: num(mv[1]?.value),
        engagement_rate: num(mv[2]?.value),
        avg_engagement_time: null,
        conversions: num(mv[3]?.value),
      });
    }
  }

  return upsertRows([...channelRows, ...pageRows]);
}

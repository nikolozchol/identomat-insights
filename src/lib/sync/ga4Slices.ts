import { google } from 'googleapis';
import { getGoogleAuth } from '../google';
import { getSupabaseAdmin } from '../supabase';

// Two extra GA4 slices written into ga4_daily WITHOUT touching the unique key
// (workspace_id, date, page_path, channel, country) or any existing detector.
//
// Sentinels are chosen so the existing functions can't read them:
//   - Country slice:  page_path='(country)', channel='(country)', country=<real>
//       * ga4_channel_wow filters page_path='(site)'  -> excluded
//       * the page detectors filter channel='(all)'   -> excluded (channel is '(country)')
//   - Source slice:   page_path='(source)',  channel=<referral source>, country='(all)'
//       * ga4_channel_wow filters page_path='(site)'  -> excluded
//       * the page detectors filter channel='(all)'   -> excluded (channel is the source)

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
const COUNTRY = '(country)';
const SOURCE = '(source)';

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

export async function syncGa4Slices(opts: {
  workspaceId: string;
  propertyId: string;
  startDate?: string;
  endDate?: string;
}): Promise<{ country: number; source: number }> {
  const { workspaceId, propertyId } = opts;
  const startDate = opts.startDate ?? '90daysAgo';
  const endDate = opts.endDate ?? 'today';

  const auth = getGoogleAuth();
  const analytics = google.analyticsdata({ version: 'v1beta', auth });

  // Slice A — country (date x country). page_path & channel are sentinels.
  const countryRows: Ga4Row[] = [];
  {
    const res = await analytics.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'date' }, { name: 'country' }],
        metrics: [{ name: 'sessions' }, { name: 'conversions' }],
        limit: '100000',
      },
    });
    for (const r of res.data.rows ?? []) {
      const dv = r.dimensionValues ?? [];
      const mv = r.metricValues ?? [];
      const country = dv[1]?.value || '(not set)';
      countryRows.push({
        workspace_id: workspaceId,
        date: ymdToIso(dv[0]?.value ?? ''),
        page_path: COUNTRY,
        channel: COUNTRY,
        country,
        sessions: num(mv[0]?.value),
        engaged_sessions: 0,
        engagement_rate: null,
        avg_engagement_time: null,
        conversions: num(mv[1]?.value),
      });
    }
  }

  // Slice B — referral source (date x sessionSource), filtered to medium = 'referral'.
  // The source domain is stored in `channel`; page_path is the '(source)' sentinel.
  const sourceRows: Ga4Row[] = [];
  {
    const res = await analytics.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'date' }, { name: 'sessionSource' }],
        metrics: [{ name: 'sessions' }, { name: 'conversions' }],
        dimensionFilter: {
          filter: {
            fieldName: 'sessionMedium',
            stringFilter: { matchType: 'EXACT', value: 'referral' },
          },
        },
        limit: '100000',
      },
    });
    for (const r of res.data.rows ?? []) {
      const dv = r.dimensionValues ?? [];
      const mv = r.metricValues ?? [];
      const source = dv[1]?.value || '(not set)';
      sourceRows.push({
        workspace_id: workspaceId,
        date: ymdToIso(dv[0]?.value ?? ''),
        page_path: SOURCE,
        channel: source,
        country: ALL,
        sessions: num(mv[0]?.value),
        engaged_sessions: 0,
        engagement_rate: null,
        avg_engagement_time: null,
        conversions: num(mv[1]?.value),
      });
    }
  }

  const country = await upsertRows(countryRows);
  const source = await upsertRows(sourceRows);
  return { country, source };
}

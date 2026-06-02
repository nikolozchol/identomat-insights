require('dotenv').config({ path: '.env.local' });
const { google } = require('googleapis');

const PROPERTY_ID = '402465600';
const SITE_URL = 'https://www.identomat.com';

// Build an authenticated OAuth client from the .env.local credentials
const auth = new google.auth.OAuth2(
  process.env.GOOGLE_OAUTH_CLIENT_ID,
  process.env.GOOGLE_OAUTH_CLIENT_SECRET
);
auth.setCredentials({ refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN });

async function testGA4() {
  console.log('\n──────── GA4 (last 7 days) ────────');
  try {
    const analytics = google.analyticsdata({ version: 'v1beta', auth });
    const res = await analytics.properties.runReport({
      property: `properties/${PROPERTY_ID}`,
      requestBody: {
        dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }, { name: 'conversions' }],
        limit: 10,
      },
    });
    const rows = res.data.rows || [];
    if (rows.length === 0) {
      console.log('Connected ✅ — but 0 rows (low traffic in range, still a success).');
    } else {
      console.log('Connected ✅ — sessions by channel:');
      rows.forEach(r => {
        console.log(`   ${r.dimensionValues[0].value.padEnd(20)} ${r.metricValues[0].value} sessions`);
      });
    }
  } catch (e) {
    console.log('GA4 ❌', e.message);
  }
}

async function testGSC() {
  console.log('\n──────── Search Console (last 7 days) ────────');
  try {
    const sc = google.searchconsole({ version: 'v1', auth });
    const res = await sc.searchanalytics.query({
      siteUrl: SITE_URL,
      requestBody: {
        startDate: new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10),
        endDate: new Date().toISOString().slice(0, 10),
        dimensions: ['query'],
        rowLimit: 5,
      },
    });
    const rows = res.data.rows || [];
    if (rows.length === 0) {
      console.log('Connected ✅ — but 0 rows (GSC has ~2–3 day lag, still a success).');
    } else {
      console.log('Connected ✅ — top queries:');
      rows.forEach(r => {
        console.log(`   "${r.keys[0]}" — ${r.clicks} clicks, ${r.impressions} impr, pos ${r.position.toFixed(1)}`);
      });
    }
  } catch (e) {
    console.log('GSC ❌', e.message);
  }
}

(async () => {
  await testGA4();
  await testGSC();
  console.log('\n────────────────────────────────────\n');
})();

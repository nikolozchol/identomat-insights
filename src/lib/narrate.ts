import { createHash } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { getSupabaseAdmin } from './supabase';

const MODEL = 'claude-haiku-4-5-20251001';

type InsightRow = {
  id: string;
  detector: string;
  category: string;
  severity: string;
  polarity: string;
  title: string;
  evidence: Record<string, unknown> | null;
  narrated_hash: string | null;
};

const GUIDANCE: Record<string, string> = {
  query_high_impressions_no_click:
    'High impressions with low CTR at a strong position can mean: (a) AI Overviews or featured snippets answering the query directly in the results page (zero-click, common for informational queries); (b) a weak title/description; or (c) strong competitors ranking above. Use the `intent` and `likely_zero_click` fields. If zero-click is likely, frame it as a visibility situation (the brand is still being seen) and suggest making the page the cited source for AI answers. Do NOT call it a title/metadata problem when zero-click is likely.',
  traffic_drop_by_page:
    'A drop can be seasonal, a ranking loss, or a tracking/tagging change. State the magnitude and suggest investigating the cause rather than asserting one.',
  traffic_spike:
    'This is positive news. Note what grew and suggest how to capitalize on it. Keep an encouraging, energizing tone.',
  traffic_no_conversion:
    'The page attracts visits but produces no demo requests. Note that GA4 "conversions" counts whichever key events are configured, which may include more than demo requests. Suggest checking whether the page has a clear, visible call to action and whether the traffic intent matches the page.',
  query_position_decline:
    'A ranking drop can come from a Google algorithm update, new competitors, or content going stale. State the movement (from/to position) and suggest investigating the cause; do not assert a single reason.',
  query_reached_page_1:
    'Positive news: the query crossed onto page 1. Encourage capitalizing on it (strengthen the page, add internal links) to push toward the top spots. Keep an encouraging tone.',
  page_clicks_lost:
    'A clicks drop can be a ranking loss OR AI Overviews / featured snippets answering in-SERP. Check the impressions: if impressions held steady or rose while clicks fell, that points to zero-click capture rather than lost rankings. Suggest investigating rather than assuming a single cause.',
  page_clicks_gained:
    'Positive news: search clicks to this page grew. Note the gain and suggest doubling down on what is working. Keep an encouraging tone.',
  demo_request_drop:
    'Demo requests fell site-wide. Note that GA4 \'conversions\' counts whichever key events are configured (may include more than demo form submissions). Suggest checking recent site, campaign, or tracking changes before concluding a cause. State the magnitude.',
  source_decline:
    'A traffic channel declined. For Direct or Unassigned, a drop can mean campaign links lost their UTM tags (misattribution) rather than a real loss \u2014 mention that possibility for those channels. For other channels, suggest investigating that channel specifically.',
  channel_mix_shift:
    'A channel grew its share of total traffic. If the channel is Direct or Unassigned, a surge (especially above ~half of all traffic) usually means tracking/UTM gaps \u2014 campaign, referral, or email links losing their tags and being miscounted as Direct. In that case frame it as a tracking issue to investigate, NOT as real growth. For any other channel (Organic, Email, Referral, Paid, Social) it is a genuine momentum opportunity worth leaning into. Use the `likely_tracking_gap` field.',
  best_converting_channel:
    'This channel converts visits into demo requests at a notably higher rate than the site average. If its traffic share is small it is underused \u2014 frame as an opportunity to invest more in it. Reference the conversion rate and the traffic share.',
  high_rage_clicks:
    'Rage clicks (rapid repeated clicks in one spot) signal user frustration \u2014 usually a broken or unresponsive element, a misleading button, or something slow to load. Reference the percentage of sessions affected and suggest checking what users are clicking on that page.',
  dead_clicks_on_static:
    'Dead clicks are clicks on things that do not respond. Users expect a link or button and nothing happens. Suggest checking whether non-interactive elements look clickable, or whether an intended link is broken. Reference the percentage of sessions.',
  quick_back:
    'A quick back (pogo-sticking) means visitors arrived and almost immediately returned to where they came from \u2014 the page likely did not match their expectation. Suggest checking intent match, load speed, and above-the-fold clarity. Reference the percentage of sessions.',
  js_errors:
    'Some sessions recorded a JavaScript error on this page. High error rates are common and often harmless; many come from third-party scripts, analytics, ad or marketing tags, or browser extensions and never affect what the visitor can do. Treat this as worth a quick check, NOT as proof the site is broken. Do NOT claim it is breaking forms, blocking submissions, or hurting conversions; at most say it may be worth having a developer confirm nothing user-facing is affected. Reference the percentage of sessions affected and keep it measured.',
  cta_not_reached:
    'Visitors are not scrolling far down this page (low average scroll depth), so content and calls-to-action lower on the page may never be seen. Suggest moving key messages and CTAs higher up. Reference the average scroll depth percentage.',
  country_shift:
    'A country changed its share of total site traffic. If it grew (direction up), treat it as an emerging market opportunity \u2014 a global identity-verification company may want localized content, language, or compliance messaging for it. If it fell (direction down), frame it as a market to investigate, not a certainty. Reference the share change and session counts; do not assert a single cause.',
  stale_traffic_page:
    'This page still attracts real traffic but its content has not been updated in a long time. Stale pages tend to slowly lose rankings and relevance. Suggest a content refresh (update facts, dates, examples) to defend and grow the traffic it already earns. Reference the session count and how long since it was updated.',
  orphan_high_intent:
    'This page earns traffic but almost nothing on the site links to it internally, so search engines and visitors struggle to discover it and it misses link equity. Suggest adding internal links to it from related, higher-authority pages. Reference the session count and the inbound-link count.',
  referral_spike:
    'A referral source (another website linking to you) is newly sending traffic or has surged. This is positive \u2014 it could be a press mention, a directory listing, a partner, or a community post. Suggest finding the link and capitalizing on it (thank/partner, ensure the linked page converts). Reference the source name and session count. Keep an encouraging tone.',
};

function buildFacts(row: InsightRow): string {
  const lines: string[] = [];
  lines.push(`Category: ${row.category}`);
  lines.push(`Severity: ${row.severity}`);
  lines.push(`Polarity: ${row.polarity}`);
  lines.push(`Headline: ${row.title}`);
  lines.push('Verified data:');
  const ev = row.evidence ?? {};
  for (const [k, v] of Object.entries(ev)) {
    lines.push(`- ${k}: ${typeof v === 'number' ? v : JSON.stringify(v)}`);
  }
  return lines.join('\n');
}

function hashFacts(facts: string): string {
  return createHash('sha256').update(facts).digest('hex');
}

const SYSTEM = [
  'You are a marketing analytics assistant for an internal tool used by a non-technical marketing team.',
  'You are given verified facts about a single website finding, already computed from real data.',
  'Write a SHORT explanation (1-2 sentences, max ~45 words).',
  "The finding's Polarity tells you its nature: 'issue' (something is wrong or declining), 'opportunity' (untapped upside), or 'win' (something is going well). Match your tone and framing to it.",
  'Rules:',
  '- Use ONLY the numbers and facts provided. Never invent, estimate, or add figures that are not given.',
  '- Do not assert a cause or a downstream effect that is not stated in the data. Describe any possible cause or effect as a possibility with words like "may" or "could", never as established fact.',
  '- Do not claim one finding causes another (for example that errors are "breaking" the site or "preventing" conversions) unless the data states it; prefer "may affect" over "is breaking".',
  '- Be concrete and reference the actual numbers.',
  '- Explain why it matters and hint at what to do, in plain language.',
  '- No preamble, no bullet points, no markdown headers. Just the sentence(s).',
].join('\n');

async function narrateOne(client: Anthropic, facts: string, guidance: string | undefined): Promise<string> {
  const content = guidance ? `${facts}\n\nInterpretation guidance:\n${guidance}` : facts;
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 200,
    system: SYSTEM,
    messages: [{ role: 'user', content }],
  });
  const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
  if (!text) throw new Error('empty narrative from model');
  return text;
}

export async function narrateInsights(opts: {
  workspaceId: string; limit?: number;
}): Promise<{ checked: number; narrated: number; skipped: number; failed: number }> {
  const supabase = getSupabaseAdmin();
  const limit = opts.limit ?? 200;

  const { data, error } = await supabase
    .from('insights')
    .select('id, detector, category, severity, polarity, title, evidence, narrated_hash')
    .eq('workspace_id', opts.workspaceId)
    .eq('status', 'active')
    .order('detected_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`load insights failed: ${error.message}`);

  const rows = (data ?? []) as InsightRow[];
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY');
  const client = new Anthropic({ apiKey });

  let narrated = 0;
  let skipped = 0;
  let failed = 0;

  // Process one insight: hash-skip if unchanged, otherwise narrate and write back
  // (with a templated fallback if the call ultimately fails). Identical work to the
  // old sequential version -- only the scheduling changed.
  async function processRow(row: InsightRow): Promise<void> {
    const facts = buildFacts(row);
    const hash = hashFacts(facts);
    if (row.narrated_hash && row.narrated_hash === hash) {
      skipped++;
      return;
    }
    try {
      // Retry/backoff on transient errors (429 rate limit, 529 overloaded, 5xx) so
      // parallel calls that hit a limit wait and retry instead of falling back.
      let narrative = '';
      let delay = 500;
      for (let attempt = 1; ; attempt++) {
        try {
          narrative = await narrateOne(client, facts, GUIDANCE[row.detector]);
          break;
        } catch (e) {
          const status = (e as { status?: number }).status;
          const transient = status === 429 || status === 529 || (typeof status === 'number' && status >= 500);
          if (!transient || attempt >= 4) throw e;
          await new Promise((r) => setTimeout(r, delay + Math.floor(Math.random() * 250)));
          delay *= 2;
        }
      }
      const { error: upErr } = await supabase
        .from('insights')
        .update({ narrative, narrated_at: new Date().toISOString(), narrated_hash: hash, narrative_model: MODEL })
        .eq('id', row.id);
      if (upErr) throw new Error(upErr.message);
      narrated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  narration failed for "${row.title}": ${msg} - using fallback.`);
      await supabase
        .from('insights')
        .update({ narrative: `${row.title}.`, narrated_at: new Date().toISOString(), narrated_hash: null, narrative_model: 'fallback' })
        .eq('id', row.id);
      failed++;
    }
  }

  // Bounded concurrency: up to CONCURRENCY narrations in flight at once. This keeps
  // the nightly run well under the cron's time budget; the backoff above absorbs
  // any rate-limit bursts so we don't degrade to fallbacks under load.
  const CONCURRENCY = 5;
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      await processRow(row);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, () => worker()));
  return { checked: rows.length, narrated, skipped, failed };
}

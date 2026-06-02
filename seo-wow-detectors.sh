#!/usr/bin/env bash
set -e
echo "Adding SEO week-over-week detectors (6 files)..."
mkdir -p src/lib/detectors
cat > src/lib/detectors/queryPositionDecline.ts << '__IDENTOMAT_EOF__'
import { getSupabaseAdmin } from '../supabase';
import { writeInsights, InsightInsert, DetectorResult } from './util';

type QWow = {
  query: string;
  recent_impr: number | string; prior_impr: number | string;
  recent_clicks: number | string; prior_clicks: number | string;
  recent_position: number | string | null; prior_position: number | string | null;
};

export async function detectQueryPositionDecline(opts: {
  workspaceId: string; windowDays?: number; minImpressions?: number; minDrop?: number;
}): Promise<DetectorResult> {
  const supabase = getSupabaseAdmin();
  const windowDays = opts.windowDays ?? 28;
  const minImpr = opts.minImpressions ?? 50;
  const minDrop = opts.minDrop ?? 3;

  const { data, error } = await supabase.rpc('gsc_query_wow', { p_workspace: opts.workspaceId, p_window: windowDays });
  if (error) throw new Error(`gsc_query_wow RPC failed: ${error.message}`);

  const wow = (data ?? []) as QWow[];
  const rows: InsightInsert[] = [];
  for (const w of wow) {
    if (w.recent_position == null || w.prior_position == null) continue;
    const recentPos = Number(w.recent_position);
    const priorPos = Number(w.prior_position);
    const recentImpr = Number(w.recent_impr);
    const priorImpr = Number(w.prior_impr);
    if (recentImpr < minImpr || priorImpr < minImpr) continue;
    if (priorPos > 20) continue; // only previously well-ranked queries
    const drop = recentPos - priorPos; // positive = worse rank
    if (drop < minDrop) continue;
    const severity = recentImpr >= 500 && drop >= 5 ? 'high' : recentImpr >= 150 ? 'medium' : 'low';
    rows.push({
      workspace_id: opts.workspaceId,
      detector: 'query_position_decline',
      category: 'seo',
      severity,
      polarity: 'issue',
      title: `"${w.query}" dropped from position ${priorPos.toFixed(1)} to ${recentPos.toFixed(1)}`,
      evidence: {
        query: w.query, recent_position: recentPos, prior_position: priorPos, drop: Number(drop.toFixed(1)),
        recent_impressions: recentImpr, prior_impressions: priorImpr,
        recent_clicks: Number(w.recent_clicks), prior_clicks: Number(w.prior_clicks), window_days: windowDays,
      },
      sources: ['Search Console'],
      dedupe_key: `query_position_decline:${w.query}`,
    });
  }
  return writeInsights({ workspaceId: opts.workspaceId, detector: 'query_position_decline', rows });
}
__IDENTOMAT_EOF__
mkdir -p src/lib/detectors
cat > src/lib/detectors/queryReachedPage1.ts << '__IDENTOMAT_EOF__'
import { getSupabaseAdmin } from '../supabase';
import { writeInsights, InsightInsert, DetectorResult } from './util';

type QWow = {
  query: string;
  recent_impr: number | string; prior_impr: number | string;
  recent_clicks: number | string; prior_clicks: number | string;
  recent_position: number | string | null; prior_position: number | string | null;
};

export async function detectQueryReachedPage1(opts: {
  workspaceId: string; windowDays?: number; minImpressions?: number;
}): Promise<DetectorResult> {
  const supabase = getSupabaseAdmin();
  const windowDays = opts.windowDays ?? 28;
  const minImpr = opts.minImpressions ?? 50;

  const { data, error } = await supabase.rpc('gsc_query_wow', { p_workspace: opts.workspaceId, p_window: windowDays });
  if (error) throw new Error(`gsc_query_wow RPC failed: ${error.message}`);

  const wow = (data ?? []) as QWow[];
  const rows: InsightInsert[] = [];
  for (const w of wow) {
    if (w.recent_position == null || w.prior_position == null) continue;
    const recentPos = Number(w.recent_position);
    const priorPos = Number(w.prior_position);
    const recentImpr = Number(w.recent_impr);
    if (recentImpr < minImpr) continue;
    if (!(priorPos > 10 && recentPos <= 10)) continue; // crossed onto page 1
    const severity = recentImpr >= 500 ? 'high' : recentImpr >= 150 ? 'medium' : 'low';
    rows.push({
      workspace_id: opts.workspaceId,
      detector: 'query_reached_page_1',
      category: 'seo',
      severity,
      polarity: 'win',
      title: `"${w.query}" climbed to page 1 (now position ${recentPos.toFixed(1)})`,
      evidence: {
        query: w.query, recent_position: recentPos, prior_position: priorPos,
        recent_impressions: recentImpr, recent_clicks: Number(w.recent_clicks), prior_clicks: Number(w.prior_clicks),
        window_days: windowDays,
      },
      sources: ['Search Console'],
      dedupe_key: `query_reached_page_1:${w.query}`,
    });
  }
  return writeInsights({ workspaceId: opts.workspaceId, detector: 'query_reached_page_1', rows });
}
__IDENTOMAT_EOF__
mkdir -p src/lib/detectors
cat > src/lib/detectors/pageClicksLost.ts << '__IDENTOMAT_EOF__'
import { getSupabaseAdmin } from '../supabase';
import { writeInsights, InsightInsert, DetectorResult } from './util';

type PWow = {
  page_path: string;
  recent_clicks: number | string; prior_clicks: number | string;
  recent_impr: number | string; prior_impr: number | string;
  clicks_pct_change: number | string | null;
};

export async function detectPageClicksLost(opts: {
  workspaceId: string; windowDays?: number; minPriorClicks?: number; dropThreshold?: number;
}): Promise<DetectorResult> {
  const supabase = getSupabaseAdmin();
  const windowDays = opts.windowDays ?? 28;
  const minPrior = opts.minPriorClicks ?? 30;
  const dropThreshold = opts.dropThreshold ?? 0.3;

  const { data, error } = await supabase.rpc('gsc_page_wow', { p_workspace: opts.workspaceId, p_window: windowDays });
  if (error) throw new Error(`gsc_page_wow RPC failed: ${error.message}`);

  const wow = (data ?? []) as PWow[];
  const rows: InsightInsert[] = [];
  for (const w of wow) {
    if (w.clicks_pct_change == null) continue;
    const prior = Number(w.prior_clicks);
    const recent = Number(w.recent_clicks);
    const pct = Number(w.clicks_pct_change);
    if (prior < minPrior || pct > -dropThreshold) continue;
    const dropPct = Math.round(Math.abs(pct) * 100);
    const severity = prior >= 200 && dropPct >= 50 ? 'high' : prior >= 80 ? 'medium' : 'low';
    rows.push({
      workspace_id: opts.workspaceId,
      detector: 'page_clicks_lost',
      category: 'seo',
      severity,
      polarity: 'issue',
      title: `${w.page_path} lost ${dropPct}% of its search clicks`,
      evidence: {
        page_path: w.page_path, recent_clicks: recent, prior_clicks: prior, drop_pct: dropPct,
        recent_impressions: Number(w.recent_impr), prior_impressions: Number(w.prior_impr), window_days: windowDays,
      },
      sources: ['Search Console'],
      dedupe_key: `page_clicks_lost:${w.page_path}`,
    });
  }
  return writeInsights({ workspaceId: opts.workspaceId, detector: 'page_clicks_lost', rows });
}
__IDENTOMAT_EOF__
mkdir -p src/lib/detectors
cat > src/lib/detectors/pageClicksGained.ts << '__IDENTOMAT_EOF__'
import { getSupabaseAdmin } from '../supabase';
import { writeInsights, InsightInsert, DetectorResult } from './util';

type PWow = {
  page_path: string;
  recent_clicks: number | string; prior_clicks: number | string;
  recent_impr: number | string; prior_impr: number | string;
  clicks_pct_change: number | string | null;
};

function sev(recent: number): 'high' | 'medium' | 'low' {
  return recent >= 200 ? 'high' : recent >= 80 ? 'medium' : 'low';
}

export async function detectPageClicksGained(opts: {
  workspaceId: string; windowDays?: number; minRecentClicks?: number; gainThreshold?: number;
}): Promise<DetectorResult> {
  const supabase = getSupabaseAdmin();
  const windowDays = opts.windowDays ?? 28;
  const minRecent = opts.minRecentClicks ?? 30;
  const gainThreshold = opts.gainThreshold ?? 0.4;

  const { data, error } = await supabase.rpc('gsc_page_wow', { p_workspace: opts.workspaceId, p_window: windowDays });
  if (error) throw new Error(`gsc_page_wow RPC failed: ${error.message}`);

  const wow = (data ?? []) as PWow[];
  const rows: InsightInsert[] = [];
  for (const w of wow) {
    const recent = Number(w.recent_clicks);
    const prior = Number(w.prior_clicks);
    if (recent < minRecent) continue;

    if (w.clicks_pct_change == null && prior === 0) {
      rows.push({
        workspace_id: opts.workspaceId,
        detector: 'page_clicks_gained',
        category: 'seo',
        severity: sev(recent),
        polarity: 'win',
        title: `${w.page_path} is newly earning search clicks (${recent.toLocaleString()} in the last ${windowDays} days)`,
        evidence: { page_path: w.page_path, recent_clicks: recent, prior_clicks: prior, new_page: true, recent_impressions: Number(w.recent_impr), window_days: windowDays },
        sources: ['Search Console'],
        dedupe_key: `page_clicks_gained:${w.page_path}`,
      });
      continue;
    }
    if (w.clicks_pct_change == null) continue;
    const pct = Number(w.clicks_pct_change);
    if (pct < gainThreshold) continue;
    const risePct = Math.round(pct * 100);
    rows.push({
      workspace_id: opts.workspaceId,
      detector: 'page_clicks_gained',
      category: 'seo',
      severity: sev(recent),
      polarity: 'win',
      title: `${w.page_path} gained ${risePct}% more search clicks`,
      evidence: {
        page_path: w.page_path, recent_clicks: recent, prior_clicks: prior, rise_pct: risePct,
        recent_impressions: Number(w.recent_impr), prior_impressions: Number(w.prior_impr), window_days: windowDays,
      },
      sources: ['Search Console'],
      dedupe_key: `page_clicks_gained:${w.page_path}`,
    });
  }
  return writeInsights({ workspaceId: opts.workspaceId, detector: 'page_clicks_gained', rows });
}
__IDENTOMAT_EOF__
mkdir -p src/lib/detectors
cat > src/lib/detectors/index.ts << '__IDENTOMAT_EOF__'
import { DetectorResult } from './util';
import { detectQueryOnPage2 } from './queryOnPage2';
import { detectQueryHighImprNoClick } from './queryHighImprNoClick';
import { detectTrafficDropByPage } from './trafficDropByPage';
import { detectTrafficSpike } from './trafficSpike';
import { detectTrafficNoConversion } from './trafficNoConversion';
import { detectQueryPositionDecline } from './queryPositionDecline';
import { detectQueryReachedPage1 } from './queryReachedPage1';
import { detectPageClicksLost } from './pageClicksLost';
import { detectPageClicksGained } from './pageClicksGained';

export type Detector = {
  name: string;
  run: (opts: { workspaceId: string }) => Promise<DetectorResult>;
};

export const detectors: Detector[] = [
  { name: 'query_on_page_2', run: detectQueryOnPage2 },
  { name: 'query_high_impressions_no_click', run: detectQueryHighImprNoClick },
  { name: 'query_position_decline', run: detectQueryPositionDecline },
  { name: 'query_reached_page_1', run: detectQueryReachedPage1 },
  { name: 'page_clicks_lost', run: detectPageClicksLost },
  { name: 'page_clicks_gained', run: detectPageClicksGained },
  { name: 'traffic_drop_by_page', run: detectTrafficDropByPage },
  { name: 'traffic_spike', run: detectTrafficSpike },
  { name: 'traffic_no_conversion', run: detectTrafficNoConversion },
];
__IDENTOMAT_EOF__
mkdir -p src/lib
cat > src/lib/narrate.ts << '__IDENTOMAT_EOF__'
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

// Per-detector interpretation guidance fed to the model alongside the facts.
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

  for (const row of rows) {
    const facts = buildFacts(row);
    const hash = hashFacts(facts);
    if (row.narrated_hash && row.narrated_hash === hash) {
      skipped++;
      continue;
    }
    try {
      const narrative = await narrateOne(client, facts, GUIDANCE[row.detector]);
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
  return { checked: rows.length, narrated, skipped, failed };
}
__IDENTOMAT_EOF__
echo "Done. Wrote 6 files."

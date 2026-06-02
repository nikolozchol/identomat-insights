#!/usr/bin/env bash
set -e
echo "Writing detector batch (9 files)..."
mkdir -p src/lib/detectors
cat > src/lib/detectors/util.ts << '__IDENTOMAT_EOF__'
import { getSupabaseAdmin } from '../supabase';

export type InsightInsert = {
  workspace_id: string;
  detector: string;
  category: string;
  severity: string;
  polarity: string;
  title: string;
  evidence: Record<string, unknown>;
  sources: string[];
  dedupe_key: string;
};

export type DetectorResult = { found: number; written: number };

export async function upsertInsights(rows: InsightInsert[]): Promise<DetectorResult> {
  if (rows.length === 0) return { found: 0, written: 0 };
  const supabase = getSupabaseAdmin();
  const BATCH = 500;
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from('insights')
      .upsert(batch, { onConflict: 'workspace_id,dedupe_key' });
    if (error) throw new Error(`insights upsert failed: ${error.message}`);
    written += batch.length;
  }
  return { found: rows.length, written };
}
__IDENTOMAT_EOF__
mkdir -p src/lib/detectors
cat > src/lib/detectors/queryOnPage2.ts << '__IDENTOMAT_EOF__'
import { getSupabaseAdmin } from '../supabase';
import { upsertInsights, InsightInsert, DetectorResult } from './util';

type Candidate = {
  query: string; page_path: string;
  impressions: number | string; clicks: number | string;
  avg_position: number | string; ctr: number | string;
};

function severityFor(impr: number, pos: number): 'high' | 'medium' | 'low' {
  if (impr >= 1000 || (impr >= 400 && pos <= 13)) return 'high';
  if (impr >= 200) return 'medium';
  return 'low';
}

export async function detectQueryOnPage2(opts: {
  workspaceId: string; lookbackDays?: number; minImpressions?: number;
}): Promise<DetectorResult> {
  const supabase = getSupabaseAdmin();
  const lookback = opts.lookbackDays ?? 28;
  const minImpr = opts.minImpressions ?? 80;

  const { data, error } = await supabase.rpc('detect_query_on_page_2', {
    p_workspace: opts.workspaceId, p_lookback: lookback, p_min_impressions: minImpr,
  });
  if (error) throw new Error(`detect_query_on_page_2 RPC failed: ${error.message}`);

  const candidates = (data ?? []) as Candidate[];
  const rows: InsightInsert[] = candidates.map((c) => {
    const impressions = Number(c.impressions);
    const position = Number(c.avg_position);
    return {
      workspace_id: opts.workspaceId,
      detector: 'query_on_page_2',
      category: 'seo',
      severity: severityFor(impressions, position),
      polarity: 'opportunity',
      title: `"${c.query}" is ranking on page 2 (avg position ${position.toFixed(1)})`,
      evidence: {
        query: c.query, page_path: c.page_path, impressions,
        clicks: Number(c.clicks), ctr: Number(c.ctr), position, lookback_days: lookback,
      },
      sources: ['Search Console'],
      dedupe_key: `query_on_page_2:${c.query}`,
    };
  });
  return upsertInsights(rows);
}
__IDENTOMAT_EOF__
mkdir -p src/lib/detectors
cat > src/lib/detectors/queryHighImprNoClick.ts << '__IDENTOMAT_EOF__'
import { getSupabaseAdmin } from '../supabase';
import { upsertInsights, InsightInsert, DetectorResult } from './util';

type Candidate = {
  query: string; page_path: string;
  impressions: number | string; clicks: number | string;
  avg_position: number | string; ctr: number | string;
};

const EXPECTED_CTR: Record<number, number> = {
  1: 0.28, 2: 0.15, 3: 0.10, 4: 0.07, 5: 0.05, 6: 0.04, 7: 0.03, 8: 0.025, 9: 0.02, 10: 0.018,
};
function expectedCtr(pos: number): number {
  const p = Math.max(1, Math.min(10, Math.round(pos)));
  return EXPECTED_CTR[p] ?? 0.02;
}

const INFO = ['what is', 'what are', 'how to', 'how do', 'meaning', 'definition', 'requirements', 'example', 'guide', ' vs ', 'difference', 'why ', 'explained', 'types of', 'list of'];
const COMMERCIAL = ['best', 'top ', 'pricing', 'price', 'cost', 'software', 'tool', 'platform', 'provider', 'vendor', 'company', 'companies', 'solution', 'service', 'api', 'buy', 'compare', 'review', 'alternative', 'cheap'];
function classifyIntent(q: string): 'informational' | 'commercial' | 'mixed' {
  const s = ` ${q.toLowerCase()} `;
  if (COMMERCIAL.some((m) => s.includes(m))) return 'commercial';
  if (INFO.some((m) => s.includes(m))) return 'informational';
  return 'mixed';
}

function severityFor(impr: number): 'high' | 'medium' | 'low' {
  if (impr >= 1000) return 'high';
  if (impr >= 300) return 'medium';
  return 'low';
}

export async function detectQueryHighImprNoClick(opts: {
  workspaceId: string; lookbackDays?: number; minImpressions?: number;
}): Promise<DetectorResult> {
  const supabase = getSupabaseAdmin();
  const lookback = opts.lookbackDays ?? 28;
  const minImpr = opts.minImpressions ?? 80;

  const { data, error } = await supabase.rpc('detect_query_high_impr_no_click', {
    p_workspace: opts.workspaceId, p_lookback: lookback, p_min_impressions: minImpr,
  });
  if (error) throw new Error(`detect_query_high_impr_no_click RPC failed: ${error.message}`);

  const candidates = (data ?? []) as Candidate[];
  const rows: InsightInsert[] = [];
  for (const c of candidates) {
    const impressions = Number(c.impressions);
    const clicks = Number(c.clicks);
    const position = Number(c.avg_position);
    const ctr = Number(c.ctr);
    const exp = expectedCtr(position);
    if (ctr >= exp * 0.5) continue; // only genuine underperformers (CTR < half of expected)
    const intent = classifyIntent(c.query);
    const likelyZeroClick = intent === 'informational';
    rows.push({
      workspace_id: opts.workspaceId,
      detector: 'query_high_impressions_no_click',
      category: 'seo',
      severity: severityFor(impressions),
      polarity: likelyZeroClick ? 'opportunity' : 'issue',
      title: `"${c.query}" gets ${impressions.toLocaleString()} impressions but few clicks (position ${position.toFixed(1)})`,
      evidence: {
        query: c.query, page_path: c.page_path, impressions, clicks, ctr, position,
        expected_ctr: Number(exp.toFixed(4)), intent, likely_zero_click: likelyZeroClick,
        ctr_pct: `${(ctr * 100).toFixed(1)}%`, expected_ctr_pct: `${(exp * 100).toFixed(1)}%`,
        lookback_days: lookback,
      },
      sources: ['Search Console'],
      dedupe_key: `query_high_impressions_no_click:${c.query}`,
    });
  }
  return upsertInsights(rows);
}
__IDENTOMAT_EOF__
mkdir -p src/lib/detectors
cat > src/lib/detectors/trafficDropByPage.ts << '__IDENTOMAT_EOF__'
import { getSupabaseAdmin } from '../supabase';
import { upsertInsights, InsightInsert, DetectorResult } from './util';

type WowRow = {
  page_path: string;
  recent_sessions: number | string; prior_sessions: number | string;
  recent_conversions: number | string; prior_conversions: number | string;
  pct_change: number | string | null;
};

export async function detectTrafficDropByPage(opts: {
  workspaceId: string; windowDays?: number; minPriorSessions?: number; dropThreshold?: number;
}): Promise<DetectorResult> {
  const supabase = getSupabaseAdmin();
  const windowDays = opts.windowDays ?? 7;
  const minPrior = opts.minPriorSessions ?? 30;
  const dropThreshold = opts.dropThreshold ?? 0.3;

  const { data, error } = await supabase.rpc('detect_traffic_by_page_wow', {
    p_workspace: opts.workspaceId, p_window: windowDays,
  });
  if (error) throw new Error(`detect_traffic_by_page_wow RPC failed: ${error.message}`);

  const wow = (data ?? []) as WowRow[];
  const rows: InsightInsert[] = [];
  for (const w of wow) {
    if (w.page_path === '(site)' || w.pct_change === null) continue;
    const prior = Number(w.prior_sessions);
    const recent = Number(w.recent_sessions);
    const pct = Number(w.pct_change);
    if (prior < minPrior || pct > -dropThreshold) continue;
    const dropPct = Math.round(Math.abs(pct) * 100);
    const severity = prior >= 300 && dropPct >= 50 ? 'high' : prior >= 100 ? 'medium' : 'low';
    rows.push({
      workspace_id: opts.workspaceId,
      detector: 'traffic_drop_by_page',
      category: 'traffic',
      severity,
      polarity: 'issue',
      title: `Traffic to ${w.page_path} dropped ${dropPct}% week-over-week`,
      evidence: {
        page_path: w.page_path, recent_sessions: recent, prior_sessions: prior,
        pct_change: pct, drop_pct: dropPct, window_days: windowDays,
      },
      sources: ['GA4'],
      dedupe_key: `traffic_drop_by_page:${w.page_path}`,
    });
  }
  return upsertInsights(rows);
}
__IDENTOMAT_EOF__
mkdir -p src/lib/detectors
cat > src/lib/detectors/trafficSpike.ts << '__IDENTOMAT_EOF__'
import { getSupabaseAdmin } from '../supabase';
import { upsertInsights, InsightInsert, DetectorResult } from './util';

type WowRow = {
  page_path: string;
  recent_sessions: number | string; prior_sessions: number | string;
  recent_conversions: number | string; prior_conversions: number | string;
  pct_change: number | string | null;
};

export async function detectTrafficSpike(opts: {
  workspaceId: string; windowDays?: number; minRecentSessions?: number; spikeThreshold?: number;
}): Promise<DetectorResult> {
  const supabase = getSupabaseAdmin();
  const windowDays = opts.windowDays ?? 7;
  const minRecent = opts.minRecentSessions ?? 50;
  const spikeThreshold = opts.spikeThreshold ?? 0.5;

  const { data, error } = await supabase.rpc('detect_traffic_by_page_wow', {
    p_workspace: opts.workspaceId, p_window: windowDays,
  });
  if (error) throw new Error(`detect_traffic_by_page_wow RPC failed: ${error.message}`);

  const wow = (data ?? []) as WowRow[];
  const rows: InsightInsert[] = [];
  for (const w of wow) {
    if (w.page_path === '(site)') continue;
    const recent = Number(w.recent_sessions);
    const prior = Number(w.prior_sessions);
    if (recent < minRecent) continue;

    if (w.pct_change === null && prior === 0) {
      rows.push({
        workspace_id: opts.workspaceId,
        detector: 'traffic_spike',
        category: 'traffic',
        severity: 'low',
        polarity: 'win',
        title: `${w.page_path} is a new traffic source (${recent.toLocaleString()} sessions this week)`,
        evidence: { page_path: w.page_path, recent_sessions: recent, prior_sessions: prior, new_page: true, window_days: windowDays },
        sources: ['GA4'],
        dedupe_key: `traffic_spike:${w.page_path}`,
      });
      continue;
    }
    if (w.pct_change === null) continue;
    const pct = Number(w.pct_change);
    if (pct < spikeThreshold) continue;
    const risePct = Math.round(pct * 100);
    rows.push({
      workspace_id: opts.workspaceId,
      detector: 'traffic_spike',
      category: 'traffic',
      severity: 'low',
      polarity: 'win',
      title: `Traffic to ${w.page_path} jumped ${risePct}% week-over-week`,
      evidence: {
        page_path: w.page_path, recent_sessions: recent, prior_sessions: prior,
        pct_change: pct, rise_pct: risePct, window_days: windowDays,
      },
      sources: ['GA4'],
      dedupe_key: `traffic_spike:${w.page_path}`,
    });
  }
  return upsertInsights(rows);
}
__IDENTOMAT_EOF__
mkdir -p src/lib/detectors
cat > src/lib/detectors/trafficNoConversion.ts << '__IDENTOMAT_EOF__'
import { getSupabaseAdmin } from '../supabase';
import { upsertInsights, InsightInsert, DetectorResult } from './util';

type Row = { page_path: string; sessions: number | string; conversions: number | string };

export async function detectTrafficNoConversion(opts: {
  workspaceId: string; lookbackDays?: number; minSessions?: number;
}): Promise<DetectorResult> {
  const supabase = getSupabaseAdmin();
  const lookback = opts.lookbackDays ?? 28;
  const minSessions = opts.minSessions ?? 100;

  const { data, error } = await supabase.rpc('detect_traffic_no_conversion', {
    p_workspace: opts.workspaceId, p_lookback: lookback, p_min_sessions: minSessions,
  });
  if (error) throw new Error(`detect_traffic_no_conversion RPC failed: ${error.message}`);

  const cands = (data ?? []) as Row[];
  const rows: InsightInsert[] = [];
  for (const c of cands) {
    if (c.page_path === '(site)') continue;
    const sessions = Number(c.sessions);
    const severity = sessions >= 1000 ? 'high' : sessions >= 300 ? 'medium' : 'low';
    rows.push({
      workspace_id: opts.workspaceId,
      detector: 'traffic_no_conversion',
      category: 'conversion',
      severity,
      polarity: 'issue',
      title: `${c.page_path} has ${sessions.toLocaleString()} sessions but no conversions`,
      evidence: { page_path: c.page_path, sessions, conversions: 0, lookback_days: lookback },
      sources: ['GA4'],
      dedupe_key: `traffic_no_conversion:${c.page_path}`,
    });
  }
  return upsertInsights(rows);
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

export type Detector = {
  name: string;
  run: (opts: { workspaceId: string }) => Promise<DetectorResult>;
};

export const detectors: Detector[] = [
  { name: 'query_on_page_2', run: detectQueryOnPage2 },
  { name: 'query_high_impressions_no_click', run: detectQueryHighImprNoClick },
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
    'High impressions with low CTR at a strong position can mean: (a) AI Overviews or featured snippets are answering the query directly in the results page (zero-click, common for informational queries); (b) a weak title/description; or (c) strong competitors ranking above. Use the `intent` and `likely_zero_click` fields. If zero-click is likely, frame it as a visibility situation (the brand is still being seen) and suggest making the page the cited source for AI answers. Do NOT call it a title/metadata problem when zero-click is likely.',
  traffic_drop_by_page:
    'A drop can be seasonal, a ranking loss, or a tracking/tagging change. State the magnitude and suggest investigating the cause rather than asserting one.',
  traffic_spike:
    'This is positive news. Note what grew and suggest how to capitalize on it. Keep an encouraging, energizing tone.',
  traffic_no_conversion:
    'The page attracts visits but produces no demo requests. Note that GA4 "conversions" counts whichever key events are configured, which may include more than demo requests. Suggest checking whether the page has a clear, visible call to action and whether the traffic intent matches the page.',
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
mkdir -p scripts
cat > scripts/detect.ts << '__IDENTOMAT_EOF__'
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getSupabaseAdmin } from '../src/lib/supabase';
import { detectors } from '../src/lib/detectors';

async function main() {
  const supabase = getSupabaseAdmin();
  const { data: ws, error } = await supabase
    .from('workspaces').select('id, name').limit(1).single();
  if (error || !ws) throw new Error(`No workspace: ${error?.message ?? 'empty'}`);

  console.log(`Running ${detectors.length} detectors for "${ws.name}"...\n`);
  let total = 0;
  for (const d of detectors) {
    try {
      const r = await d.run({ workspaceId: ws.id });
      console.log(`  ${d.name.padEnd(34)} ${r.written} insights`);
      total += r.written;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ${d.name.padEnd(34)} ERROR: ${msg}`);
    }
  }
  console.log(`\nDone. ${total} insights across ${detectors.length} detectors.`);
}

main();
__IDENTOMAT_EOF__
echo "Done. Wrote 9 files."

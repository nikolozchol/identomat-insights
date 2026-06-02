#!/usr/bin/env bash
set -e
echo "Applying calibration + stale-resolution (8 files)..."
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

export type DetectorResult = { found: number; written: number; resolved: number; reactivated: number };

type ExistingRow = { id: string; dedupe_key: string; status: string };

// Writes a detector's current findings and manages the full insight lifecycle:
// - upserts current matches (status omitted, so manual dismiss/snooze is preserved)
// - reactivates an insight that was auto-resolved but now matches again
// - resolves insights that were active but are no longer detected (fixed / no longer qualifying)
export async function writeInsights(opts: {
  workspaceId: string;
  detector: string;
  rows: InsightInsert[];
}): Promise<DetectorResult> {
  const supabase = getSupabaseAdmin();
  const { workspaceId, detector, rows } = opts;
  const BATCH = 500;

  const { data: existingData, error: exErr } = await supabase
    .from('insights')
    .select('id, dedupe_key, status')
    .eq('workspace_id', workspaceId)
    .eq('detector', detector);
  if (exErr) throw new Error(`load existing failed: ${exErr.message}`);
  const existing = (existingData ?? []) as ExistingRow[];

  const currentKeys = new Set(rows.map((r) => r.dedupe_key));

  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from('insights')
      .upsert(batch, { onConflict: 'workspace_id,dedupe_key' });
    if (error) throw new Error(`insights upsert failed: ${error.message}`);
    written += batch.length;
  }

  const reactivateIds = existing
    .filter((e) => currentKeys.has(e.dedupe_key) && e.status === 'resolved')
    .map((e) => e.id);
  let reactivated = 0;
  for (let i = 0; i < reactivateIds.length; i += BATCH) {
    const chunk = reactivateIds.slice(i, i + BATCH);
    const { error } = await supabase.from('insights').update({ status: 'active' }).in('id', chunk);
    if (error) throw new Error(`reactivate failed: ${error.message}`);
    reactivated += chunk.length;
  }

  const staleIds = existing
    .filter((e) => !currentKeys.has(e.dedupe_key) && e.status === 'active')
    .map((e) => e.id);
  let resolved = 0;
  for (let i = 0; i < staleIds.length; i += BATCH) {
    const chunk = staleIds.slice(i, i + BATCH);
    const { error } = await supabase.from('insights').update({ status: 'resolved' }).in('id', chunk);
    if (error) throw new Error(`resolve stale failed: ${error.message}`);
    resolved += chunk.length;
  }

  return { found: rows.length, written, resolved, reactivated };
}
__IDENTOMAT_EOF__
mkdir -p src/lib/detectors
cat > src/lib/detectors/queryOnPage2.ts << '__IDENTOMAT_EOF__'
import { getSupabaseAdmin } from '../supabase';
import { writeInsights, InsightInsert, DetectorResult } from './util';

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
  return writeInsights({ workspaceId: opts.workspaceId, detector: 'query_on_page_2', rows });
}
__IDENTOMAT_EOF__
mkdir -p src/lib/detectors
cat > src/lib/detectors/queryHighImprNoClick.ts << '__IDENTOMAT_EOF__'
import { getSupabaseAdmin } from '../supabase';
import { writeInsights, InsightInsert, DetectorResult } from './util';

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
  if (impr >= 500) return 'medium';
  return 'low';
}

export async function detectQueryHighImprNoClick(opts: {
  workspaceId: string; lookbackDays?: number; minImpressions?: number; maxPosition?: number;
}): Promise<DetectorResult> {
  const supabase = getSupabaseAdmin();
  const lookback = opts.lookbackDays ?? 28;
  const minImpr = opts.minImpressions ?? 200; // tightened: was 80
  const maxPosition = opts.maxPosition ?? 5;   // tightened: only top-5 positions

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
    if (position > maxPosition) continue;        // only strongly-visible positions
    const exp = expectedCtr(position);
    if (ctr >= exp * 0.5) continue;              // only genuine underperformers
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
  return writeInsights({ workspaceId: opts.workspaceId, detector: 'query_high_impressions_no_click', rows });
}
__IDENTOMAT_EOF__
mkdir -p src/lib/detectors
cat > src/lib/detectors/trafficDropByPage.ts << '__IDENTOMAT_EOF__'
import { getSupabaseAdmin } from '../supabase';
import { writeInsights, InsightInsert, DetectorResult } from './util';

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
  return writeInsights({ workspaceId: opts.workspaceId, detector: 'traffic_drop_by_page', rows });
}
__IDENTOMAT_EOF__
mkdir -p src/lib/detectors
cat > src/lib/detectors/trafficSpike.ts << '__IDENTOMAT_EOF__'
import { getSupabaseAdmin } from '../supabase';
import { writeInsights, InsightInsert, DetectorResult } from './util';

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
  return writeInsights({ workspaceId: opts.workspaceId, detector: 'traffic_spike', rows });
}
__IDENTOMAT_EOF__
mkdir -p src/lib/detectors
cat > src/lib/detectors/trafficNoConversion.ts << '__IDENTOMAT_EOF__'
import { getSupabaseAdmin } from '../supabase';
import { writeInsights, InsightInsert, DetectorResult } from './util';

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
  return writeInsights({ workspaceId: opts.workspaceId, detector: 'traffic_no_conversion', rows });
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
  let active = 0;
  let resolvedTotal = 0;
  for (const d of detectors) {
    try {
      const r = await d.run({ workspaceId: ws.id });
      const extra = r.resolved || r.reactivated
        ? ` (${r.resolved} resolved, ${r.reactivated} reactivated)`
        : '';
      console.log(`  ${d.name.padEnd(34)} ${r.found} active${extra}`);
      active += r.found;
      resolvedTotal += r.resolved;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ${d.name.padEnd(34)} ERROR: ${msg}`);
    }
  }
  console.log(`\nDone. ${active} active insights across ${detectors.length} detectors; ${resolvedTotal} resolved this run.`);
}

main();
__IDENTOMAT_EOF__
echo "Done. Updated 8 files."

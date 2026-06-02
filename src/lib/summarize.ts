import { createHash } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { getSupabaseAdmin } from './supabase';

const MODEL = 'claude-haiku-4-5-20251001';

// Evidence keys that identify a real-world entity, in priority order.
// GA4 sentinels and "(not set)" are excluded so they never become a bogus shared entity.
const ENTITY_KEYS = ['query', 'channel', 'source', 'referrer', 'country', 'page_path'] as const;
const ENTITY_SENTINELS = new Set(['(all)', '(site)', '(not set)', '', 'all', 'site']);

const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const sevRank = (s: string): number => SEV_RANK[s] ?? 4;

type InsightRow = {
  id: string;
  detector: string;
  category: string;
  severity: string;
  polarity: string | null;
  title: string;
  narrative: string | null;
  evidence: Record<string, unknown> | null;
  page_id: string | null;
  detected_at: string;
};

type Member = {
  id: string;
  detector: string;
  category: string;
  severity: string;
  polarity: string;
  title: string;
  evidence: Record<string, unknown>;
  page_id: string | null;
};

type Story = {
  group_key: string;
  kind: 'page' | 'entity' | 'solo';
  label: string;
  insight_ids: string[];
  members: Member[];
  worst_severity: string;
  polarities: string[];
};

type Trajectory = {
  active_total: number;
  issues: number;
  opportunities: number;
  wins: number;
  by_severity: Record<string, number>;
  by_category: Record<string, number>;
  new_count: number;
  multi_insight_stories: number;
};

// ---------- helpers ----------

function pickString(ev: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = ev[k];
    if (typeof v === 'string' && v.trim() && !ENTITY_SENTINELS.has(v.trim().toLowerCase())) {
      return v.trim();
    }
  }
  return null;
}

function entityOf(ev: Record<string, unknown>): { key: string; value: string } | null {
  for (const k of ENTITY_KEYS) {
    const v = ev[k];
    if (typeof v === 'string' && v.trim() && !ENTITY_SENTINELS.has(v.trim().toLowerCase())) {
      return { key: k, value: v.trim() };
    }
  }
  return null;
}

function groupKeyFor(m: Member): { key: string; kind: Story['kind']; label: string } {
  if (m.page_id) {
    const path = pickString(m.evidence, ['page_path', 'page', 'url', 'path']);
    return { key: `page:${m.page_id}`, kind: 'page', label: path ? `page ${path}` : `page ${m.page_id.slice(0, 8)}` };
  }
  const ent = entityOf(m.evidence);
  if (ent) return { key: `entity:${ent.key}:${ent.value}`, kind: 'entity', label: `${ent.key} "${ent.value}"` };
  return { key: `solo:${m.id}`, kind: 'solo', label: m.title };
}

function buildStories(members: Member[]): Story[] {
  const map = new Map<string, Story>();
  for (const m of members) {
    const gk = groupKeyFor(m);
    let s = map.get(gk.key);
    if (!s) {
      s = { group_key: gk.key, kind: gk.kind, label: gk.label, insight_ids: [], members: [], worst_severity: m.severity, polarities: [] };
      map.set(gk.key, s);
    }
    s.insight_ids.push(m.id);
    s.members.push(m);
    if (sevRank(m.severity) < sevRank(s.worst_severity)) s.worst_severity = m.severity;
    if (!s.polarities.includes(m.polarity)) s.polarities.push(m.polarity);
  }
  return [...map.values()].sort((a, b) => {
    const am = a.members.length >= 2 ? 0 : 1;
    const bm = b.members.length >= 2 ? 0 : 1;
    if (am !== bm) return am - bm;
    return sevRank(a.worst_severity) - sevRank(b.worst_severity);
  });
}

function evLine(ev: Record<string, unknown>): string {
  const parts = Object.entries(ev)
    .slice(0, 6)
    .map(([k, v]) => {
      const val = typeof v === 'number' ? String(v) : typeof v === 'string' ? v : JSON.stringify(v);
      return `${k}=${val}`;
    });
  return parts.join(', ');
}

function bySeverity(members: Member[]): Member[] {
  return [...members].sort((a, b) => sevRank(a.severity) - sevRank(b.severity));
}

function bullet(m: Member): string {
  const ev = evLine(m.evidence);
  return `- ${m.title} [${m.severity}]${ev ? ` — ${ev}` : ''}`;
}

function computeTrajectory(members: Member[], stories: Story[], newCount: number): Trajectory {
  const t: Trajectory = {
    active_total: members.length,
    issues: 0,
    opportunities: 0,
    wins: 0,
    by_severity: {},
    by_category: {},
    new_count: newCount,
    multi_insight_stories: stories.filter((s) => s.members.length >= 2).length,
  };
  for (const m of members) {
    if (m.polarity === 'win') t.wins++;
    else if (m.polarity === 'opportunity') t.opportunities++;
    else t.issues++;
    t.by_severity[m.severity] = (t.by_severity[m.severity] ?? 0) + 1;
    t.by_category[m.category] = (t.by_category[m.category] ?? 0) + 1;
  }
  return t;
}

// ---------- prompt ----------

const SYSTEM = [
  'You are the lead marketing analyst for an internal dashboard used by a NON-TECHNICAL marketing team at Identomat, a global identity-verification company (KYC, AML, biometric verification). Their primary conversion is demo requests; their audience is compliance teams at financial institutions.',
  '',
  'You are given a set of VERIFIED findings already computed from real analytics data, plus trajectory counts. Write the big-picture summary a marketer reads FIRST, before the detailed feed.',
  '',
  'Output STRICT JSON only, no markdown and no code fences: {"headline": "...", "body": "..."}',
  '',
  'headline: ONE sentence, ~15-22 words. Lead with the single most important thing. If there is a strong win or clearly positive trajectory, lead with it; otherwise lead with the most severe issue. Plain, human, specific.',
  '',
  'body: 3-6 sentences of plain prose. NO lists, NO markdown, NO headers. Structure: (1) open with the overall trajectory and any WINS — what is going well; (2) then the 1-3 most important problems or opportunities; (3) end with the single clearest priority.',
  '',
  'CRITICAL RULES:',
  '- Use ONLY the numbers and facts provided. Never invent, estimate, re-round, or add figures.',
  '- Beyond the reconciliations described above, do not assert causes, mechanisms, or downstream effects that are not in the findings; mark any inference as a possibility ("may", "could", "might"), never as established fact.',
  '- Never claim one finding "caused" another (for example that errors are "breaking" the site or "preventing" conversions) unless a finding states it; the tracking-gap reconciliation above is the one allowed inference and must stay hedged as "likely / investigate".',
  '- Zero conversions on a page or channel does NOT mean it fails to convert: conversions are often recorded on a confirmation or thank-you page after a redirect. Do not describe an entry page as converting nobody or losing conversions based on a zero count.',
  '- High JavaScript-error or other Clarity behavior rates are common and frequently harmless; do not claim they break forms, block submissions, or hurt conversions.',
  '- RECONCILE related findings into ONE story. Each item under "RELATED-FINDING GROUPS" is already one story — never describe its members as separate problems. Beyond those, connect findings that share a likely root cause.',
  '- Most important reconciliation: if Direct/Unassigned traffic SURGED while conversions or demo requests FELL in the same window, treat them as ONE story — a likely UTM/tracking-tag gap (real campaign/email/referral traffic miscounted as Direct), NOT separate problems. Frame it as "investigate tracking," never "lean into Direct."',
  '- A decline in a channel that is also a top converter is more urgent than a decline in a low-converting one — say so when the facts support it.',
  '- Be encouraging but honest. Do not manufacture wins that are not in the data; do not bury real problems.',
  '- No preamble. JSON only.',
].join('\n');

function buildFacts(t: Trajectory, members: Member[], stories: Story[], periodDays: number): string {
  const wins = bySeverity(members.filter((m) => m.polarity === 'win')).slice(0, 6);
  const issues = bySeverity(members.filter((m) => m.polarity !== 'win' && m.polarity !== 'opportunity')).slice(0, 12);
  const opps = bySeverity(members.filter((m) => m.polarity === 'opportunity')).slice(0, 8);
  const groups = stories.filter((s) => s.members.length >= 2);

  const lines: string[] = [];
  lines.push(`TRAJECTORY (rolling ${periodDays} days):`);
  lines.push(`- Active findings: ${t.active_total} (issues ${t.issues}, opportunities ${t.opportunities}, wins ${t.wins})`);
  const sev = t.by_severity;
  lines.push(`- By severity: critical ${sev.critical ?? 0}, high ${sev.high ?? 0}, medium ${sev.medium ?? 0}, low ${sev.low ?? 0}`);
  lines.push(`- New since last summary: ${t.new_count}`);
  lines.push('');

  lines.push('WINS (lead with these if present):');
  lines.push(wins.length ? wins.map(bullet).join('\n') : '- (none)');
  lines.push('');

  lines.push('ISSUES (problems to address):');
  lines.push(issues.length ? issues.map(bullet).join('\n') : '- (none)');
  lines.push('');

  lines.push('OPPORTUNITIES:');
  lines.push(opps.length ? opps.map(bullet).join('\n') : '- (none)');
  lines.push('');

  lines.push('RELATED-FINDING GROUPS (already grouped by shared page or shared entity — describe each as ONE story):');
  if (!groups.length) {
    lines.push('- (no multi-finding groups; findings are independent — but still reconcile any that share a likely cause, e.g. the tracking-gap pattern above)');
  } else {
    groups.forEach((g, i) => {
      lines.push(`Group ${i + 1} — ${g.label} (${g.kind}, worst severity ${g.worst_severity}):`);
      for (const m of bySeverity(g.members)) lines.push(`  ${bullet(m)} (${m.polarity})`);
    });
  }
  return lines.join('\n');
}

function parseSummary(text: string): { headline: string; body: string } | null {
  try {
    let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start === -1 || end === -1 || end < start) return null;
    const obj = JSON.parse(t.slice(start, end + 1)) as { headline?: unknown; body?: unknown };
    const headline = typeof obj.headline === 'string' ? obj.headline.trim() : '';
    const body = typeof obj.body === 'string' ? obj.body.trim() : '';
    if (!headline || !body) return null;
    return { headline, body };
  } catch {
    return null;
  }
}

function fallbackSummary(t: Trajectory, stories: Story[]): { headline: string; body: string } {
  const topStories = stories.filter((s) => s.members.length >= 2).slice(0, 3).map((s) => s.label);
  const headline =
    t.wins > 0
      ? `${t.active_total} active findings: ${t.wins} win${t.wins === 1 ? '' : 's'}, ${t.issues} issue${t.issues === 1 ? '' : 's'}, ${t.opportunities} opportunit${t.opportunities === 1 ? 'y' : 'ies'}.`
      : `${t.active_total} active findings to review: ${t.issues} issue${t.issues === 1 ? '' : 's'} and ${t.opportunities} opportunit${t.opportunities === 1 ? 'y' : 'ies'}.`;
  const parts: string[] = [];
  parts.push(
    `This period there are ${t.active_total} active findings (${t.issues} issues, ${t.opportunities} opportunities, ${t.wins} wins), with ${t.new_count} new since the last summary.`,
  );
  if (topStories.length) {
    parts.push(
      `Related findings are grouped into ${t.multi_insight_stories} multi-signal stor${t.multi_insight_stories === 1 ? 'y' : 'ies'}: ${topStories.join('; ')}.`,
    );
  }
  parts.push('Open the feed for full detail on each.');
  return { headline, body: parts.join(' ') };
}

// ---------- main ----------

export type SummaryResult =
  | { status: 'created'; headline: string; storyCount: number; activeCount: number; model: string }
  | { status: 'skipped'; reason: string };

export async function generateSummary(opts: {
  workspaceId: string;
  periodDays?: number;
  force?: boolean;
  model?: string;
}): Promise<SummaryResult> {
  const supabase = getSupabaseAdmin();
  const periodDays = opts.periodDays ?? 28;
  const model = opts.model ?? MODEL;
  const nowIso = new Date().toISOString();

  const { data: insData, error: insErr } = await supabase
    .from('insights')
    .select('id, detector, category, severity, polarity, title, narrative, evidence, page_id, detected_at')
    .eq('workspace_id', opts.workspaceId)
    .eq('status', 'active')
    .is('dismissed_at', null)
    .or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`)
    .order('detected_at', { ascending: false });
  if (insErr) throw new Error(`load insights failed: ${insErr.message}`);
  const rows = (insData ?? []) as InsightRow[];

  // previous summary: used for both "new since" and hash-gating
  const { data: prevData, error: prevErr } = await supabase
    .from('summaries')
    .select('generated_at, input_hash')
    .eq('workspace_id', opts.workspaceId)
    .order('generated_at', { ascending: false })
    .limit(1);
  if (prevErr) throw new Error(`load previous summary failed: ${prevErr.message}`);
  const prev = (prevData ?? [])[0] as { generated_at: string; input_hash: string | null } | undefined;

  const sinceISO = prev?.generated_at ?? new Date(Date.now() - 7 * 864e5).toISOString();
  const newCount = rows.filter((r) => r.detected_at > sinceISO).length;

  const members: Member[] = rows.map((r) => ({
    id: r.id,
    detector: r.detector,
    category: r.category,
    severity: r.severity,
    polarity: r.polarity ?? 'issue',
    title: r.title,
    evidence: r.evidence ?? {},
    page_id: r.page_id,
  }));

  const stories = buildStories(members);
  const trajectory = computeTrajectory(members, stories, newCount);

  // All-clear path: no active findings -> deterministic, no API spend.
  const facts = rows.length === 0 ? 'ALL CLEAR: no active findings this period.' : buildFacts(trajectory, members, stories, periodDays);
  const inputHash = createHash('sha256').update(facts).digest('hex');

  if (!opts.force && prev?.input_hash && prev.input_hash === inputHash) {
    return { status: 'skipped', reason: 'inputs unchanged since last summary' };
  }

  let headline = '';
  let body = '';
  let usedModel = model;

  if (rows.length === 0) {
    headline = 'All clear — no active findings this period.';
    body = 'No issues, opportunities, or notable changes are currently active. The feed is empty, which means nothing crossed a detection threshold in the latest data. Keep shipping; new findings will surface here as they appear.';
    usedModel = 'all-clear';
  } else {
    try {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY');
      const client = new Anthropic({ apiKey });
      const msg = await client.messages.create({
        model,
        max_tokens: 700,
        system: SYSTEM,
        messages: [{ role: 'user', content: facts }],
      });
      const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
      const parsed = parseSummary(text);
      if (!parsed) throw new Error('could not parse summary JSON');
      headline = parsed.headline;
      body = parsed.body;
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      console.warn(`  summary narration failed: ${m} — using deterministic fallback.`);
      const fb = fallbackSummary(trajectory, stories);
      headline = fb.headline;
      body = fb.body;
      usedModel = 'fallback';
    }
  }

  const storiesJson = stories.map((s) => ({
    group_key: s.group_key,
    kind: s.kind,
    label: s.label,
    worst_severity: s.worst_severity,
    polarities: s.polarities,
    insight_ids: s.insight_ids,
    member_titles: s.members.map((m) => m.title),
  }));

  const { error: writeErr } = await supabase.from('summaries').insert({
    workspace_id: opts.workspaceId,
    period_days: periodDays,
    headline,
    body,
    trajectory,
    stories: storiesJson,
    active_insight_count: rows.length,
    input_hash: inputHash,
    model: usedModel,
  });
  if (writeErr) throw new Error(`insert summary failed: ${writeErr.message}`);

  return { status: 'created', headline, storyCount: stories.length, activeCount: rows.length, model: usedModel };
}

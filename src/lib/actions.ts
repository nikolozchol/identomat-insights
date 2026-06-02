import Anthropic from '@anthropic-ai/sdk';
import { getSupabaseAdmin } from './supabase';

const MODEL = 'claude-haiku-4-5-20251001';

type InsightRow = {
  id: string; page_id: string | null; detector: string; category: string;
  severity: string; polarity: string; title: string; narrative: string | null;
  evidence: Record<string, unknown> | null;
};

const CATEGORY_PLAYBOOK: Record<string, string> = {
  seo: 'Typical SEO actions: strengthen on-page content for a target query, add internal links, build a dedicated page, or structure content to be cited by AI Overviews. Only recommend rewriting title/meta when the finding points to a metadata problem - NOT when it indicates a zero-click / AI-Overview situation.',
  traffic: 'Typical actions: investigate the cause of a traffic change (ranking shift, seasonality, or tracking/tagging), or capitalize on growth.',
  conversion: 'Typical actions: clarify or reposition the call-to-action, reduce form friction, check intent-to-page match, or verify conversion tracking. Note GA4 "conversions" may count more than demo requests.',
  channels: 'Typical actions: invest more in an efficient or underused channel, fix UTM tagging for misattributed (Direct/Unassigned) traffic, or scale a channel that is growing.',
  ux: 'Typical actions: fix a broken or unresponsive element, stop non-interactive elements from looking clickable, fix JavaScript errors (a developer task), or move key content and CTAs higher on the page.',
  content: 'Typical actions: refresh stale content, expand thin content, or improve internal linking.',
};

const SYSTEM = [
  'You are a marketing operations assistant. You convert a single verified website finding into ONE concrete, actionable task brief for a non-technical marketing team.',
  "You receive the finding's verified facts and a plain-language explanation. Base the task strictly on these facts; never invent metrics.",
  'Respond with ONLY a JSON object (no preamble, no markdown fences, no text outside it) with exactly these keys:',
  '  "title": a short imperative task title (max ~10 words)',
  '  "brief": 2-4 sentences - what to do and why, referencing the actual numbers',
  '  "effort": one of "S", "M", "L" (rough implementation effort)',
  '  "expected_impact": one concise line on the likely benefit',
  '  "success_metric": how to tell it worked - a concrete, measurable signal',
  '  "owner_role": suggested team/role, e.g. "SEO", "Content", "Web/Dev", "Marketing Ops"',
  'Keep it practical and specific to this finding.',
].join('\n');

type Brief = {
  title: string; brief: string; effort: string;
  expected_impact: string; success_metric: string; owner_role: string;
};

function parseBrief(text: string): Brief | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const o = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    if (typeof o.title !== 'string' || typeof o.brief !== 'string') return null;
    const effort = typeof o.effort === 'string' && ['S', 'M', 'L'].includes(o.effort) ? o.effort : 'M';
    return {
      title: String(o.title).trim(),
      brief: String(o.brief).trim(),
      effort,
      expected_impact: String(o.expected_impact ?? '').trim(),
      success_metric: String(o.success_metric ?? '').trim(),
      owner_role: String(o.owner_role ?? '').trim(),
    };
  } catch {
    return null;
  }
}

function buildFacts(i: InsightRow): string {
  const lines: string[] = [
    `Finding type: ${i.detector}`,
    `Category: ${i.category}`,
    `Severity: ${i.severity}`,
    `Polarity: ${i.polarity}`,
    `Headline: ${i.title}`,
  ];
  if (i.narrative) lines.push(`Explanation: ${i.narrative}`);
  lines.push('Verified data:');
  for (const [k, v] of Object.entries(i.evidence ?? {})) {
    lines.push(`- ${k}: ${typeof v === 'number' ? v : JSON.stringify(v)}`);
  }
  const pb = CATEGORY_PLAYBOOK[i.category];
  if (pb) lines.push(`\nGuidance for this category: ${pb}`);
  return lines.join('\n');
}

export async function generateActions(opts: {
  workspaceId: string; limit?: number; insightId?: string;
}): Promise<{ candidates: number; created: number; failed: number }> {
  const supabase = getSupabaseAdmin();
  const limit = opts.limit ?? 50;

  const { data: insData, error: insErr } = await supabase
    .from('insights')
    .select('id, page_id, detector, category, severity, polarity, title, narrative, evidence')
    .eq('workspace_id', opts.workspaceId)
    .eq('status', 'active')
    .in('severity', ['high', 'medium'])
    .in('polarity', ['issue', 'opportunity'])
    .order('detected_at', { ascending: false })
    .limit(limit);
  if (insErr) throw new Error(`load insights failed: ${insErr.message}`);
  const insights = (insData ?? []) as InsightRow[];

  const { data: actData, error: actErr } = await supabase
    .from('actions').select('insight_id').eq('workspace_id', opts.workspaceId);
  if (actErr) throw new Error(`load actions failed: ${actErr.message}`);
  const haveAction = new Set(
    (actData ?? []).map((a: { insight_id: string | null }) => a.insight_id).filter(Boolean)
  );

  const todo = insights.filter((i) => !haveAction.has(i.id) && (!opts.insightId || i.id === opts.insightId));
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY');
  const client = new Anthropic({ apiKey });

  let created = 0;
  let failed = 0;
  for (const ins of todo) {
    try {
      const msg = await client.messages.create({
        model: MODEL, max_tokens: 400, system: SYSTEM,
        messages: [{ role: 'user', content: buildFacts(ins) }],
      });
      const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
      const brief = parseBrief(text);
      if (!brief) throw new Error('could not parse brief JSON');
      const title = (brief.title || ins.title).slice(0, 200);
      const { error: e } = await supabase.from('actions').insert({
        workspace_id: opts.workspaceId,
        insight_id: ins.id,
        page_id: ins.page_id,
        title,
        brief: brief.brief,
        category: ins.category,
        owner: brief.owner_role || null,
        effort: brief.effort,
        expected_impact: brief.expected_impact || null,
        success_metric: brief.success_metric || null,
        status: 'new',
      });
      if (e) throw new Error(e.message);
      created++;
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      console.warn(`  action gen failed for "${ins.title}": ${m}`);
      failed++;
    }
  }
  return { candidates: todo.length, created, failed };
}

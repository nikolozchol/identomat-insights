import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MODEL = 'claude-haiku-4-5-20251001';
const ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
type Media = (typeof ALLOWED)[number];

const SYSTEM = [
  'You are a web-analytics assistant interpreting a screenshot of a Microsoft Clarity heatmap (a click, scroll, or area map) for a website.',
  'Describe ONLY what is visible in the image: where clicks/attention concentrate (hot zones), notable cold or ignored areas, and how far down the page engagement appears to reach.',
  'Do not invent metrics or numbers that are not shown. If the image is unclear or is not a heatmap, say so in the summary and return no observations.',
  'Each observation should be specific and, where possible, actionable. The "suggestion" is a concrete fix the team could turn into a task.',
  'Respond with ONLY a JSON object — no prose, no markdown fences — shaped exactly as:',
  '{"summary": string, "observations": [{"area": string, "finding": string, "severity": "high"|"medium"|"low", "suggestion": string}]}',
  'Provide between 0 and 6 observations, most important first.',
].join('\n');

type Obs = { area: string; finding: string; severity: string; suggestion: string };
type Analysis = { summary: string; observations: Obs[] };

function parseAnalysis(text: string): Analysis | null {
  try {
    const t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start < 0 || end < 0) return null;
    const obj = JSON.parse(t.slice(start, end + 1)) as { summary?: unknown; observations?: unknown };
    if (typeof obj.summary !== 'string') return null;
    const arr = Array.isArray(obj.observations) ? obj.observations : [];
    const observations: Obs[] = arr
      .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
      .map((o) => {
        const sev = String(o.severity ?? 'low');
        return {
          area: String(o.area ?? ''),
          finding: String(o.finding ?? ''),
          severity: sev === 'high' || sev === 'medium' || sev === 'low' ? sev : 'low',
          suggestion: String(o.suggestion ?? ''),
        };
      })
      .slice(0, 6);
    return { summary: obj.summary, observations };
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  let body: { imageBase64?: unknown; mediaType?: unknown; pagePath?: unknown; mapType?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : '';
  const mediaType = typeof body.mediaType === 'string' ? body.mediaType : '';
  const pagePath = typeof body.pagePath === 'string' && body.pagePath.trim() ? body.pagePath.trim() : null;
  const mapType = typeof body.mapType === 'string' && body.mapType.trim() ? body.mapType.trim() : null;

  if (!imageBase64) return NextResponse.json({ error: 'image is required' }, { status: 400 });
  if (!ALLOWED.includes(mediaType as Media)) return NextResponse.json({ error: 'unsupported image type' }, { status: 400 });
  const approxBytes = Math.floor((imageBase64.length * 3) / 4);
  if (approxBytes > 6 * 1024 * 1024) return NextResponse.json({ error: 'image too large (max ~6MB)' }, { status: 413 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'missing ANTHROPIC_API_KEY' }, { status: 500 });

  try {
    const client = new Anthropic({ apiKey });
    const ctx = [pagePath ? `Page: ${pagePath}` : '', mapType ? `Map type: ${mapType}` : ''].filter(Boolean).join('. ');
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 900,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType as Media, data: imageBase64 } },
            { type: 'text', text: ctx ? `Context — ${ctx}. Analyze this heatmap.` : 'Analyze this heatmap.' },
          ],
        },
      ],
    });
    const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
    const analysis = parseAnalysis(text);
    if (!analysis) return NextResponse.json({ error: 'could not parse analysis', raw: text.slice(0, 400) }, { status: 502 });
    return NextResponse.json({ ok: true, summary: analysis.summary, findings: analysis.observations });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}

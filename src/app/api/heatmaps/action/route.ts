import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const IMPACT: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' };

export async function POST(req: Request) {
  let body: {
    finding?: { area?: unknown; finding?: unknown; severity?: unknown; suggestion?: unknown };
    pagePath?: unknown;
    mapType?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const f = body.finding ?? {};
  const area = typeof f.area === 'string' ? f.area.trim() : '';
  const finding = typeof f.finding === 'string' ? f.finding.trim() : '';
  const suggestion = typeof f.suggestion === 'string' ? f.suggestion.trim() : '';
  const sev = String(f.severity ?? 'low');
  const severity = sev === 'high' || sev === 'medium' || sev === 'low' ? sev : 'low';
  const pagePath = typeof body.pagePath === 'string' && body.pagePath.trim() ? body.pagePath.trim() : null;
  const mapType = typeof body.mapType === 'string' && body.mapType.trim() ? body.mapType.trim() : null;

  if (!area && !finding && !suggestion) return NextResponse.json({ error: 'empty finding' }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: wsData } = await supabase.from('workspaces').select('id').limit(1);
  const workspaceId = (wsData ?? [])[0]?.id as string | undefined;
  if (!workspaceId) return NextResponse.json({ error: 'no workspace' }, { status: 500 });

  const title = (suggestion || finding || area).slice(0, 120);
  const ctx = `Observed on the ${mapType || 'heatmap'}${pagePath ? ` for ${pagePath}` : ''}`;
  const parts = [`${ctx}: ${finding || area}.`];
  if (suggestion && suggestion !== title) parts.push(`Suggested fix: ${suggestion}`);
  const brief = parts.join(' ');

  const ins = await supabase
    .from('actions')
    .insert({
      workspace_id: workspaceId,
      insight_id: null,
      page_id: null,
      title,
      brief,
      category: 'ux',
      effort: 'M',
      expected_impact: IMPACT[severity],
      status: 'new',
    })
    .select('id')
    .limit(1);
  if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });

  revalidatePath('/actions');
  revalidatePath('/');
  const id = ((ins.data ?? []) as Array<{ id: string }>)[0]?.id ?? null;
  return NextResponse.json({ ok: true, id });
}

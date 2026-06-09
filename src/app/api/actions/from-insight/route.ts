import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getSupabaseAdmin } from '../../../../lib/supabase';
import { createSupabaseServer } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const IMPACT: Record<string, string> = { critical: 'High', high: 'High', medium: 'Medium', low: 'Low' };

type Ins = { id: string; title: string; narrative: string | null; category: string | null; polarity: string | null; severity: string; page_id: string | null };

export async function POST(req: Request) {
  let insightId: string | undefined;
  try {
    const b = (await req.json()) as { insightId?: unknown };
    if (typeof b.insightId === 'string') insightId = b.insightId;
  } catch {
    /* invalid body */
  }
  if (!insightId) return NextResponse.json({ error: 'insightId is required' }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: wsData } = await supabase.from('workspaces').select('id').limit(1);
  const workspaceId = (wsData ?? [])[0]?.id as string | undefined;
  if (!workspaceId) return NextResponse.json({ error: 'no workspace' }, { status: 500 });

  const { data: insRows } = await supabase
    .from('insights')
    .select('id, title, narrative, category, polarity, severity, page_id')
    .eq('workspace_id', workspaceId)
    .eq('id', insightId)
    .limit(1);
  const ins = ((insRows ?? []) as Ins[])[0];
  if (!ins) return NextResponse.json({ error: 'insight not found' }, { status: 404 });
  if (ins.polarity === 'win') return NextResponse.json({ error: 'wins are not actionable' }, { status: 400 });

  const { data: existing } = await supabase
    .from('actions')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('insight_id', insightId)
    .limit(1);
  if (((existing ?? []) as unknown[]).length > 0) return NextResponse.json({ ok: true, already: true });

  let owner: string | null = null;
  try {
    const auth = await createSupabaseServer();
    const {
      data: { user },
    } = await auth.auth.getUser();
    owner = user?.email ?? null;
  } catch {
    /* owner is best-effort */
  }

  const { data: insData, error } = await supabase
    .from('actions')
    .insert({
      workspace_id: workspaceId,
      insight_id: ins.id,
      page_id: ins.page_id,
      title: (ins.title ?? 'Action').slice(0, 200),
      brief: ins.narrative,
      category: ins.category,
      owner,
      effort: 'M',
      expected_impact: IMPACT[ins.severity] ?? 'Medium',
      status: 'new',
    })
    .select('id')
    .limit(1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  revalidatePath('/actions');
  revalidatePath('/');
  const id = ((insData ?? []) as Array<{ id: string }>)[0]?.id ?? null;
  return NextResponse.json({ ok: true, id });
}

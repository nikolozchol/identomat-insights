import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TYPES = ['contains', 'prefix', 'exact', 'glob'];

export async function POST(req: Request) {
  let pattern = '', matchType = 'contains';
  try {
    const b = (await req.json()) as { pattern?: unknown; matchType?: unknown };
    if (typeof b.pattern === 'string') pattern = b.pattern.trim();
    if (typeof b.matchType === 'string' && TYPES.includes(b.matchType)) matchType = b.matchType;
  } catch {
    /* invalid body */
  }
  if (!pattern) return NextResponse.json({ error: 'pattern is required' }, { status: 400 });
  if (pattern.length > 200) return NextResponse.json({ error: 'pattern too long' }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: wsData } = await supabase.from('workspaces').select('id').limit(1);
  const workspaceId = (wsData ?? [])[0]?.id as string | undefined;
  if (!workspaceId) return NextResponse.json({ error: 'no workspace' }, { status: 500 });

  const { data: dupe } = await supabase
    .from('page_exclusions')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('pattern', pattern)
    .eq('match_type', matchType)
    .limit(1);
  if (((dupe ?? []) as unknown[]).length > 0) return NextResponse.json({ ok: true, already: true });

  const { error } = await supabase
    .from('page_exclusions')
    .insert({ workspace_id: workspaceId, pattern, match_type: matchType });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  revalidatePath('/settings');
  revalidatePath('/pages');
  revalidatePath('/');
  return NextResponse.json({ ok: true });
}

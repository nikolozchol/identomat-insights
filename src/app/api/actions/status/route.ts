import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = new Set(['new', 'in_progress', 'done']);

export async function POST(req: Request) {
  let id: string | undefined;
  let status: string | undefined;
  try {
    const body = (await req.json()) as { id?: unknown; status?: unknown };
    if (body && typeof body.id === 'string') id = body.id;
    if (body && typeof body.status === 'string') status = body.status;
  } catch {
    /* invalid body */
  }
  if (!id || !status || !ALLOWED.has(status)) {
    return NextResponse.json({ error: 'id and a valid status are required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: wsData } = await supabase.from('workspaces').select('id').limit(1);
  const workspaceId = (wsData ?? [])[0]?.id as string | undefined;
  if (!workspaceId) {
    return NextResponse.json({ error: 'no workspace' }, { status: 500 });
  }

  const { error } = await supabase
    .from('actions')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('id', id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  revalidatePath('/actions');
  return NextResponse.json({ ok: true, status });
}

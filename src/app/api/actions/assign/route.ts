import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_DOMAIN = 'identomat.com';

export async function POST(req: Request) {
  let id: string | undefined;
  let owner: string | null = null;
  try {
    const body = (await req.json()) as { id?: unknown; owner?: unknown };
    if (body && typeof body.id === 'string') id = body.id;
    if (body && typeof body.owner === 'string' && body.owner.trim()) owner = body.owner.trim();
    // owner null/empty => unassign
  } catch {
    /* invalid body */
  }
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  if (owner && !owner.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`)) {
    return NextResponse.json({ error: `owner must be an @${ALLOWED_DOMAIN} address` }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: wsData } = await supabase.from('workspaces').select('id').limit(1);
  const workspaceId = (wsData ?? [])[0]?.id as string | undefined;
  if (!workspaceId) return NextResponse.json({ error: 'no workspace' }, { status: 500 });

  const { error } = await supabase
    .from('actions')
    .update({ owner, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  revalidatePath('/actions');
  revalidatePath('/');
  return NextResponse.json({ ok: true, owner });
}

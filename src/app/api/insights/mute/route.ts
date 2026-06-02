import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SNOOZE_DAYS = 7;

export async function POST(req: Request) {
  let id: string | undefined;
  let action: string | undefined;
  try {
    const body = (await req.json()) as { id?: unknown; action?: unknown };
    if (body && typeof body.id === 'string') id = body.id;
    if (body && typeof body.action === 'string') action = body.action;
  } catch {
    /* invalid body */
  }
  if (!id || (action !== 'snooze' && action !== 'dismiss')) {
    return NextResponse.json({ error: 'id and a valid action (snooze|dismiss) are required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: wsData } = await supabase.from('workspaces').select('id').limit(1);
  const workspaceId = (wsData ?? [])[0]?.id as string | undefined;
  if (!workspaceId) {
    return NextResponse.json({ error: 'no workspace' }, { status: 500 });
  }

  const patch =
    action === 'snooze'
      ? { snoozed_until: new Date(Date.now() + SNOOZE_DAYS * 864e5).toISOString() }
      : { dismissed_at: new Date().toISOString() };

  const { error } = await supabase.from('insights').update(patch).eq('workspace_id', workspaceId).eq('id', id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  revalidatePath('/');
  return NextResponse.json({ ok: true });
}

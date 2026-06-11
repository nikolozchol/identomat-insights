import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getSupabaseAdmin } from '../../../../lib/supabase';
import { createSupabaseServer } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let id: string | undefined;
  try {
    const b = (await req.json()) as { id?: unknown };
    if (typeof b.id === 'string') id = b.id;
  } catch {
    /* invalid body */
  }
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  let email: string | null = null;
  try {
    const auth = await createSupabaseServer();
    const { data: { user } } = await auth.auth.getUser();
    email = user?.email ?? null;
  } catch {
    /* no session */
  }
  if (!email) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const supabase = getSupabaseAdmin();
  const { data } = await supabase.from('chats').select('id, user_email').eq('id', id).limit(1);
  const chat = ((data ?? []) as Array<{ id: string; user_email: string }>)[0];
  if (!chat) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (chat.user_email !== email) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { error } = await supabase.from('chats').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  revalidatePath('/ask');
  return NextResponse.json({ ok: true });
}

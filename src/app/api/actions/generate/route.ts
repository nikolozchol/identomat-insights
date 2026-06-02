import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getSupabaseAdmin } from '../../../../lib/supabase';
import { generateActions } from '../../../../lib/actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let insightId: string | undefined;
  try {
    const body = (await req.json()) as { insightId?: unknown };
    if (body && typeof body.insightId === 'string') insightId = body.insightId;
  } catch {
    /* no / invalid body */
  }
  if (!insightId) {
    return NextResponse.json({ error: 'insightId is required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: wsData } = await supabase.from('workspaces').select('id').limit(1);
  const workspaceId = (wsData ?? [])[0]?.id as string | undefined;
  if (!workspaceId) {
    return NextResponse.json({ error: 'no workspace' }, { status: 500 });
  }

  try {
    const r = await generateActions({ workspaceId, insightId });
    if (r.created > 0) {
      revalidatePath('/');
      revalidatePath('/actions');
      return NextResponse.json({ ok: true, created: r.created });
    }
    // candidates === 0 -> already has an action (or not eligible); treat as a no-op success
    return NextResponse.json({ ok: false, created: 0, noop: r.candidates === 0 });
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: m }, { status: 500 });
  }
}

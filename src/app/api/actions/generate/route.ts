import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabase';
import { createSupabaseServer } from '../../../../lib/supabase/server';
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

    // Best-effort: attribute the action(s) just created for this insight to the signed-in user.
    try {
      const auth = await createSupabaseServer();
      const {
        data: { user },
      } = await auth.auth.getUser();
      if (user?.email) {
        await supabase
          .from('actions')
          .update({ owner: user.email })
          .eq('workspace_id', workspaceId)
          .eq('insight_id', insightId)
          .is('owner', null);
      }
    } catch {
      /* owner stamping is best-effort; never block the conversion */
    }

    if (r.created > 0) return NextResponse.json({ ok: true, created: r.created });
    return NextResponse.json({ ok: false, created: 0, noop: r.candidates === 0 });
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: m }, { status: 500 });
  }
}

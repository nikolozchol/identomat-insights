import { NextResponse } from 'next/server';
import { createSupabaseServer } from '../../../lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const supabase = await createSupabaseServer();
  await supabase.auth.signOut();
  return NextResponse.redirect(`${new URL(request.url).origin}/login`, { status: 303 });
}

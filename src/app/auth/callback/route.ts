import { NextResponse } from 'next/server';
import { createSupabaseServer } from '../../../lib/supabase/server';

export const dynamic = 'force-dynamic';

const ALLOWED_DOMAIN = 'identomat.com';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const origin = url.origin;

  if (!code) return NextResponse.redirect(`${origin}/login?error=missing_code`);

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/login?error=auth`);

  const { data: { user } } = await supabase.auth.getUser();
  const email = user?.email?.toLowerCase() ?? '';
  if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=domain`);
  }

  return NextResponse.redirect(`${origin}/`);
}

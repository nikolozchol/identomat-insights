import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Sidebar } from '../components/shell/Sidebar';
import { TopBar } from '../components/shell/TopBar';
import { Onboarding } from '../components/onboarding/Onboarding';
import { getSupabaseAdmin } from '../lib/supabase';
import { createSupabaseServer } from '../lib/supabase/server';

const geistSans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

const ALLOWED_DOMAIN = 'identomat.com';

export const metadata: Metadata = {
  title: 'Identomat Insights',
  description: 'AI-written marketing analytics for Identomat',
};

async function getActionCount(): Promise<number> {
  try {
    const supabase = getSupabaseAdmin();
    const { data: wsData } = await supabase.from('workspaces').select('id').limit(1);
    const workspaceId = (wsData ?? [])[0]?.id as string | undefined;
    if (!workspaceId) return 0;
    const { data } = await supabase.from('actions').select('id').eq('workspace_id', workspaceId);
    return (data ?? []).length;
  } catch {
    return 0;
  }
}

async function AppShell({ children, userEmail }: { children: ReactNode; userEmail: string }) {
  const actionCount = await getActionCount();
  return (
    <>
      <div className="grid h-screen grid-cols-[236px_1fr] overflow-hidden">
        <Sidebar actionCount={actionCount} userEmail={userEmail} />
        <div className="flex min-w-0 flex-col overflow-hidden">
          <TopBar />
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
      <Onboarding />
    </>
  );
}

function NotAuthorized({ email }: { email: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <div className="w-full max-w-[380px] text-center">
        <h1 className="text-[18px] font-semibold tracking-[-0.01em] text-fg">Account not authorized</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-fg-2">
          {email || 'This account'} is not an @{ALLOWED_DOMAIN} address, so it can&apos;t access Identomat Insights.
        </p>
        <form action="/auth/signout" method="post" className="mt-5">
          <button
            type="submit"
            className="rounded-[var(--radius-ctl)] border border-border-strong bg-elevated px-4 py-2 text-[13px] font-medium text-fg transition-colors hover:bg-surface-2"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = (user?.email ?? '').toLowerCase();
  const authorized = !!user && email.endsWith(`@${ALLOWED_DOMAIN}`);

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        {!user ? children : authorized ? <AppShell userEmail={user.email ?? ''}>{children}</AppShell> : <NotAuthorized email={user.email ?? ''} />}
      </body>
    </html>
  );
}

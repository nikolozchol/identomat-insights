import type { Metadata } from 'next';
import { EmailAuthForm } from '../../components/auth/EmailAuthForm';

export const metadata: Metadata = { title: 'Sign in · Identomat Insights' };

const ERRORS: Record<string, string> = {
  domain: 'That account is not an @identomat.com address.',
  auth: 'Sign-in could not be completed. Please try again.',
};

const FEATURES = [
  'Insights computed from your own GA4, Search Console, and Clarity data',
  'Ask questions in plain language and get cited answers',
  'Turn any finding into a tracked action in one click',
];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const message = error ? ERRORS[error] ?? 'Something went wrong. Please try again.' : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-7 flex items-center gap-3">
          <div className="flex h-10 w-10 flex-none items-center justify-center rounded-[10px] bg-gradient-to-br from-iris to-[#5a48d6] text-lg font-semibold text-white">
            I
          </div>
          <div className="leading-tight">
            <div className="text-[16px] font-semibold tracking-[-0.01em] text-fg">Identomat Insights</div>
            <div className="text-[12.5px] text-fg-3">AI marketing analytics</div>
          </div>
        </div>

        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-fg">
          See what your funnel is doing — and what to do about it.
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-fg-2">
          A private workspace that reads your analytics, surfaces what changed, and explains why — calculated first, written
          in plain language second.
        </p>

        <ul className="mt-5 flex flex-col gap-2.5">
          {FEATURES.map((f) => (
            <li key={f} className="flex items-start gap-2.5 text-[13px] text-fg-2">
              <span className="mt-[7px] h-1.5 w-1.5 flex-none rounded-full bg-iris-bright" />
              <span className="leading-relaxed">{f}</span>
            </li>
          ))}
        </ul>

        <div className="mt-7">
          {message && (
            <p className="mb-3 rounded-[var(--radius-ctl)] border border-[rgba(255,107,107,0.3)] bg-[rgba(255,107,107,0.08)] px-3 py-2 text-[12.5px] text-down">
              {message}
            </p>
          )}
          <EmailAuthForm />
          <p className="mt-3 text-center text-[12px] text-fg-3">Restricted to @identomat.com accounts.</p>
        </div>
      </div>
    </div>
  );
}

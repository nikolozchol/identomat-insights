'use client';

import { useState } from 'react';
import { createSupabaseBrowser } from '../../lib/supabase/client';

const ALLOWED_DOMAIN = 'identomat.com';

export function EmailAuthForm() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const em = email.trim().toLowerCase();
    if (!em.endsWith(`@${ALLOWED_DOMAIN}`)) {
      setError(`Please use your @${ALLOWED_DOMAIN} email address.`);
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    const supabase = createSupabaseBrowser();
    try {
      const { error: authError } =
        mode === 'signup'
          ? await supabase.auth.signUp({ email: em, password })
          : await supabase.auth.signInWithPassword({ email: em, password });
      if (authError) {
        setError(authError.message);
        setLoading(false);
        return;
      }
      window.location.assign('/');
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2.5">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@identomat.com"
        autoComplete="email"
        required
        className="rounded-[var(--radius-ctl)] border border-border bg-surface-2 px-3 py-2.5 text-[13.5px] text-fg outline-none placeholder:text-fg-3 focus:border-iris-border"
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
        required
        className="rounded-[var(--radius-ctl)] border border-border bg-surface-2 px-3 py-2.5 text-[13.5px] text-fg outline-none placeholder:text-fg-3 focus:border-iris-border"
      />
      <button
        type="submit"
        disabled={loading}
        className="mt-0.5 rounded-[var(--radius-ctl)] bg-iris px-4 py-2.5 text-[13.5px] font-medium text-white transition-colors hover:bg-iris-bright disabled:opacity-60"
      >
        {loading ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
      </button>
      {error && <p className="text-[12.5px] text-down">{error}</p>}
      <button
        type="button"
        onClick={() => {
          setMode((m) => (m === 'signin' ? 'signup' : 'signin'));
          setError('');
        }}
        className="mt-1 text-center text-[12.5px] text-fg-3 transition-colors hover:text-fg-2"
      >
        {mode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in'}
      </button>
    </form>
  );
}

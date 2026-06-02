import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getSupabaseAdmin } from '../../../lib/supabase';
import { askQuestion } from '../../../lib/ask';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let question: string | undefined;
  try {
    const body = (await req.json()) as { question?: unknown };
    if (body && typeof body.question === 'string') question = body.question;
  } catch {
    /* invalid body */
  }
  if (!question || !question.trim()) {
    return NextResponse.json({ error: 'question is required' }, { status: 400 });
  }

  try {
    const result = await askQuestion({ question });
    let citedInsights: Array<{ id: string; title: string; severity: string; polarity: string; category: string }> = [];
    if (result.citedInsightIds.length > 0) {
      const supabase = getSupabaseAdmin();
      const { data } = await supabase
        .from('insights')
        .select('id, title, severity, polarity, category')
        .in('id', result.citedInsightIds);
      citedInsights = (data ?? []) as typeof citedInsights;
    }
    revalidatePath('/ask');
    return NextResponse.json({ ...result, citedInsights });
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: m }, { status: 500 });
  }
}

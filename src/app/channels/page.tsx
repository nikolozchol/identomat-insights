import { getSupabaseAdmin } from '../../lib/supabase';
import { ChannelsView, type ChannelRow } from '../../components/channels/ChannelsView';

export const revalidate = 60;

export default async function ChannelsPage() {
  const supabase = getSupabaseAdmin();

  const { data: wsData } = await supabase.from('workspaces').select('id').limit(1);
  const workspaceId = (wsData ?? [])[0]?.id as string | undefined;
  if (!workspaceId) {
    return <div className="p-10 text-[14px] text-fg-2">No workspace found.</div>;
  }

  const { data: dateData } = await supabase
    .from('ga4_daily')
    .select('date')
    .eq('workspace_id', workspaceId)
    .order('date', { ascending: false })
    .limit(1);
  const anchor = ((dateData ?? [])[0] as { date: string } | undefined)?.date ?? null;

  let channels: ChannelRow[] = [];
  let totals = { sessions: 0, conversions: 0, convRate: 0 };
  let windowLabel = 'no data yet';

  if (anchor) {
    const start = new Date(anchor + 'T00:00:00Z');
    start.setUTCDate(start.getUTCDate() - 27);
    const since = start.toISOString().slice(0, 10);
    windowLabel = `${since} to ${anchor}`;

    // Per-channel site rows: page_path='(site)', country='(all)', real channels only.
    const { data } = await supabase
      .from('ga4_daily')
      .select('channel, sessions, conversions')
      .eq('workspace_id', workspaceId)
      .eq('page_path', '(site)')
      .eq('country', '(all)')
      .neq('channel', '(all)')
      .gte('date', since)
      .lte('date', anchor);
    const rows = (data ?? []) as Array<{ channel: string | null; sessions: unknown; conversions: unknown }>;

    const agg = new Map<string, { sessions: number; conversions: number }>();
    for (const r of rows) {
      const ch = (r.channel && r.channel.trim()) || '(unassigned)';
      const cur = agg.get(ch) ?? { sessions: 0, conversions: 0 };
      cur.sessions += Number(r.sessions ?? 0);
      cur.conversions += Number(r.conversions ?? 0);
      agg.set(ch, cur);
    }
    const totalSessions = [...agg.values()].reduce((s, v) => s + v.sessions, 0);
    const totalConv = [...agg.values()].reduce((s, v) => s + v.conversions, 0);
    channels = [...agg.entries()]
      .map(([channel, v]) => ({
        channel,
        sessions: v.sessions,
        conversions: v.conversions,
        convRate: v.sessions > 0 ? (v.conversions / v.sessions) * 100 : 0,
        share: totalSessions > 0 ? (v.sessions / totalSessions) * 100 : 0,
      }))
      .sort((a, b) => b.sessions - a.sessions);
    totals = {
      sessions: totalSessions,
      conversions: totalConv,
      convRate: totalSessions > 0 ? (totalConv / totalSessions) * 100 : 0,
    };
  }

  return <ChannelsView channels={channels} totals={totals} windowLabel={windowLabel} />;
}

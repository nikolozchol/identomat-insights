export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Polarity = 'issue' | 'opportunity' | 'win';

export type Trajectory = {
  active_total: number;
  issues: number;
  opportunities: number;
  wins: number;
  by_severity: Partial<Record<Severity, number>>;
  by_category: Record<string, number>;
  new_count: number;
  multi_insight_stories: number;
};

export type Story = {
  group_key: string;
  kind: 'page' | 'entity' | 'solo';
  label: string;
  worst_severity: Severity;
  polarities: Polarity[];
  insight_ids: string[];
  member_titles: string[];
};

export type SummaryRow = {
  headline: string;
  body: string;
  trajectory: Trajectory;
  stories: Story[];
  active_insight_count: number;
  generated_at: string;
};

export type InsightRow = {
  id: string;
  detector: string;
  category: string;
  severity: Severity;
  polarity: Polarity | null;
  title: string;
  narrative: string | null;
  evidence: Record<string, unknown> | null;
  sources: string[] | null;
  page_id: string | null;
  detected_at: string;
};

export const SEV_VAR: Record<Severity, string> = {
  critical: 'var(--color-crit)',
  high: 'var(--color-high)',
  medium: 'var(--color-med)',
  low: 'var(--color-low)',
};
export const SEV_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

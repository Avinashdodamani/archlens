/**
 * Shared app theme constants — single source of truth for the UI color system
 * and typography. Reference these everywhere instead of repeating hex values or
 * inline ternaries per component so re-theming is a config change, not a rewrite.
 *
 * NOTE: This is for APP CHROME (buttons, badges, status, typography).
 * AWS service ICON colors live in aws-theme.ts and must NOT be overridden.
 */

// ─── Accent colors (CloudThat brand) ────────────────────────────────────────
// Blue = primary (buttons, nav, links). Gold = highlight/AI marker.
export const ACCENT = {
  primary: '#2563a8',      // CloudThat blue
  primaryHover: '#1b4b8f',
  ai: '#e8a020',           // CloudThat gold — "AI touched this"
  aiHover: '#d18a12',
} as const;

/** CloudThat blue gradient — for primary CTAs and the AI assistant bubble. */
export const CTA_GRADIENT = 'linear-gradient(135deg, #2563a8 0%, #1b4b8f 100%)';
export const CTA_GRADIENT_CLASS = 'bg-gradient-to-r from-primary-500 to-primary-700';

// ─── Semantic status colors + thresholds ────────────────────────────────────
// The SAME three colors and thresholds are used everywhere a score/status
// appears (health gauge, WAF bars, scan dots, priority tags, trend arrows).

export const STATUS = {
  success: '#10B981', // green  — healthy
  warning: '#F59E0B', // amber  — medium risk
  danger: '#EF4444', // red    — high risk
  neutral: '#64748B', // slate  — no data
} as const;

/** Score thresholds: >=70 healthy, >=40 warning, >0 danger, else neutral. */
export const SCORE_THRESHOLDS = { healthy: 70, warning: 40 } as const;

export type StatusLevel = 'success' | 'warning' | 'danger' | 'neutral';

/** Map a 0–100 score to a semantic status level. */
export function scoreToStatus(score: number): StatusLevel {
  if (score <= 0) return 'neutral';
  if (score >= SCORE_THRESHOLDS.healthy) return 'success';
  if (score >= SCORE_THRESHOLDS.warning) return 'warning';
  return 'danger';
}

/** Tailwind text color class for a score (consistent everywhere). */
export function scoreTextClass(score: number): string {
  return {
    success: 'text-green-400',
    warning: 'text-yellow-400',
    danger: 'text-red-400',
    neutral: 'text-gray-600',
  }[scoreToStatus(score)];
}

/** Tailwind gradient bar class for a score (WAF pillar bars, gauges). */
export function scoreBarClass(score: number): string {
  return {
    success: 'bg-gradient-to-r from-green-600 to-green-400',
    warning: 'bg-gradient-to-r from-yellow-600 to-yellow-400',
    danger: 'bg-gradient-to-r from-red-600 to-red-400',
    neutral: 'bg-dark-600',
  }[scoreToStatus(score)];
}

/** Tailwind dot color class for a score (Recent Scans status dot). */
export function scoreDotClass(score: number): string {
  return {
    success: 'bg-green-400',
    warning: 'bg-yellow-400',
    danger: 'bg-red-400',
    neutral: 'bg-gray-500',
  }[scoreToStatus(score)];
}

// ─── Priority (recommendation / remediation) badges ─────────────────────────
// Readable text shade from the same color family — never plain white/black.
export const PRIORITY_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  CRITICAL: { bg: 'bg-red-500/20', text: 'text-red-300', label: 'Critical' },
  HIGH: { bg: 'bg-orange-500/20', text: 'text-orange-300', label: 'High' },
  MEDIUM: { bg: 'bg-yellow-500/20', text: 'text-yellow-300', label: 'Medium' },
  LOW: { bg: 'bg-green-500/20', text: 'text-green-300', label: 'Low' },
};

// ─── Typography scale ────────────────────────────────────────────────────────
// Exactly 5 sizes, weights 400/500 only, nothing below 11px.
export const TYPO = {
  pageTitle: 'text-[22px] font-medium',   // 22 / 500
  sectionHeading: 'text-base font-medium', // 16 / 500
  body: 'text-sm font-normal',             // 14 / 400
  metric: 'text-2xl font-medium',          // 24 / 500
  label: 'text-xs font-normal text-gray-400', // 12 / 400 muted
} as const;

/** Microcopy shown near AI-generated content. */
export const AI_MICROCOPY = 'Powered by Claude via Amazon Bedrock';

import type { ReactNode } from 'react';

// A single number, its label, and — when it matters — why you should care.
//
// The old version was a bare number on a border-left rule, which made "0
// missing order names" (good) and "34 missing order names" (bad) look
// identical apart from the digits. Tone now drives a full card treatment, so a
// problem is visible from across the room and a healthy stat stays quiet.
export function StatBlock({
  value,
  label,
  tone = 'neutral',
  hint,
  href
}: {
  value: number | string;
  label: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
  /** Optional one-liner under the label — what the number means or what to do. */
  hint?: string;
  /** When set, the whole block becomes a link (used to point at Health). */
  href?: string;
}) {
  const toneStyles = {
    neutral: { value: 'text-ink', card: 'border-border', accent: 'bg-border-strong' },
    good: { value: 'text-teal', card: 'border-border', accent: 'bg-teal' },
    warn: { value: 'text-amber', card: 'border-amber/30', accent: 'bg-amber' },
    bad: { value: 'text-red', card: 'border-red/30', accent: 'bg-red' }
  }[tone];

  const inner: ReactNode = (
    <>
      {/* The accent rail carries tone even when the number itself is 0 and
          rendered in neutral ink — position and color, not just hue. */}
      <span className={`absolute inset-y-0 left-0 w-0.5 rounded-l ${toneStyles.accent}`} aria-hidden />
      <div className={`tabular text-2xl font-semibold leading-none ${toneStyles.value}`}>{value}</div>
      <div className="mt-1.5 text-xs leading-snug text-muted">{label}</div>
      {hint && <div className="mt-1 text-[11px] leading-snug text-faint">{hint}</div>}
    </>
  );

  const className = `relative block overflow-hidden rounded-xl border bg-panel px-3.5 py-3 shadow-card ${toneStyles.card}`;

  if (href) {
    return (
      <a href={href} className={`${className} transition-colors hover:border-border-strong hover:shadow-raised`}>
        {inner}
      </a>
    );
  }

  return <div className={className}>{inner}</div>;
}

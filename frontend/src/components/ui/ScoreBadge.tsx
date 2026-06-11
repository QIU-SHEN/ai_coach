import { clsx } from 'clsx';

interface ScoreBadgeProps {
  score?: number;
  label?: string;
  className?: string;
}

export function ScoreBadge({ score, label, className }: ScoreBadgeProps) {
  if (typeof score !== 'number' || Number.isNaN(score)) {
    return (
      <span className={clsx('text-sm text-gray-400', className)}>
        {label ? `${label}: -` : '-'}
      </span>
    );
  }

  const colorClass =
    score >= 80 ? 'text-green-600' : score >= 60 ? 'text-blue-600' : 'text-red-600';

  return (
    <span className={clsx('text-sm font-semibold tabular-nums', colorClass, className)}>
      {label ? `${label}: ` : ''}
      {score}
    </span>
  );
}

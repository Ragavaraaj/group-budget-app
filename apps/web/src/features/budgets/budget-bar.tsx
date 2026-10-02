import { type BudgetStatus, formatPaise } from '@budget/shared';
import { cn } from '@/lib/utils';

const BAR: Record<BudgetStatus['level'], string> = {
  ok: 'bg-primary',
  warn: 'bg-amber-500',
  over: 'bg-destructive',
};

/** How much of a budget is used, as a labelled progress bar. */
export function BudgetBar({ status, name }: { status: BudgetStatus; name: string }) {
  const percent = Math.min(100, status.usedBp / 100);
  const message =
    status.level === 'over'
      ? `Over by ${formatPaise(-status.remainingMinor)}`
      : status.level === 'warn'
        ? `${Math.round(status.usedBp / 100)}% used, ${formatPaise(status.remainingMinor)} left`
        : `${formatPaise(status.remainingMinor)} left`;

  return (
    <div className="space-y-1.5" data-testid="budget-bar" data-level={status.level}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-medium">{name}</span>
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
          {formatPaise(status.spentMinor)} of {formatPaise(status.amountMinor)}
        </span>
      </div>
      <div
        className="bg-muted h-2 overflow-hidden rounded-full"
        role="progressbar"
        aria-label={`${name} budget`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        aria-valuetext={message}
      >
        <div
          className={cn('h-full rounded-full', BAR[status.level])}
          style={{ width: `${Math.max(status.spentMinor > 0 ? 2 : 0, percent)}%` }}
        />
      </div>
      <p
        className={cn(
          'text-xs',
          status.level === 'over'
            ? 'text-destructive font-medium'
            : status.level === 'warn'
              ? 'font-medium text-amber-600 dark:text-amber-400'
              : 'text-muted-foreground',
        )}
      >
        {message}
      </p>
    </div>
  );
}

import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** The deep teal card at the top of a screen: a period to step through and the figure for it. */
export function HeroCard({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section
      className={cn(
        'bg-hero text-hero-foreground space-y-3 rounded-3xl px-4 pt-3.5 pb-5 shadow-sm',
        className,
      )}
    >
      {children}
    </section>
  );
}

interface HeroStepperProps {
  label: string;
  previousLabel: string;
  nextLabel: string;
  onPrevious: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
  /** Test id for the period label, where a screen's tests read it. */
  labelTestId?: string;
}

/** Previous / next arrows around the period's name. */
export function HeroStepper({
  label,
  previousLabel,
  nextLabel,
  onPrevious,
  onNext,
  nextDisabled,
  labelTestId,
}: HeroStepperProps) {
  const arrow =
    'grid size-11 place-items-center rounded-2xl bg-white/12 transition-colors hover:bg-white/20 focus-visible:ring-[3px] focus-visible:ring-white/50 outline-none disabled:bg-white/5 disabled:text-white/40 disabled:pointer-events-none';
  return (
    <div className="flex items-center justify-between">
      <button type="button" aria-label={previousLabel} className={arrow} onClick={onPrevious}>
        <ChevronLeft className="size-5" aria-hidden="true" />
      </button>
      <span className="font-semibold" data-testid={labelTestId}>
        {label}
      </span>
      <button
        type="button"
        aria-label={nextLabel}
        className={arrow}
        disabled={nextDisabled}
        onClick={onNext}
      >
        <ChevronRight className="size-5" aria-hidden="true" />
      </button>
    </div>
  );
}

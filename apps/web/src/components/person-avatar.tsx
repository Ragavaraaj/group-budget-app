import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';

// Soft tints with dark/light text pairs that keep 4.5:1 contrast in both themes.
const TINTS = [
  'bg-teal-100 text-teal-900 dark:bg-teal-400/20 dark:text-teal-200',
  'bg-violet-100 text-violet-900 dark:bg-violet-400/20 dark:text-violet-200',
  'bg-sky-100 text-sky-900 dark:bg-sky-400/20 dark:text-sky-200',
  'bg-amber-100 text-amber-900 dark:bg-amber-400/20 dark:text-amber-200',
  'bg-rose-100 text-rose-900 dark:bg-rose-400/20 dark:text-rose-200',
  'bg-lime-100 text-lime-900 dark:bg-lime-400/20 dark:text-lime-200',
];

function tintFor(id: string) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TINTS[hash % TINTS.length];
}

/** A round badge with a person's initials, tinted by who they are so people are easy to tell apart. */
export function PersonAvatar({
  id,
  name,
  className,
}: {
  id: string;
  name: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-10 shrink-0 place-items-center rounded-full text-sm font-bold',
        tintFor(id),
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

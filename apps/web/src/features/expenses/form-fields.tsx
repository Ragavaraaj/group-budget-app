import { CategoryIcon } from '@/components/category-icon';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { LocalCategory } from '@/db/types';
import { cn } from '@/lib/utils';

/** The big rupee amount field both the expense form and the recurring-expense form open with. */
export function AmountField({
  value,
  onChange,
  invalid,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
  autoFocus: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="amount">Amount</Label>
      <div className="relative">
        <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-2xl">
          ₹
        </span>
        <Input
          id="amount"
          // Amount first: the keyboard is up and the cursor is here as soon as the page opens.
          autoFocus={autoFocus}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          className="h-14 pl-9 text-3xl font-semibold tabular-nums md:text-3xl"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid}
        />
      </div>
    </div>
  );
}

/** One tap picks a category; tapping it again clears it. */
export function CategoryChips({
  categories,
  value,
  onChange,
}: {
  categories: LocalCategory[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="text-sm font-medium">Category</legend>
      <div className="flex flex-wrap gap-2">
        {categories.map((category) => (
          <button
            key={category.id}
            type="button"
            aria-pressed={value === category.id}
            onClick={() => onChange(value === category.id ? null : category.id)}
            className={cn(
              'flex max-w-full items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-sm transition-colors',
              value === category.id
                ? 'border-primary bg-primary/10 font-medium'
                : 'hover:bg-accent',
            )}
          >
            <CategoryIcon
              icon={category.icon}
              color={category.color}
              className="size-7 [&_svg]:size-4"
            />
            <span className="min-w-0 truncate">{category.name}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

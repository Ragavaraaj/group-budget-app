import { parseRupees, toRupeesString, uuidv7 } from '@budget/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { useDb, useMe } from '@/auth/sync-context';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { saveBudget } from '@/db/repo';
import type { LocalBudget, LocalCategory } from '@/db/types';
import { tryLocal } from '@/lib/local-errors';
import { budgetChoices, OVERALL } from './choices';

interface BudgetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
  categories: LocalCategory[];
  /** Budgets that already exist, so a category isn't given a second one. */
  budgets: LocalBudget[];
  /** Present when editing; absent when adding. */
  existing?: LocalBudget;
}

/** Set a monthly limit for everything, or for one category. */
export function BudgetDialog({ open, onOpenChange, ...rest }: BudgetDialogProps) {
  // Remount on open so the fields start from the budget being edited.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? <BudgetForm {...rest} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function BudgetForm({
  groupId,
  categories,
  budgets,
  existing,
  onDone,
}: Omit<BudgetDialogProps, 'open' | 'onOpenChange'> & { onDone: () => void }) {
  const db = useDb();
  const { user } = useMe();
  // A new budget can go to anything that doesn't have one yet; an existing one keeps its target.
  const choices = budgetChoices(categories, budgets, existing);
  // Nothing to pick when everything has a budget: there is nothing to save then either.
  const [target, setTarget] = useState<string | undefined>(
    existing ? (existing.categoryId ?? OVERALL) : choices[0]?.id,
  );
  const [amountText, setAmountText] = useState(
    existing ? toRupeesString(existing.amountMinor) : '',
  );
  const amountMinor = parseRupees(amountText);
  const valid = amountMinor !== null && amountMinor > 0;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || amountMinor === null || target === undefined) return;
        void tryLocal(() =>
          saveBudget(db, user.id, {
            id: existing?.id ?? uuidv7(),
            groupId,
            categoryId: target === OVERALL ? null : target,
            amountMinor,
          }),
        ).then((saved) => {
          if (!saved) return;
          toast.success(existing ? 'Budget updated' : 'Budget set');
          onDone();
        });
      }}
    >
      <DialogHeader>
        <DialogTitle>{existing ? 'Edit budget' : 'New budget'}</DialogTitle>
        <DialogDescription>
          A limit for each month. You’ll see a warning at 80% and again when it’s passed.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        <Label htmlFor="budget-target">For</Label>
        {target === undefined ? (
          <p className="text-muted-foreground text-sm" role="status">
            Everything, and every category, already has a budget. Edit one of those instead.
          </p>
        ) : (
          <Select value={target} onValueChange={setTarget} disabled={existing !== undefined}>
            <SelectTrigger id="budget-target" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {choices.map((choice) => (
                <SelectItem key={choice.id} value={choice.id}>
                  {choice.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="budget-amount">Monthly limit</Label>
        <div className="relative">
          <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2">
            ₹
          </span>
          <Input
            id="budget-amount"
            autoFocus
            inputMode="decimal"
            autoComplete="off"
            className="pl-8"
            placeholder="0"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            aria-invalid={amountText !== '' && !valid}
          />
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!valid || target === undefined}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

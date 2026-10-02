import { CATEGORY_NAME_MAX, uuidv7 } from '@budget/shared';
import { useState } from 'react';
import { useDb, useMe } from '@/auth/sync-context';
import { CATEGORY_COLORS, CATEGORY_ICONS, CategoryIcon } from '@/components/category-icon';
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
import { saveCategory } from '@/db/repo';
import type { LocalCategory } from '@/db/types';
import { tryLocal } from '@/lib/local-errors';
import { cn } from '@/lib/utils';

interface CategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
  /** Present when editing; absent when adding. */
  existing?: LocalCategory;
}

/** Add or edit a category: a name, an icon and a colour. */
export function CategoryDialog({ open, onOpenChange, groupId, existing }: CategoryDialogProps) {
  // Remount on open so the fields always start from the category being edited.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? (
          <CategoryForm groupId={groupId} existing={existing} onDone={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CategoryForm({
  groupId,
  existing,
  onDone,
}: {
  groupId: string;
  existing?: LocalCategory;
  onDone: () => void;
}) {
  const db = useDb();
  const { user } = useMe();
  const [name, setName] = useState(existing?.name ?? '');
  const [icon, setIcon] = useState(existing?.icon ?? 'tag');
  const [color, setColor] = useState(existing?.color ?? CATEGORY_COLORS[0] ?? '#64748b');

  const trimmed = name.trim();

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!trimmed) return;
        void tryLocal(() =>
          saveCategory(db, user.id, {
            id: existing?.id ?? uuidv7(),
            groupId,
            name: trimmed,
            icon,
            color,
            archived: existing?.archived ?? false,
          }),
        ).then((saved) => saved && onDone());
      }}
    >
      <DialogHeader>
        <DialogTitle>{existing ? 'Edit category' : 'New category'}</DialogTitle>
        <DialogDescription>Pick a name, an icon and a colour.</DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        <Label htmlFor="category-name">Name</Label>
        <Input
          id="category-name"
          autoFocus
          maxLength={CATEGORY_NAME_MAX}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Icon</legend>
        <div className="grid grid-cols-5 gap-2">
          {Object.keys(CATEGORY_ICONS).map((key) => (
            <button
              key={key}
              type="button"
              aria-label={key.replaceAll('-', ' ')}
              aria-pressed={icon === key}
              onClick={() => setIcon(key)}
              className={cn(
                'rounded-lg border p-1',
                icon === key ? 'border-primary bg-primary/10' : 'hover:bg-accent',
              )}
            >
              <CategoryIcon icon={key} color={color} className="mx-auto" />
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Colour</legend>
        <div className="flex flex-wrap gap-2">
          {CATEGORY_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Colour ${c}`}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              className={cn(
                'size-8 rounded-full border-2',
                color === c ? 'border-foreground' : 'border-transparent',
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </fieldset>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!trimmed}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

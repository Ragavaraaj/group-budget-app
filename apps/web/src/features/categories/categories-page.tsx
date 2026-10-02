import { Archive, ArchiveRestore, ArrowLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { useDb, useMe } from '@/auth/sync-context';
import { CategoryIcon } from '@/components/category-icon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCategories, useGroups } from '@/db/hooks';
import { deleteCategory, saveCategory } from '@/db/repo';
import type { LocalCategory } from '@/db/types';
import { tryLocal } from '@/lib/local-errors';
import { CategoryDialog } from './category-dialog';

/** `/settings/categories`: each group (and the personal ledger) has its own categories. */
export function CategoriesPage() {
  const { personalGroupId, user } = useMe();
  const db = useDb();
  const groups = useGroups();
  const [params, setParams] = useSearchParams();
  const requested = params.get('group');
  const groupId = groups?.some((g) => g.id === requested)
    ? (requested ?? personalGroupId)
    : personalGroupId;
  const categories = useCategories(groupId, { includeArchived: true });
  const [editing, setEditing] = useState<LocalCategory | 'new' | null>(null);

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to settings">
          <Link to="/settings">
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="flex-1 text-xl font-semibold tracking-tight">Categories</h1>
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus /> Add
        </Button>
      </header>

      {groups && groups.length > 1 ? (
        <Select
          value={groupId}
          onValueChange={(value) => setParams({ group: value }, { replace: true })}
        >
          <SelectTrigger className="w-full" aria-label="Group">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.isPersonal ? 'Personal' : g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      <ul className="divide-y rounded-lg border">
        {categories?.map((category) => (
          <li key={category.id} className="flex items-center gap-3 p-3">
            <CategoryIcon icon={category.icon} color={category.color} />
            <span className="min-w-0 flex-1 truncate font-medium">{category.name}</span>
            {category.archived ? <Badge variant="secondary">Archived</Badge> : null}
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Edit ${category.name}`}
              onClick={() => setEditing(category)}
            >
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`${category.archived ? 'Restore' : 'Archive'} ${category.name}`}
              title={
                category.archived
                  ? 'Show in the list again'
                  : 'Hide from the list, keep on old expenses'
              }
              onClick={() =>
                void tryLocal(() =>
                  saveCategory(db, user.id, {
                    id: category.id,
                    groupId: category.groupId,
                    name: category.name,
                    icon: category.icon,
                    color: category.color,
                    archived: !category.archived,
                  }),
                )
              }
            >
              {category.archived ? <ArchiveRestore /> : <Archive />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Delete ${category.name}`}
              onClick={async () => {
                if (!(await tryLocal(() => deleteCategory(db, user.id, category.id)))) return;
                toast(`Deleted “${category.name}”`, {
                  description: 'Existing expenses keep their category name.',
                });
              }}
            >
              <Trash2 />
            </Button>
          </li>
        ))}
        {categories?.length === 0 ? (
          <li className="text-muted-foreground p-4 text-center text-sm">No categories yet.</li>
        ) : null}
      </ul>

      <CategoryDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        groupId={groupId}
        existing={editing && editing !== 'new' ? editing : undefined}
      />
    </div>
  );
}

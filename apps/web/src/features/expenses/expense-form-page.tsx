import {
  type ExpenseData,
  expenseDataSchema,
  parseRupees,
  toLocalDate,
  toRupeesString,
  uuidv7,
} from '@budget/shared';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { useDb, useMe } from '@/auth/sync-context';
import { NotFoundPage } from '@/components/not-found-page';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useCategories, useExpense, useGroups, useMembers } from '@/db/hooks';
import { deleteExpense, restoreExpense, saveExpense } from '@/db/repo';
import type { LocalExpense } from '@/db/types';
import { tryLocal } from '@/lib/local-errors';
import { AmountField, CategoryChips } from './form-fields';
import { draftFromExpense, newDraft, resolveSplit, type SplitDraft } from './split-draft';
import { SplitSection } from './split-section';

const lastCategoryKey = (groupId: string) => `gb:last-category:${groupId}`;

function readLastCategory(groupId: string): string | null {
  try {
    return localStorage.getItem(lastCategoryKey(groupId));
  } catch {
    return null;
  }
}
function rememberCategory(groupId: string, categoryId: string | null) {
  try {
    if (categoryId) localStorage.setItem(lastCategoryKey(groupId), categoryId);
  } catch {
    // A nicety only.
  }
}

/** `/add` (optionally `?group=<id>`) and `/expenses/:id/edit`. */
export function ExpenseFormPage() {
  const { id } = useParams();
  const existing = useExpense(id);
  if (id) {
    if (existing === undefined) return <FormSkeleton />;
    if (existing === null || existing.deletedAt !== null) return <NotFoundPage />;
    return <ExpenseForm existing={existing} groupId={existing.groupId} />;
  }
  return <AddExpense />;
}

function FormSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10" />
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
    </div>
  );
}

function AddExpense() {
  const { personalGroupId } = useMe();
  const [params] = useSearchParams();
  const groups = useGroups();
  if (!groups) return <FormSkeleton />;
  const requested = params.get('group');
  const groupId = groups.some((g) => g.id === requested)
    ? (requested ?? personalGroupId)
    : personalGroupId;
  return <ExpenseForm key={groupId} existing={null} groupId={groupId} />;
}

interface ExpenseFormProps {
  existing: LocalExpense | null;
  groupId: string;
}

function ExpenseForm({ existing, groupId }: ExpenseFormProps) {
  const me = useMe();
  const db = useDb();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const groups = useGroups();
  const members = useMembers(groupId);
  const categories = useCategories(groupId);

  const group = groups?.find((g) => g.id === groupId);
  const shared = group ? !group.isPersonal : false;

  const [amountText, setAmountText] = useState(
    existing ? toRupeesString(existing.amountMinor) : '',
  );
  const [date, setDate] = useState(existing?.occurredOn ?? toLocalDate());
  const [note, setNote] = useState(existing?.note ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(
    existing ? existing.categoryId : readLastCategory(groupId),
  );
  const [draft, setDraft] = useState<SplitDraft | null>(null);
  const [saving, setSaving] = useState(false);

  // People who can be picked: the active members, plus anyone who already appears in this expense.
  const participants = useMemo(() => {
    if (!members) return [];
    const inExpense = new Set(
      existing ? [...existing.payers, ...existing.shares].map((p) => p.userId) : [],
    );
    return members
      .filter((m) => m.removedAt === null || inExpense.has(m.userId))
      .sort(
        (a, b) =>
          Number(b.userId === me.user.id) - Number(a.userId === me.user.id) ||
          a.displayName.localeCompare(b.displayName),
      );
  }, [members, existing, me.user.id]);

  // Set up the split once the members are known.
  useEffect(() => {
    if (draft || !members) return;
    const ids = participants.filter((m) => m.removedAt === null).map((m) => m.userId);
    setDraft(
      existing ? draftFromExpense(existing) : newDraft(me.user.id, ids.length ? ids : [me.user.id]),
    );
  }, [draft, members, participants, existing, me.user.id]);

  // A category that no longer exists (or was archived) shouldn't stay selected on a new expense.
  useEffect(() => {
    if (!existing && categories && categoryId && !categories.some((c) => c.id === categoryId)) {
      setCategoryId(null);
    }
  }, [categories, categoryId, existing]);

  const amountMinor = parseRupees(amountText);
  const personal: SplitDraft = useMemo(
    () => ({ ...newDraft(me.user.id, [me.user.id]) }),
    [me.user.id],
  );
  const resolved = resolveSplit(shared ? (draft ?? personal) : personal, amountMinor);

  if (!groups || !members || !categories || !draft) return <FormSkeleton />;

  const back = () =>
    navigate(params.get('from') ?? (shared ? `/groups/${groupId}` : '/'), { replace: true });

  const save = async () => {
    if (!resolved.ok || amountMinor === null) return;
    const data: ExpenseData = {
      id: existing?.id ?? uuidv7(),
      groupId,
      occurredOn: date,
      amountMinor,
      categoryId,
      note: note.trim(),
      splitType: resolved.splitType,
      payers: resolved.payers,
      shares: resolved.shares,
    };
    const check = expenseDataSchema.safeParse(data);
    if (!check.success) {
      toast.error('Something in this expense doesn’t look right. Please check the details.');
      return;
    }
    setSaving(true);
    // If the browser refuses the write, stay here with everything typed so the person can retry.
    const saved = await tryLocal(() => saveExpense(db, me.user.id, check.data));
    setSaving(false);
    if (!saved) return;
    rememberCategory(groupId, categoryId);
    toast.success(existing ? 'Expense updated' : 'Expense added');
    back();
  };

  const remove = async () => {
    if (!existing) return;
    if (!(await tryLocal(() => deleteExpense(db, me.user.id, existing.id)))) return;
    toast('Expense deleted', {
      action: {
        label: 'Undo',
        onClick: () => void tryLocal(() => restoreExpense(db, me.user.id, existing.id)),
      },
    });
    back();
  };

  const canSave = resolved.ok && date !== '' && !saving;

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <header className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back">
          <Link to={params.get('from') ?? (shared ? `/groups/${groupId}` : '/')} replace>
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="flex-1 text-xl font-semibold tracking-tight">
          {existing ? 'Edit expense' : 'Add expense'}
          {shared && group ? (
            <span className="text-muted-foreground block text-sm font-normal">{group.name}</span>
          ) : null}
        </h1>
        {existing ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Delete expense"
            onClick={remove}
          >
            <Trash2 />
          </Button>
        ) : null}
      </header>

      <AmountField
        value={amountText}
        onChange={setAmountText}
        invalid={amountText !== '' && amountMinor === null}
        autoFocus={!existing}
      />

      <CategoryChips categories={categories} value={categoryId} onChange={setCategoryId} />

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="date">Date</Label>
          <DatePicker id="date" max={toLocalDate()} value={date} onChange={setDate} />
        </div>
        {!existing && groups.length > 1 ? (
          <div className="space-y-2">
            <Label htmlFor="group">Group</Label>
            <Select
              value={groupId}
              onValueChange={(value) => navigate(`/add?group=${value}`, { replace: true })}
            >
              <SelectTrigger id="group" className="w-full">
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
          </div>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="note">Note (optional)</Label>
        <Input
          id="note"
          maxLength={200}
          placeholder="What was it for?"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {shared ? (
        <SplitSection
          draft={draft}
          onChange={setDraft}
          members={participants}
          resolved={resolved}
        />
      ) : null}

      <Button type="submit" size="lg" className="w-full" disabled={!canSave}>
        {existing ? 'Save changes' : 'Add expense'}
      </Button>
    </form>
  );
}

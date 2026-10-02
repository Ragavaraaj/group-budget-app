import {
  parseRupees,
  RECURRENCES,
  type Recurrence,
  type RecurringData,
  recurringDataSchema,
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
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useCategories, useGroups, useMembers, useRecurringRule } from '@/db/hooks';
import { deleteRecurring, restoreRecurring, saveRecurring } from '@/db/repo';
import type { LocalRecurring } from '@/db/types';
import { AmountField, CategoryChips } from '@/features/expenses/form-fields';
import {
  draftFromExpense,
  newDraft,
  resolveSplit,
  type SplitDraft,
} from '@/features/expenses/split-draft';
import { SplitSection } from '@/features/expenses/split-section';
import { tryLocal } from '@/lib/local-errors';
import { describeSchedule, FREQUENCY_LABELS } from './describe';

/** `/settings/recurring/new` and `/settings/recurring/:id`. */
export function RecurringFormPage() {
  const { id } = useParams();
  const existing = useRecurringRule(id);
  const { personalGroupId } = useMe();
  const [params] = useSearchParams();
  const groups = useGroups();

  if (id) {
    if (existing === undefined) return <Skeleton className="h-48" />;
    if (existing === null || existing.deletedAt !== null) return <NotFoundPage />;
    return <RecurringForm existing={existing} groupId={existing.groupId} />;
  }
  if (!groups) return <Skeleton className="h-48" />;
  const requested = params.get('group');
  const groupId = groups.some((g) => g.id === requested)
    ? (requested ?? personalGroupId)
    : personalGroupId;
  return <RecurringForm key={groupId} existing={null} groupId={groupId} />;
}

function RecurringForm({
  existing,
  groupId,
}: {
  existing: LocalRecurring | null;
  groupId: string;
}) {
  const me = useMe();
  const db = useDb();
  const navigate = useNavigate();
  const groups = useGroups();
  const members = useMembers(groupId);
  const categories = useCategories(groupId);
  const group = groups?.find((g) => g.id === groupId);
  const shared = group ? !group.isPersonal : false;

  const [amountText, setAmountText] = useState(
    existing ? toRupeesString(existing.amountMinor) : '',
  );
  const [note, setNote] = useState(existing?.note ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(existing?.categoryId ?? null);
  const [frequency, setFrequency] = useState<Recurrence>(existing?.frequency ?? 'monthly');
  const [startOn, setStartOn] = useState(existing?.startOn ?? toLocalDate());
  const [endOn, setEndOn] = useState(existing?.endOn ?? '');
  const [active, setActive] = useState(existing?.active ?? true);
  const [draft, setDraft] = useState<SplitDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const participants = useMemo(() => {
    if (!members) return [];
    const inRule = new Set(
      existing ? [...existing.payers, ...existing.shares].map((p) => p.userId) : [],
    );
    return members
      .filter((m) => m.removedAt === null || inRule.has(m.userId))
      .sort(
        (a, b) =>
          Number(b.userId === me.user.id) - Number(a.userId === me.user.id) ||
          a.displayName.localeCompare(b.displayName),
      );
  }, [members, existing, me.user.id]);

  useEffect(() => {
    if (draft || !members) return;
    const ids = participants.filter((m) => m.removedAt === null).map((m) => m.userId);
    setDraft(
      existing ? draftFromExpense(existing) : newDraft(me.user.id, ids.length ? ids : [me.user.id]),
    );
  }, [draft, members, participants, existing, me.user.id]);

  const amountMinor = parseRupees(amountText);
  const personal = useMemo(() => newDraft(me.user.id, [me.user.id]), [me.user.id]);
  const resolved = resolveSplit(shared ? (draft ?? personal) : personal, amountMinor);

  if (!groups || !members || !categories || !draft) return <Skeleton className="h-48" />;

  const back = () => navigate('/settings/recurring', { replace: true });
  const endBeforeStart = endOn !== '' && endOn < startOn;
  const canSave = resolved.ok && startOn !== '' && !endBeforeStart && !saving;

  const save = async () => {
    if (!resolved.ok || amountMinor === null) return;
    const data: RecurringData = {
      id: existing?.id ?? uuidv7(),
      groupId,
      frequency,
      startOn,
      endOn: endOn === '' ? null : endOn,
      active,
      amountMinor,
      categoryId,
      note: note.trim(),
      splitType: resolved.splitType,
      payers: resolved.payers,
      shares: resolved.shares,
    };
    const check = recurringDataSchema.safeParse(data);
    if (!check.success) {
      toast.error('Something here doesn’t look right. Please check the details.');
      return;
    }
    setSaving(true);
    const saved = await tryLocal(() => saveRecurring(db, me.user.id, check.data));
    setSaving(false);
    if (!saved) return;
    toast.success(existing ? 'Changes saved' : 'Recurring expense added');
    back();
  };

  const remove = async () => {
    if (!existing) return;
    if (!(await tryLocal(() => deleteRecurring(db, me.user.id, existing.id)))) return;
    toast('Recurring expense deleted', {
      description: 'Expenses it already added stay.',
      action: {
        label: 'Undo',
        onClick: () => void tryLocal(() => restoreRecurring(db, me.user.id, existing.id)),
      },
    });
    back();
  };

  const startsInPast = !existing && startOn < toLocalDate();

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
          <Link to="/settings/recurring" replace>
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="flex-1 text-xl font-semibold tracking-tight">
          {existing ? 'Edit recurring expense' : 'New recurring expense'}
          {shared && group ? (
            <span className="text-muted-foreground block text-sm font-normal">{group.name}</span>
          ) : null}
        </h1>
        {existing ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Delete recurring expense"
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

      <div className="space-y-2">
        <Label htmlFor="rule-note">What is it?</Label>
        <Input
          id="rule-note"
          maxLength={200}
          placeholder="Rent, Netflix, SIP…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <CategoryChips categories={categories} value={categoryId} onChange={setCategoryId} />

      <div className="space-y-2">
        <Label>Repeats</Label>
        <ToggleGroup
          type="single"
          variant="outline"
          className="w-full"
          value={frequency}
          onValueChange={(value) => {
            if (value) setFrequency(value as Recurrence);
          }}
        >
          {RECURRENCES.map((r) => (
            <ToggleGroupItem key={r} value={r} className="flex-1">
              {FREQUENCY_LABELS[r]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-muted-foreground text-xs" data-testid="schedule-summary">
          {describeSchedule({ frequency, startOn })}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="rule-start">First on</Label>
          <Input
            id="rule-start"
            type="date"
            required
            min={existing ? undefined : toLocalDate()}
            value={startOn}
            onChange={(e) => setStartOn(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rule-end">Until (optional)</Label>
          <Input
            id="rule-end"
            type="date"
            min={startOn}
            value={endOn}
            onChange={(e) => setEndOn(e.target.value)}
            aria-invalid={endBeforeStart}
          />
        </div>
      </div>
      {startsInPast ? (
        <p className="text-muted-foreground text-xs">
          Dates that have already passed are added too, up to the last three months.
        </p>
      ) : null}

      {!existing && groups.length > 1 ? (
        <div className="space-y-2">
          <Label htmlFor="rule-group">Group</Label>
          <Select
            value={groupId}
            onValueChange={(value) =>
              navigate(`/settings/recurring/new?group=${value}`, { replace: true })
            }
          >
            <SelectTrigger id="rule-group" className="w-full">
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

      {shared ? (
        <SplitSection
          draft={draft}
          onChange={setDraft}
          members={participants}
          resolved={resolved}
        />
      ) : null}

      {existing ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <Label htmlFor="rule-active" className="flex-1">
            Add these automatically
            <span className="text-muted-foreground block text-xs font-normal">
              Turn off to pause. Turning it back on starts from today.
            </span>
          </Label>
          <Switch id="rule-active" checked={active} onCheckedChange={setActive} />
        </div>
      ) : null}

      <Button type="submit" size="lg" className="w-full" disabled={!canSave}>
        {existing ? 'Save changes' : 'Add recurring expense'}
      </Button>
    </form>
  );
}

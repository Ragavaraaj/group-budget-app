import { formatPaise, SPLIT_TYPES, type SplitType } from '@budget/shared';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { LocalMember } from '@/db/types';
import { initials } from '@/lib/format';
import { type Resolved, type SplitDraft, withType } from './split-draft';

const TYPE_LABELS: Record<SplitType, string> = {
  equal: 'Equally',
  exact: 'Exact',
  percent: 'Percent',
  shares: 'Shares',
};

const VALUE_HINT: Record<
  Exclude<SplitType, 'equal'>,
  { label: string; placeholder: string; inputMode: 'decimal' | 'numeric' }
> = {
  exact: { label: 'Amount in rupees', placeholder: '₹0', inputMode: 'decimal' },
  percent: { label: 'Percent', placeholder: '0%', inputMode: 'decimal' },
  shares: { label: 'Shares', placeholder: '1', inputMode: 'numeric' },
};

interface SplitSectionProps {
  draft: SplitDraft;
  onChange: (draft: SplitDraft) => void;
  /** Everyone who may be picked, in display order. People who left are shown only if already in. */
  members: LocalMember[];
  resolved: Resolved;
}

const nameOf = (member: LocalMember) =>
  member.removedAt === null ? member.displayName : `${member.displayName} (left)`;

function Person({ member }: { member: LocalMember }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar className="size-7">
        {member.avatarUrl ? (
          <AvatarImage src={member.avatarUrl} alt="" referrerPolicy="no-referrer" />
        ) : null}
        <AvatarFallback className="text-xs">{initials(member.displayName)}</AvatarFallback>
      </Avatar>
      <span className="truncate">{nameOf(member)}</span>
    </span>
  );
}

/** "Paid by" and "Split" for an expense in a shared group. */
export function SplitSection({ draft, onChange, members, resolved }: SplitSectionProps) {
  const memberIds = members.map((m) => m.userId);
  const set = (patch: Partial<SplitDraft>) => onChange({ ...draft, ...patch });
  const shareOf = (userId: string) =>
    resolved.ok ? resolved.shares.find((s) => s.userId === userId)?.amountMinor : undefined;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="payer">Paid by</Label>
          <span className="text-muted-foreground flex items-center gap-2 text-xs">
            <Label htmlFor="multi-payers" className="text-xs font-normal">
              More than one person
            </Label>
            <Switch
              id="multi-payers"
              checked={draft.multiplePayers}
              onCheckedChange={(multiplePayers) => set({ multiplePayers })}
            />
          </span>
        </div>

        {draft.multiplePayers ? (
          <ul className="space-y-2">
            {members.map((member) => (
              <li key={member.userId} className="flex items-center justify-between gap-3">
                <Person member={member} />
                <Input
                  aria-label={`Amount paid by ${member.displayName}`}
                  className="w-28 text-right"
                  inputMode="decimal"
                  placeholder="₹0"
                  value={draft.payerAmounts[member.userId] ?? ''}
                  onChange={(e) =>
                    set({
                      payerAmounts: { ...draft.payerAmounts, [member.userId]: e.target.value },
                    })
                  }
                />
              </li>
            ))}
          </ul>
        ) : (
          <Select value={draft.payerId} onValueChange={(payerId) => set({ payerId })}>
            <SelectTrigger id="payer" className="w-full">
              <SelectValue placeholder="Choose who paid" />
            </SelectTrigger>
            <SelectContent>
              {members.map((member) => (
                <SelectItem key={member.userId} value={member.userId}>
                  {nameOf(member)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="space-y-3">
        <Label>Split</Label>
        <ToggleGroup
          type="single"
          variant="outline"
          className="w-full"
          value={draft.type}
          onValueChange={(value) => {
            if (value) onChange(withType(draft, value as SplitType, memberIds));
          }}
        >
          {SPLIT_TYPES.map((type) => (
            <ToggleGroupItem key={type} value={type} className="flex-1">
              {TYPE_LABELS[type]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <ul className="space-y-2">
          {members.map((member) => {
            const share = shareOf(member.userId);
            return (
              <li key={member.userId} className="flex items-center justify-between gap-3">
                {draft.type === 'equal' ? (
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <Checkbox
                      id={`share-${member.userId}`}
                      checked={draft.included.includes(member.userId)}
                      onCheckedChange={(checked) =>
                        set({
                          included: checked
                            ? [...draft.included, member.userId]
                            : draft.included.filter((id) => id !== member.userId),
                        })
                      }
                    />
                    <Label
                      htmlFor={`share-${member.userId}`}
                      className="min-w-0 flex-1 font-normal"
                    >
                      <Person member={member} />
                    </Label>
                  </div>
                ) : (
                  <>
                    <Person member={member} />
                    <Input
                      aria-label={`${VALUE_HINT[draft.type].label} for ${member.displayName}`}
                      className="w-28 text-right"
                      inputMode={VALUE_HINT[draft.type].inputMode}
                      placeholder={VALUE_HINT[draft.type].placeholder}
                      value={draft.values[member.userId] ?? ''}
                      onChange={(e) =>
                        set({ values: { ...draft.values, [member.userId]: e.target.value } })
                      }
                    />
                  </>
                )}
                {draft.type === 'equal' || draft.type === 'exact' ? null : (
                  <span className="text-muted-foreground w-20 text-right text-sm tabular-nums">
                    {share !== undefined ? formatPaise(share) : ''}
                  </span>
                )}
                {draft.type === 'equal' ? (
                  <span className="text-muted-foreground w-20 text-right text-sm tabular-nums">
                    {share !== undefined ? formatPaise(share) : ''}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>

        {!resolved.ok ? (
          <p className="text-muted-foreground text-sm" role="status">
            {resolved.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}

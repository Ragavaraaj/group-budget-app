import { parseRupees, toLocalDate, toRupeesString, uuidv7 } from '@budget/shared';
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
import { saveSettlement } from '@/db/repo';
import type { LocalMember } from '@/db/types';

export interface SettleDefaults {
  from: string;
  to: string;
  amountMinor: number;
}

interface SettleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
  members: LocalMember[];
  defaults?: SettleDefaults;
}

/** Records that one person paid another back. Works offline like any other entry. */
export function SettleDialog({
  open,
  onOpenChange,
  groupId,
  members,
  defaults,
}: SettleDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? (
          <SettleForm
            groupId={groupId}
            members={members}
            defaults={defaults}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SettleForm({
  groupId,
  members,
  defaults,
  onDone,
}: Omit<SettleDialogProps, 'open' | 'onOpenChange'> & { onDone: () => void }) {
  const db = useDb();
  const { user } = useMe();
  const [from, setFrom] = useState(defaults?.from ?? user.id);
  const [to, setTo] = useState(
    defaults?.to ?? members.find((m) => m.userId !== user.id)?.userId ?? '',
  );
  const [amountText, setAmountText] = useState(
    defaults ? toRupeesString(defaults.amountMinor) : '',
  );

  const amount = parseRupees(amountText);
  const valid = amount !== null && amount > 0 && from !== '' && to !== '' && from !== to;
  const name = (id: string) => members.find((m) => m.userId === id)?.displayName ?? 'Someone';

  const people = (
    <SelectContent>
      {members.map((m) => (
        <SelectItem key={m.userId} value={m.userId}>
          {m.displayName}
        </SelectItem>
      ))}
    </SelectContent>
  );

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || amount === null) return;
        void saveSettlement(db, user.id, {
          id: uuidv7(),
          groupId,
          fromUser: from,
          toUser: to,
          amountMinor: amount,
          occurredOn: toLocalDate(),
          note: '',
        }).then(() => {
          toast.success(`Recorded: ${name(from)} paid ${name(to)}`);
          onDone();
        });
      }}
    >
      <DialogHeader>
        <DialogTitle>Record a payment</DialogTitle>
        <DialogDescription>
          Use this when someone pays someone else back, in cash or by UPI.
        </DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="settle-from">Paid by</Label>
          <Select value={from} onValueChange={setFrom}>
            <SelectTrigger id="settle-from" className="w-full">
              <SelectValue />
            </SelectTrigger>
            {people}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="settle-to">Paid to</Label>
          <Select value={to} onValueChange={setTo}>
            <SelectTrigger id="settle-to" className="w-full">
              <SelectValue placeholder="Choose" />
            </SelectTrigger>
            {people}
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="settle-amount">Amount</Label>
        <Input
          id="settle-amount"
          inputMode="decimal"
          placeholder="₹0"
          autoFocus
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
        />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!valid}>
          Record payment
        </Button>
      </DialogFooter>
    </form>
  );
}

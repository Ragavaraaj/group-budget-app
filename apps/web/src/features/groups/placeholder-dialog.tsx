import { DISPLAY_NAME_MAX } from '@budget/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { useEngine } from '@/auth/sync-context';
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
import type { LocalMember } from '@/db/types';
import { apiCall } from '@/lib/api';
import { explainGroupError } from './group-dialogs';

interface PlaceholderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
  /** Present when renaming; absent when adding. */
  existing?: LocalMember;
}

/** Add someone by name who doesn't use the app, or correct the name of one already added. */
export function PlaceholderDialog({ open, onOpenChange, ...rest }: PlaceholderDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? <PlaceholderForm {...rest} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function PlaceholderForm({
  groupId,
  existing,
  onDone,
}: Omit<PlaceholderDialogProps, 'open' | 'onOpenChange'> & { onDone: () => void }) {
  const engine = useEngine();
  const [name, setName] = useState(existing?.displayName ?? '');
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!trimmed || busy) return;
        setBusy(true);
        const request = existing
          ? apiCall('PATCH', `/api/groups/${groupId}/placeholders/${existing.userId}`, {
              name: trimmed,
            })
          : apiCall('POST', `/api/groups/${groupId}/placeholders`, { name: trimmed });
        request
          .then(() => {
            toast.success(existing ? 'Name changed' : `${trimmed} was added`);
            void engine.trigger();
            onDone();
          })
          .catch((error) => toast.error(explainGroupError(error)))
          .finally(() => setBusy(false));
      }}
    >
      <DialogHeader>
        <DialogTitle>{existing ? 'Change name' : 'Add someone without the app'}</DialogTitle>
        <DialogDescription>
          {existing
            ? 'Everyone in the group sees the new name.'
            : 'For a friend or relative who isn’t on Group Budget. They can be part of splits and balances, but only members can record what they paid or owe.'}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="placeholder-name">Name</Label>
        <Input
          id="placeholder-name"
          autoFocus
          maxLength={DISPLAY_NAME_MAX}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!trimmed || busy}>
          {existing ? 'Save' : 'Add'}
        </Button>
      </DialogFooter>
    </form>
  );
}

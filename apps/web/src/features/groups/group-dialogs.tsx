import { GROUP_NAME_MAX, groupResponseSchema, uuidv7 } from '@budget/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router';
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
import { ApiError, apiCall, apiSend, NetworkError } from '@/lib/api';

const ERRORS: Record<string, string> = {
  too_many_groups: 'You’re in the maximum number of groups.',
  forbidden: 'Only the group owner can do that.',
};

function explain(error: unknown): string {
  if (error instanceof NetworkError) return 'You’re offline. This needs a connection.';
  if (error instanceof ApiError)
    return ERRORS[error.code ?? ''] ?? 'Something went wrong. Please try again.';
  return 'Something went wrong. Please try again.';
}

interface NameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Creating a group needs the server's say-so, so it only works online. */
export function NewGroupDialog({ open, onOpenChange }: NameDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? <NewGroupForm onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function NewGroupForm({ onDone }: { onDone: () => void }) {
  const engine = useEngine();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        setBusy(true);
        setError(null);
        apiSend('POST', '/api/groups', { id: uuidv7(), name: name.trim() }, groupResponseSchema)
          .then(async ({ groupId }) => {
            await engine.trigger(); // bring the new group onto this device before opening it
            onDone();
            navigate(`/groups/${groupId}`);
          })
          .catch((e) => {
            setError(explain(e));
            setBusy(false);
          });
      }}
    >
      <DialogHeader>
        <DialogTitle>New group</DialogTitle>
        <DialogDescription>
          For a trip, a flat, a family: anyone you invite can add expenses.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="group-name">Group name</Label>
        <Input
          id="group-name"
          autoFocus
          maxLength={GROUP_NAME_MAX}
          placeholder="Goa trip"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !name.trim()}>
          Create group
        </Button>
      </DialogFooter>
    </form>
  );
}

export function RenameGroupDialog({
  open,
  onOpenChange,
  groupId,
  currentName,
}: NameDialogProps & { groupId: string; currentName: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? (
          <RenameForm
            groupId={groupId}
            currentName={currentName}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RenameForm({
  groupId,
  currentName,
  onDone,
}: {
  groupId: string;
  currentName: string;
  onDone: () => void;
}) {
  const engine = useEngine();
  const [name, setName] = useState(currentName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        setBusy(true);
        apiCall('PATCH', `/api/groups/${groupId}`, { name: name.trim() })
          .then(async () => {
            await engine.trigger();
            toast.success('Group renamed');
            onDone();
          })
          .catch((e) => {
            setError(explain(e));
            setBusy(false);
          });
      }}
    >
      <DialogHeader>
        <DialogTitle>Rename group</DialogTitle>
        <DialogDescription>Everyone in the group sees the new name.</DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="rename-group">Group name</Label>
        <Input
          id="rename-group"
          autoFocus
          maxLength={GROUP_NAME_MAX}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !name.trim()}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

export { explain as explainGroupError };

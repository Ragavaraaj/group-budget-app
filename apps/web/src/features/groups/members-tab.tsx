import {
  Crown,
  LinkIcon,
  LogOut,
  Pencil,
  Trash2,
  UserCheck,
  UserMinus,
  UserPlus,
  UserRoundPlus,
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useDb, useEngine, useMe } from '@/auth/sync-context';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { LocalMember } from '@/db/types';
import { apiCall } from '@/lib/api';
import { initials } from '@/lib/format';
import { orderMembers } from './derive';
import { explainGroupError } from './group-dialogs';
import { InviteDialog } from './invite-dialog';
import { OpenLinks } from './open-links';
import { PlaceholderDialog } from './placeholder-dialog';

interface MembersTabProps {
  groupId: string;
  groupName: string;
  members: LocalMember[];
  isOwner: boolean;
}

type Pending = { kind: 'remove' | 'leave' | 'transfer'; member: LocalMember } | null;

/** Who is in the group; the owner can invite and remove, anyone else can leave. */
export function MembersTab({ groupId, groupName, members, isOwner }: MembersTabProps) {
  const { user } = useMe();
  const db = useDb();
  const engine = useEngine();
  const navigate = useNavigate();
  const [inviting, setInviting] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [linksVersion, setLinksVersion] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [placeholder, setPlaceholder] = useState<LocalMember | 'new' | null>(null);

  const ordered = orderMembers(members, user.id);
  const active = ordered.filter((m) => m.removedAt === null);
  const former = ordered.filter((m) => m.removedAt !== null);

  const confirm = async () => {
    if (!pending) return;
    const { kind, member } = pending;
    setPending(null);
    try {
      if (kind === 'transfer') {
        await apiCall('POST', `/api/groups/${groupId}/transfer`, { userId: member.userId });
        toast.success(`${member.displayName} is now the owner`);
        void engine.trigger();
        return;
      }
      if (kind === 'leave') {
        // Leaving deletes this group's data from the device, along with anything not yet sent.
        // Send what is waiting first, and don't leave while some of it can't be sent.
        await engine.trigger();
        const waiting = await db.outbox.filter((entry) => entry.groupId === groupId).count();
        if (waiting > 0) {
          toast.error(
            `${waiting} change${waiting === 1 ? '' : 's'} in this group ${waiting === 1 ? 'hasn’t' : 'haven’t'} been sent yet. Connect to the internet, wait for “Synced”, then leave.`,
          );
          return;
        }
      }
      await apiCall('DELETE', `/api/groups/${groupId}/members/${member.userId}`);
      if (kind === 'leave') {
        toast.success(`You left “${groupName}”`);
        navigate('/groups', { replace: true });
      } else {
        toast.success(`${member.displayName} was removed`);
      }
      void engine.trigger();
    } catch (error) {
      toast.error(explainGroupError(error));
    }
  };

  const revokeLinks = async () => {
    try {
      await apiCall('DELETE', `/api/groups/${groupId}/invites`);
      setLinksVersion((n) => n + 1);
      toast.success('Invite links stopped. Make a new one whenever you need it.');
    } catch (error) {
      toast.error(explainGroupError(error));
    }
  };

  const addBack = async (member: LocalMember) => {
    try {
      await apiCall('POST', `/api/groups/${groupId}/members/${member.userId}/reinstate`);
      toast.success(`${member.displayName} is back in the group`);
      void engine.trigger();
    } catch (error) {
      toast.error(explainGroupError(error));
    }
  };

  return (
    <div className="space-y-4">
      {isOwner ? (
        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => setInviting(true)}>
            <UserPlus /> Invite people
          </Button>
          <Button variant="outline" onClick={() => void revokeLinks()}>
            <LinkIcon /> Stop all links
          </Button>
        </div>
      ) : null}

      {isOwner ? (
        <Button variant="outline" className="w-full" onClick={() => setPlaceholder('new')}>
          <UserRoundPlus /> Add someone without the app
        </Button>
      ) : null}

      {isOwner ? <OpenLinks groupId={groupId} refreshKey={linksVersion} /> : null}

      <ul className="divide-y rounded-lg border" data-testid="members-list">
        {active.map((member) => (
          <li key={member.userId} className="flex items-center gap-3 p-3">
            <Avatar>
              {member.avatarUrl ? (
                <AvatarImage src={member.avatarUrl} alt="" referrerPolicy="no-referrer" />
              ) : null}
              <AvatarFallback>{initials(member.displayName)}</AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1 truncate font-medium">
              {member.displayName}
              {member.userId === user.id ? (
                <span className="text-muted-foreground font-normal"> (you)</span>
              ) : null}
            </span>
            {member.role === 'owner' ? (
              <Badge variant="secondary">
                <Crown /> Owner
              </Badge>
            ) : null}
            {member.isPlaceholder ? <Badge variant="outline">No app</Badge> : null}
            {isOwner && member.isPlaceholder ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Change ${member.displayName}’s name`}
                onClick={() => setPlaceholder(member)}
              >
                <Pencil />
              </Button>
            ) : null}
            {isOwner && member.userId !== user.id ? (
              <>
                {member.isPlaceholder ? null : (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Make ${member.displayName} the owner`}
                    onClick={() => setPending({ kind: 'transfer', member })}
                  >
                    <Crown />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${member.displayName}`}
                  onClick={() => setPending({ kind: 'remove', member })}
                >
                  <UserMinus />
                </Button>
              </>
            ) : null}
          </li>
        ))}
      </ul>

      {former.length > 0 ? (
        <div className="space-y-2">
          <p className="text-muted-foreground text-sm">
            No longer in the group. Their past expenses stay in the balances.
          </p>
          <ul className="divide-y rounded-lg border">
            {former.map((member) => (
              <li key={member.userId} className="flex items-center gap-3 p-3 text-sm">
                <span className="min-w-0 flex-1 truncate">{member.displayName}</span>
                {isOwner ? (
                  <Button variant="outline" size="sm" onClick={() => void addBack(member)}>
                    <UserCheck /> Add back
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!isOwner ? (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => {
            const me = members.find((m) => m.userId === user.id);
            if (me) setPending({ kind: 'leave', member: me });
          }}
        >
          <LogOut /> Leave group
        </Button>
      ) : (
        <div className="space-y-2 border-t pt-4">
          <p className="text-muted-foreground text-xs">
            The owner can’t leave. Make someone else the owner (the crown beside their name), or
            delete the group.
          </p>
          <Button
            variant="outline"
            className="text-destructive w-full"
            onClick={() => setDeleting(true)}
          >
            <Trash2 /> Delete group
          </Button>
        </div>
      )}

      <InviteDialog
        open={inviting}
        onOpenChange={(open) => {
          setInviting(open);
          if (!open) setLinksVersion((n) => n + 1);
        }}
        groupId={groupId}
        groupName={groupName}
      />

      <PlaceholderDialog
        open={placeholder !== null}
        onOpenChange={(open) => !open && setPlaceholder(null)}
        groupId={groupId}
        existing={placeholder && placeholder !== 'new' ? placeholder : undefined}
      />

      <DeleteGroupDialog
        open={deleting}
        onOpenChange={setDeleting}
        groupId={groupId}
        groupName={groupName}
        onDeleted={() => {
          // This device drops the group when the sync brings the removal.
          void engine.trigger();
          navigate('/groups', { replace: true });
        }}
      />

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.kind === 'leave'
                ? `Leave “${groupName}”?`
                : pending?.kind === 'transfer'
                  ? `Make ${pending.member.displayName} the owner?`
                  : `Remove ${pending?.member.displayName}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === 'leave'
                ? 'Anything not yet sent is sent first. Then the group’s data is removed from this device; expenses you were part of stay in the group’s balances.'
                : pending?.kind === 'transfer'
                  ? 'They will be able to rename the group, invite and remove people, and delete it. You stay in the group as an ordinary member, and can leave afterwards.'
                  : 'They will no longer see or add expenses. Expenses they were part of stay in the balances.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={pending?.kind === 'transfer' ? 'default' : 'destructive'}
              onClick={() => void confirm()}
            >
              {pending?.kind === 'leave'
                ? 'Leave'
                : pending?.kind === 'transfer'
                  ? 'Make owner'
                  : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Deleting needs the group's name typed in, since it can't be undone and affects everyone. */
function DeleteGroupDialog({
  open,
  onOpenChange,
  groupId,
  groupName,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
  groupName: string;
  onDeleted: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const matches = typed.trim() === groupName.trim();

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setTyped('');
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{groupName}”?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes every member and permanently erases all of the group’s expenses, payments,
            categories and budgets, for everyone. It can’t be undone. Anything a member hasn’t sent
            yet is lost.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="confirm-delete">Type the group’s name to confirm</Label>
          <Input
            id="confirm-delete"
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={!matches || busy}
            onClick={(event) => {
              event.preventDefault();
              setBusy(true);
              apiCall('DELETE', `/api/groups/${groupId}`)
                .then(() => {
                  toast.success(`“${groupName}” was deleted`);
                  onOpenChange(false);
                  onDeleted();
                })
                .catch((error) => toast.error(explainGroupError(error)))
                .finally(() => setBusy(false));
            }}
          >
            Delete group
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

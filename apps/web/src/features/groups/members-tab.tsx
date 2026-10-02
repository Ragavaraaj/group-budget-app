import { Crown, LogOut, UserMinus, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useEngine, useMe } from '@/auth/sync-context';
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
import type { LocalMember } from '@/db/types';
import { apiCall } from '@/lib/api';
import { initials } from '@/lib/format';
import { orderMembers } from './derive';
import { explainGroupError } from './group-dialogs';
import { InviteDialog } from './invite-dialog';

interface MembersTabProps {
  groupId: string;
  groupName: string;
  members: LocalMember[];
  isOwner: boolean;
}

type Pending = { member: LocalMember; leaving: boolean } | null;

/** Who is in the group; the owner can invite and remove, anyone else can leave. */
export function MembersTab({ groupId, groupName, members, isOwner }: MembersTabProps) {
  const { user } = useMe();
  const engine = useEngine();
  const navigate = useNavigate();
  const [inviting, setInviting] = useState(false);
  const [pending, setPending] = useState<Pending>(null);

  const ordered = orderMembers(members, user.id);
  const active = ordered.filter((m) => m.removedAt === null);
  const former = ordered.filter((m) => m.removedAt !== null);

  const confirmRemove = async () => {
    if (!pending) return;
    const { member, leaving } = pending;
    setPending(null);
    try {
      await apiCall('DELETE', `/api/groups/${groupId}/members/${member.userId}`);
      if (leaving) {
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

  return (
    <div className="space-y-4">
      {isOwner ? (
        <Button className="w-full" onClick={() => setInviting(true)}>
          <UserPlus /> Invite people
        </Button>
      ) : null}

      <ul className="divide-y rounded-lg border">
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
            {isOwner && member.userId !== user.id ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${member.displayName}`}
                onClick={() => setPending({ member, leaving: false })}
              >
                <UserMinus />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      {former.length > 0 ? (
        <p className="text-muted-foreground text-sm">
          Left the group: {former.map((m) => m.displayName).join(', ')}. Their past expenses stay in
          the balances.
        </p>
      ) : null}

      {!isOwner ? (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => {
            const me = members.find((m) => m.userId === user.id);
            if (me) setPending({ member: me, leaving: true });
          }}
        >
          <LogOut /> Leave group
        </Button>
      ) : null}

      <InviteDialog
        open={inviting}
        onOpenChange={setInviting}
        groupId={groupId}
        groupName={groupName}
      />

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.leaving
                ? `Leave “${groupName}”?`
                : `Remove ${pending?.member.displayName}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.leaving
                ? 'The group’s data is removed from this device. Expenses you were part of stay in the group’s balances.'
                : 'They will no longer see or add expenses. Expenses they were part of stay in the balances.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmRemove()}>
              {pending?.leaving ? 'Leave' : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

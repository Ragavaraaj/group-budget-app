import {
  type CreateInviteResponse,
  createInviteResponseSchema,
  INVITE_MAX_USES,
} from '@budget/shared';
import { Copy, Share2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Spinner } from '@/components/spinner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { apiSend } from '@/lib/api';
import { explainGroupError } from './group-dialogs';

interface InviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
  groupName: string;
}

/** Makes a one-week invite link. The link is shown once; the server keeps only a hash of it. */
export function InviteDialog({ open, onOpenChange, groupId, groupName }: InviteDialogProps) {
  const [invite, setInvite] = useState<CreateInviteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setInvite(null);
      setError(null);
      return;
    }
    let cancelled = false;
    apiSend('POST', `/api/groups/${groupId}/invites`, {}, createInviteResponseSchema)
      .then((created) => !cancelled && setInvite(created))
      .catch((e) => !cancelled && setError(explainGroupError(e)));
    return () => {
      cancelled = true;
    };
  }, [open, groupId]);

  const link = invite ? `${window.location.origin}/join/${invite.token}` : '';
  const canShare = typeof navigator.share === 'function';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite to {groupName}</DialogTitle>
          <DialogDescription>
            Send this link to the people you want in the group. It works for a week, for up to{' '}
            {INVITE_MAX_USES} people.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : !invite ? (
          <Spinner className="mx-auto" />
        ) : (
          <div className="space-y-3">
            <Input
              readOnly
              aria-label="Invite link"
              value={link}
              onFocus={(e) => e.currentTarget.select()}
            />
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link);
                    toast.success('Link copied');
                  } catch {
                    toast.error('Couldn’t copy. Select the link and copy it by hand.');
                  }
                }}
              >
                <Copy /> Copy link
              </Button>
              {canShare ? (
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() =>
                    void navigator
                      .share({
                        title: `Join ${groupName}`,
                        text: `Join “${groupName}” on Group Budget`,
                        url: link,
                      })
                      .catch(() => undefined)
                  }
                >
                  <Share2 /> Share
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

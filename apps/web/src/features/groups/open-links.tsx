import { type ListInvitesResponse, listInvitesResponseSchema } from '@budget/shared';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { apiCall, apiGet } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { explainGroupError } from './group-dialogs';

const DAY = 24 * 60 * 60 * 1000;

const expiresIn = (expiresAt: number, now: number) => {
  const days = Math.ceil((expiresAt - now) / DAY);
  return days <= 1 ? 'expires today' : `expires in ${days} days`;
};

/**
 * The invite links that can still be used, each with a "Stop" button. The links themselves can't
 * be shown again (only a fingerprint of each is kept), so this lists when it was made and how
 * much it has been used, which is enough to tell them apart.
 */
export function OpenLinks({ groupId, refreshKey }: { groupId: string; refreshKey: number }) {
  const [links, setLinks] = useState<ListInvitesResponse['invites'] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await apiGet(`/api/groups/${groupId}/invites`, listInvitesResponseSchema);
      setLinks(response.invites);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [groupId]);

  // `refreshKey` changes when a link has just been made, so the list picks it up.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is the trigger
  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const stop = async (id: string) => {
    try {
      await apiCall('DELETE', `/api/groups/${groupId}/invites/${id}`);
      toast.success('That link has been stopped.');
      await load();
    } catch (error) {
      toast.error(explainGroupError(error));
    }
  };

  // Offline, or the owner has nothing open: nothing worth showing.
  if (failed || links === null || links.length === 0) return null;
  const now = Date.now();

  return (
    <div className="space-y-2" data-testid="open-links">
      <p className="text-muted-foreground text-sm">
        Open invite links ({links.length}). Anyone with a link can join until it’s stopped or runs
        out.
      </p>
      <ul className="divide-y rounded-lg border">
        {links.map((link) => (
          <li key={link.id} className="flex items-center gap-3 p-3 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block font-medium">Made {formatRelative(link.createdAt, now)}</span>
              <span className="text-muted-foreground block text-xs">
                Used {link.usedCount} of {link.maxUses} · {expiresIn(link.expiresAt, now)}
              </span>
            </span>
            <Button
              variant="outline"
              size="sm"
              aria-label={`Stop the link made ${formatRelative(link.createdAt, now)}`}
              onClick={() => void stop(link.id)}
            >
              Stop
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin', className)} aria-hidden="true" />;
}

/** Full-screen placeholder shown while the app works out who is signed in. */
export function SplashScreen() {
  return (
    <div className="grid min-h-dvh place-items-center" role="status" aria-label="Loading">
      <Spinner className="text-muted-foreground size-6" />
    </div>
  );
}

import { toast } from 'sonner';

/**
 * Runs a write to the local database and, if the browser refuses it (storage full on a phone, a
 * database that was closed or blocked), says so instead of leaving the screen stuck. Returns
 * whether it worked, so callers can stay on the form and let the person try again.
 */
export async function tryLocal(action: () => Promise<unknown>): Promise<boolean> {
  try {
    await action();
    return true;
  } catch {
    toast.error('Couldn’t save this on your device. Free up some storage and try again.');
    return false;
  }
}

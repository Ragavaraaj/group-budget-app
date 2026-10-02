import { PageHeader } from '@/components/page-header';
import { ServerStatusCard } from '@/features/status/server-status-card';
import { InstallCard } from './install-card';

export function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />
      <InstallCard />
      <ServerStatusCard />
    </div>
  );
}

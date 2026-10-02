import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';

export function GroupsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Groups" description="Split expenses with friends and family." />
      <Card>
        <CardContent className="space-y-1 text-center">
          <p className="font-medium">No groups yet</p>
          <p className="text-muted-foreground text-sm">Groups and settle-up are planned for M2.</p>
        </CardContent>
      </Card>
    </div>
  );
}

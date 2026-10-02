import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';

export function HomePage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Expenses" />
      <Card>
        <CardContent className="space-y-1 text-center">
          <p className="font-medium">No expenses yet</p>
          <p className="text-muted-foreground text-sm">
            Adding and syncing expenses arrives in the next milestone.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

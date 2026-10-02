import { Link } from 'react-router';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Page not found" description="That address doesn't exist in this app." />
      <Button asChild>
        <Link to="/">Back to expenses</Link>
      </Button>
    </div>
  );
}

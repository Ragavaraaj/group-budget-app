import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { AuthProvider } from '@/auth/auth-context';
import { RequireAuth } from '@/components/app-shell';
import { NotFoundPage } from '@/components/not-found-page';
import { Skeleton } from '@/components/ui/skeleton';
import { Toaster } from '@/components/ui/sonner';
import { JoinPage } from '@/features/auth/join-page';
import { LoginPage } from '@/features/auth/login-page';
import { BudgetsPage } from '@/features/budgets/budgets-page';
import { CategoriesPage } from '@/features/categories/categories-page';
import { ExpenseFormPage } from '@/features/expenses/expense-form-page';
import { HomePage } from '@/features/expenses/home-page';
import { GroupPage } from '@/features/groups/group-page';
import { GroupsPage } from '@/features/groups/groups-page';
import { ImportPage } from '@/features/import/import-page';
import { RecurringFormPage } from '@/features/recurring/recurring-form-page';
import { RecurringPage } from '@/features/recurring/recurring-page';
import { SearchPage } from '@/features/search/search-page';
import { SettingsPage } from '@/features/settings/settings-page';

// The charts are only needed on this screen, so they load when it is first opened (the service
// worker precaches the chunk, so it still works offline).
const InsightsPage = lazy(() =>
  import('@/features/insights/insights-page').then((m) => ({ default: m.InsightsPage })),
);

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="login" element={<LoginPage />} />
          <Route path="join/:token" element={<JoinPage />} />
          <Route element={<RequireAuth />}>
            <Route index element={<HomePage />} />
            <Route path="add" element={<ExpenseFormPage />} />
            <Route path="expenses/:id/edit" element={<ExpenseFormPage />} />
            <Route
              path="insights"
              element={
                <Suspense fallback={<Skeleton className="h-48" />}>
                  <InsightsPage />
                </Suspense>
              }
            />
            <Route path="search" element={<SearchPage />} />
            <Route path="budgets" element={<BudgetsPage />} />
            <Route path="groups" element={<GroupsPage />} />
            <Route path="groups/:id" element={<GroupPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="settings/categories" element={<CategoriesPage />} />
            <Route path="settings/import" element={<ImportPage />} />
            <Route path="settings/recurring" element={<RecurringPage />} />
            <Route path="settings/recurring/new" element={<RecurringFormPage />} />
            <Route path="settings/recurring/:id" element={<RecurringFormPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
        <Toaster position="top-center" />
      </BrowserRouter>
    </AuthProvider>
  );
}

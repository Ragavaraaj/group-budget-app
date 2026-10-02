import { BrowserRouter, Route, Routes } from 'react-router';
import { AppShell } from '@/components/app-shell';
import { NotFoundPage } from '@/components/not-found-page';
import { Toaster } from '@/components/ui/sonner';
import { HomePage } from '@/features/expenses/home-page';
import { GroupsPage } from '@/features/groups/groups-page';
import { SettingsPage } from '@/features/settings/settings-page';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="groups" element={<GroupsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
      <Toaster position="top-center" />
    </BrowserRouter>
  );
}

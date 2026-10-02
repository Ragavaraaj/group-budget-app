import { BrowserRouter, Route, Routes } from 'react-router';
import { AuthProvider } from '@/auth/auth-context';
import { RequireAuth } from '@/components/app-shell';
import { NotFoundPage } from '@/components/not-found-page';
import { Toaster } from '@/components/ui/sonner';
import { JoinPage } from '@/features/auth/join-page';
import { LoginPage } from '@/features/auth/login-page';
import { HomePage } from '@/features/expenses/home-page';
import { GroupsPage } from '@/features/groups/groups-page';
import { SettingsPage } from '@/features/settings/settings-page';

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="login" element={<LoginPage />} />
          <Route path="join/:token" element={<JoinPage />} />
          <Route element={<RequireAuth />}>
            <Route index element={<HomePage />} />
            <Route path="groups" element={<GroupsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
        <Toaster position="top-center" />
      </BrowserRouter>
    </AuthProvider>
  );
}

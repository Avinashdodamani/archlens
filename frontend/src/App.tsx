import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { getCurrentUser, fetchUserAttributes } from 'aws-amplify/auth';
import { Toaster } from 'react-hot-toast';
import { useAppStore } from './store/useAppStore';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import YourArchPage from './pages/YourArchPage';
import RedefineArchPage from './pages/RedefineArchPage';
import AutoRemediatePage from './pages/AutoRemediatePage';
import InsightHubPage from './pages/InsightHubPage';
import CallbackPage from './pages/CallbackPage';

function App() {
  const { isAuthenticated, setAuth, syncScansFromBackend, reset, darkMode } = useAppStore();

  useEffect(() => {
    checkAuthStatus();
  }, []);

  // Keep the <html> dark class in sync with the store on every change.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  async function checkAuthStatus() {
    try {
      const authUser = await getCurrentUser();
      const email = authUser.signInDetails?.loginId || '';
      let name = '';
      try {
        const attributes = await fetchUserAttributes();
        name = attributes.name || '';
      } catch {
        name = '';
      }

      // Ensure store is pristine and contains no residual data from any other account
      const storedUser = useAppStore.getState().user;
      if (!storedUser?.email || (email && storedUser.email.toLowerCase() !== email.toLowerCase())) {
        reset();
        localStorage.removeItem('archlens-storage');
      }

      setAuth(true, {
        email,
        name: name || email.split('@')[0],
      });

      // Synchronize scans only for the active user's connected accounts
      await syncScansFromBackend();
    } catch {
      setAuth(false, null);
    }
  }

  if (!isAuthenticated) {
    return (
      <>
        <Toaster position="top-right" toastOptions={{ className: 'bg-dark-800 text-white' }} />
        <Routes>
          <Route path="/callback" element={<CallbackPage />} />
          <Route path="*" element={<LoginPage />} />
        </Routes>
      </>
    );
  }

  return (
    <>
      <Toaster position="top-right" toastOptions={{ className: 'bg-dark-800 text-white' }} />
      <Layout>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/your-arch" element={<YourArchPage />} />
          <Route path="/redefine" element={<RedefineArchPage />} />
          <Route path="/auto-remediate" element={<AutoRemediatePage />} />
          <Route path="/insights" element={<InsightHubPage />} />
          <Route path="/callback" element={<CallbackPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </>
  );
}

export default App;

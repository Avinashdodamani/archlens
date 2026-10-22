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
  const { isAuthenticated, setAuth, syncScansFromBackend, darkMode } = useAppStore();

  useEffect(() => {
    checkAuthStatus();
    syncScansFromBackend();
  }, []);

  // Keep the <html> dark class in sync with the store on every change.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  async function checkAuthStatus() {
    try {
      const user = await getCurrentUser();
      const email = user.signInDetails?.loginId || '';
      let name = '';
      try {
        const attributes = await fetchUserAttributes();
        name = attributes.name || '';
      } catch {
        name = '';
      }
      setAuth(true, {
        email,
        name: name || email.split('@')[0],
      });
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

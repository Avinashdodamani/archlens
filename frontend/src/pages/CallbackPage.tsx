import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentUser } from 'aws-amplify/auth';
import { useAppStore } from '../store/useAppStore';

/**
 * OAuth callback page — handles redirect after Cognito hosted UI login.
 */
export default function CallbackPage() {
  const navigate = useNavigate();
  const { setAuth } = useAppStore();

  useEffect(() => {
    handleCallback();
  }, []);

  async function handleCallback() {
    try {
      const user = await getCurrentUser();
      setAuth(true, {
        email: user.signInDetails?.loginId || '',
        name: user.username || '',
      });
      navigate('/', { replace: true });
    } catch {
      navigate('/', { replace: true });
    }
  }

  return (
    <div className="min-h-screen bg-dark-950 flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-400">Completing sign-in...</p>
      </div>
    </div>
  );
}

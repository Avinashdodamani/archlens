import { useState } from 'react';
import { signIn, signUp, confirmSignUp, fetchUserAttributes, resetPassword, confirmResetPassword } from 'aws-amplify/auth';
import { useAppStore } from '../store/useAppStore';
import toast from 'react-hot-toast';
import {
  ShieldCheckIcon, EyeIcon, EyeSlashIcon, UserIcon, LockClosedIcon,
  SunIcon, MoonIcon,
} from '@heroicons/react/24/outline';

type AuthMode = 'login' | 'signup' | 'confirm' | 'forgot' | 'reset';

export default function LoginPage() {
  const { setAuth, darkMode, toggleDarkMode } = useAppStore();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [confirmCode, setConfirmCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      let result;
      try {
        result = await signIn({
          username: email,
          password,
          options: { authFlowType: 'USER_PASSWORD_AUTH' },
        });
      } catch (err: unknown) {
        // Fallback to default SRP auth if USER_PASSWORD_AUTH is not permitted
        result = await signIn({ username: email, password });
      }
      if (result.isSignedIn) {
        let displayName = email.split('@')[0];
        try {
          const attributes = await fetchUserAttributes();
          if (attributes.name) displayName = attributes.name;
        } catch {
          // fall back to email prefix
        }
        setAuth(true, { email, name: displayName });
        toast.success('Welcome to ArchLens!');
      }
    } catch (error: unknown) {
      const err = error as { message?: string };
      toast.error(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await signUp({
        username: email,
        password,
        options: { userAttributes: { email, name } },
      });
      toast.success('Account created! Check your email for verification code.');
      setMode('confirm');
    } catch (error: unknown) {
      const err = error as { message?: string };
      toast.error(err.message || 'Sign up failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await confirmSignUp({ username: email, confirmationCode: confirmCode });
      toast.success('Email verified! You can now sign in.');
      setMode('login');
    } catch (error: unknown) {
      const err = error as { message?: string };
      toast.error(err.message || 'Verification failed');
    } finally {
      setLoading(false);
    }
  }

  // Forgot password — send reset code to the registered email.
  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await resetPassword({ username: email });
      toast.success('A password reset code has been sent to your email.');
      setMode('reset');
    } catch (error: unknown) {
      const err = error as { message?: string };
      toast.error(err.message || 'Could not start password reset');
    } finally {
      setLoading(false);
    }
  }

  // Reset password — confirm the code and set a new password.
  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await confirmResetPassword({ username: email, confirmationCode: confirmCode, newPassword: password });
      toast.success('Password changed. You can now sign in with your new password.');
      setPassword('');
      setConfirmCode('');
      setMode('login');
    } catch (error: unknown) {
      const err = error as { message?: string };
      toast.error(err.message || 'Password reset failed');
    } finally {
      setLoading(false);
    }
  }

  const titleMap: Record<AuthMode, string> = {
    login: 'Welcome Back',
    signup: 'Create Account',
    confirm: 'Verify Email',
    forgot: 'Reset Password',
    reset: 'Set New Password',
  };
  const subtitleMap: Record<AuthMode, string> = {
    login: 'Sign in to your account',
    signup: 'Start optimizing your AWS architecture',
    confirm: 'Enter the 6-digit code sent to your email',
    forgot: 'Enter your email and we will send a reset code',
    reset: 'Enter the code from your email and a new password',
  };

  // The login screen is always light (matches CloudThat / Security360), independent
  // of the app's dark-mode preference which only applies to the authenticated app.
  const page = 'bg-[#fafafd]';
  const cardCls = 'rounded-2xl p-8 shadow-card border bg-white border-dark-200';
  const labelCls = 'block text-sm font-medium mb-1.5 text-dark-700';
  const fieldWrap =
    'relative flex items-center rounded-lg border bg-white border-dark-300 transition-colors focus-within:border-primary-500 focus-within:ring-2 focus-within:ring-primary-500/30';
  const inputCls = 'w-full bg-transparent py-2.5 pr-3 text-sm outline-none text-dark-800 placeholder-dark-400';
  const iconCls = 'w-4 h-4 mx-3 flex-shrink-0 text-dark-400';
  const submitCls =
    'w-full py-3 bg-primary-700 hover:bg-primary-800 text-white font-semibold rounded-lg transition-colors duration-200 disabled:opacity-50';

  const Spinner = ({ label }: { label: string }) => (
    <span className="flex items-center justify-center gap-2">
      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
      {label}
    </span>
  );

  return (
    <div className={`min-h-screen flex flex-col ${page}`}>
      {/* Top bar */}
      <header className="h-16 flex items-center justify-between px-6 border-b bg-white border-dark-200">
        <img src="/cloudthat-logo-removebg-preview.png" alt="CloudThat" className="h-9 object-contain" />
        <button
          onClick={toggleDarkMode}
          className="w-9 h-9 flex items-center justify-center rounded-full border border-dark-200 text-primary-700 hover:bg-primary-50 transition-colors"
          title={darkMode ? 'Light mode' : 'Dark mode'}
        >
          {darkMode ? <SunIcon className="w-4 h-4" /> : <MoonIcon className="w-4 h-4" />}
        </button>
      </header>

      {/* Centered card */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className={cardCls}>
            <h2 className="text-2xl font-bold text-primary-700 text-center">{titleMap[mode]}</h2>
            <p className="text-sm text-center mt-1.5 mb-7 text-dark-500">{subtitleMap[mode]}</p>

            {/* Login */}
            {mode === 'login' && (
              <form onSubmit={handleLogin} className="space-y-5">
                <div>
                  <label className={labelCls}><span className="text-danger">*</span> Username / Email</label>
                  <div className={fieldWrap}>
                    <UserIcon className={iconCls} />
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="Enter your username / email" required />
                  </div>
                </div>
                <div>
                  <label className={labelCls}><span className="text-danger">*</span> Password</label>
                  <div className={fieldWrap}>
                    <LockClosedIcon className={iconCls} />
                    <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} placeholder="Enter your password" required />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="px-3 text-dark-400 hover:text-dark-600 transition-colors">
                      {showPassword ? <EyeSlashIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="text-right mt-2">
                    <button type="button" onClick={() => setMode('forgot')} className="text-xs text-primary-600 hover:text-primary-700 font-semibold">Forgot Password?</button>
                  </div>
                </div>
                <button type="submit" className={submitCls} disabled={loading}>
                  {loading ? <Spinner label="Signing in..." /> : 'Sign In'}
                </button>
              </form>
            )}

            {/* Forgot */}
            {mode === 'forgot' && (
              <form onSubmit={handleForgot} className="space-y-5">
                <div>
                  <label className={labelCls}><span className="text-danger">*</span> Email</label>
                  <div className={fieldWrap}>
                    <UserIcon className={iconCls} />
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="Enter your email" required />
                  </div>
                  <p className="text-xs mt-1.5 text-dark-400">Enter the email you used to sign up. We will send a reset code.</p>
                </div>
                <button type="submit" className={submitCls} disabled={loading}>
                  {loading ? <Spinner label="Sending code..." /> : 'Send reset code'}
                </button>
              </form>
            )}

            {/* Reset */}
            {mode === 'reset' && (
              <form onSubmit={handleReset} className="space-y-5">
                <div>
                  <label className={labelCls}><span className="text-danger">*</span> Reset Code</label>
                  <div className={fieldWrap}>
                    <input type="text" value={confirmCode} onChange={(e) => setConfirmCode(e.target.value)} className={`${inputCls} pl-3 text-center text-xl tracking-[0.3em] font-mono`} placeholder="000000" required maxLength={6} />
                  </div>
                  <p className="text-xs mt-2 text-center text-dark-400">Code sent to <span className="text-primary-600">{email}</span></p>
                </div>
                <div>
                  <label className={labelCls}><span className="text-danger">*</span> New Password</label>
                  <div className={fieldWrap}>
                    <LockClosedIcon className={iconCls} />
                    <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} placeholder="Min 8 characters" required minLength={8} />
                  </div>
                  <p className="text-xs mt-1.5 text-dark-400">Uppercase, lowercase, number and special character required.</p>
                </div>
                <button type="submit" className={submitCls} disabled={loading}>
                  {loading ? <Spinner label="Updating..." /> : 'Change password'}
                </button>
              </form>
            )}

            {/* Signup */}
            {mode === 'signup' && (
              <form onSubmit={handleSignUp} className="space-y-5">
                <div>
                  <label className={labelCls}><span className="text-danger">*</span> Full Name</label>
                  <div className={fieldWrap}>
                    <UserIcon className={iconCls} />
                    <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="John Doe" required />
                  </div>
                </div>
                <div>
                  <label className={labelCls}><span className="text-danger">*</span> Email</label>
                  <div className={fieldWrap}>
                    <UserIcon className={iconCls} />
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="you@company.com" required />
                  </div>
                </div>
                <div>
                  <label className={labelCls}><span className="text-danger">*</span> Password</label>
                  <div className={fieldWrap}>
                    <LockClosedIcon className={iconCls} />
                    <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} placeholder="Min 8 characters" required minLength={8} />
                  </div>
                  <p className="text-xs mt-1.5 text-dark-400">Uppercase, lowercase, number & special character required</p>
                </div>
                <button type="submit" className={submitCls} disabled={loading}>
                  {loading ? <Spinner label="Creating Account..." /> : 'Create Account'}
                </button>
              </form>
            )}

            {/* Confirm */}
            {mode === 'confirm' && (
              <form onSubmit={handleConfirm} className="space-y-5">
                <div>
                  <label className={labelCls}><span className="text-danger">*</span> Verification Code</label>
                  <div className={fieldWrap}>
                    <input type="text" value={confirmCode} onChange={(e) => setConfirmCode(e.target.value)} className={`${inputCls} pl-3 text-center text-xl tracking-[0.3em] font-mono`} placeholder="000000" required maxLength={6} />
                  </div>
                  <p className="text-xs mt-2 text-center text-dark-400">Code sent to <span className="text-primary-600">{email}</span></p>
                </div>
                <button type="submit" className={submitCls} disabled={loading}>
                  {loading ? <Spinner label="Verifying..." /> : 'Verify & Continue'}
                </button>
              </form>
            )}

            {/* Toggle mode */}
            <div className="mt-7 text-center">
              {mode === 'login' ? (
                <p className="text-sm text-dark-500">
                  Don't have an account?{' '}
                  <button onClick={() => setMode('signup')} className="text-primary-600 hover:text-primary-700 font-semibold transition-colors">Sign Up</button>
                </p>
              ) : (
                <p className="text-sm text-dark-500">
                  Remember your password?{' '}
                  <button onClick={() => setMode('login')} className="text-primary-600 hover:text-primary-700 font-semibold transition-colors">Sign in</button>
                </p>
              )}
            </div>
          </div>

          {/* Security note */}
          <div className="mt-5 flex items-center justify-center gap-2 text-xs text-dark-400">
            <ShieldCheckIcon className="w-3.5 h-3.5" />
            <p>Secured by AWS Cognito</p>
          </div>
        </div>
      </div>
    </div>
  );
}

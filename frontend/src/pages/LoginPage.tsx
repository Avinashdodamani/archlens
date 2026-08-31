import { useState } from 'react';
import { signIn, signUp, confirmSignUp, fetchUserAttributes } from 'aws-amplify/auth';
import { useAppStore } from '../store/useAppStore';
import toast from 'react-hot-toast';
import {
  ShieldCheckIcon, EyeIcon, EyeSlashIcon,
  CubeTransparentIcon, SparklesIcon, BoltIcon, LockClosedIcon, ChartBarIcon,
} from '@heroicons/react/24/outline';
import type { ComponentType, SVGProps } from 'react';

type AuthMode = 'login' | 'signup' | 'confirm';

export default function LoginPage() {
  const { setAuth } = useAppStore();
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
      const result = await signIn({ username: email, password });
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

  return (
    <div className="min-h-screen bg-dark-950 relative overflow-hidden flex flex-col lg:flex-row">
      {/* Background effects — spans full page */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary-900/20 via-dark-950 to-blue-900/10" />
      <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-primary-500/8 rounded-full blur-[120px]" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] bg-blue-500/6 rounded-full blur-[100px]" />

      {/* Left Side — Feature Points */}
      <div className="relative z-10 w-full lg:w-1/2 flex items-center justify-center p-8 lg:p-12">
        <div className="max-w-md">
          <h2 className="text-4xl lg:text-5xl font-bold text-white mb-4 tracking-tight leading-[1.1]">
            Cloud intelligence,<br />simplified.
          </h2>
          <p className="text-gray-400 text-base mb-12 leading-relaxed">
            See your architecture, optimize it with AI, and deploy changes safely in one click.
          </p>

          <div className="space-y-6">
            <FeatureItem
              Icon={CubeTransparentIcon}
              title="Architecture discovery"
              description="Discover and visualize your complete AWS architecture with a single scan."
            />
            <FeatureItem
              Icon={SparklesIcon}
              title="AI-powered analysis"
              description="Evaluate your architecture against all six AWS Well-Architected Framework pillars."
            />
            <FeatureItem
              Icon={BoltIcon}
              title="One-click remediation"
              description="Auto-generate CloudFormation and Terraform scripts, then deploy changes safely."
            />
            <FeatureItem
              Icon={LockClosedIcon}
              title="Secure and reliable"
              description="Automatic backups before every change, with instant rollback on failure."
            />
            <FeatureItem
              Icon={ChartBarIcon}
              title="Continuous insights"
              description="Track scan history, architecture health scores, and cost savings over time."
            />
          </div>
        </div>
      </div>

      {/* Right Side — Login Form */}
      <div className="relative z-10 w-full lg:w-1/2 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          {/* Logo & Branding */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-primary-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-2xl shadow-primary-500/30">
              <span className="text-2xl font-bold text-white">AL</span>
            </div>
            <h1 className="text-3xl font-bold text-white tracking-tight">ArchLens</h1>
            <p className="text-sm text-gray-400 mt-1.5">AI-Powered Cloud Intelligence Platform</p>
          </div>

          {/* Auth Card */}
          <div className="bg-dark-800/80 backdrop-blur-xl border border-dark-700/50 rounded-2xl p-8 shadow-2xl">
            <h2 className="text-xl font-bold text-white mb-1">
              {mode === 'login' && 'Welcome Back'}
              {mode === 'signup' && 'Create Account'}
              {mode === 'confirm' && 'Verify Email'}
            </h2>
            <p className="text-gray-400 text-sm mb-7">
              {mode === 'login' && 'Sign in to your cloud intelligence dashboard'}
              {mode === 'signup' && 'Start optimizing your AWS architecture'}
              {mode === 'confirm' && 'Enter the 6-digit code sent to your email'}
            </p>

            {/* Login Form */}
            {mode === 'login' && (
              <form onSubmit={handleLogin} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Email Address</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input-field"
                    placeholder="you@company.com"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="input-field pr-10"
                      placeholder="Enter your password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                    >
                      {showPassword ? <EyeSlashIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
                    </button>
                  </div>
                </div>
                <button
                  type="submit"
                  className="w-full py-3 bg-gradient-to-r from-primary-500 to-blue-600 text-white font-semibold rounded-xl hover:from-primary-600 hover:to-blue-700 transition-all duration-200 shadow-lg shadow-primary-500/20 disabled:opacity-50"
                  disabled={loading}
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Signing in...
                    </span>
                  ) : 'Sign In'}
                </button>
              </form>
            )}

            {/* Signup Form */}
            {mode === 'signup' && (
              <form onSubmit={handleSignUp} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Full Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="input-field"
                    placeholder="John Doe"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Email Address</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input-field"
                    placeholder="you@company.com"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input-field"
                    placeholder="Min 8 characters"
                    required
                    minLength={8}
                  />
                  <p className="text-xs text-gray-500 mt-1.5">Uppercase, lowercase, number & special character required</p>
                </div>
                <button
                  type="submit"
                  className="w-full py-3 bg-gradient-to-r from-primary-500 to-blue-600 text-white font-semibold rounded-xl hover:from-primary-600 hover:to-blue-700 transition-all duration-200 shadow-lg shadow-primary-500/20 disabled:opacity-50"
                  disabled={loading}
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Creating Account...
                    </span>
                  ) : 'Create Account'}
                </button>
              </form>
            )}

            {/* Confirm Form */}
            {mode === 'confirm' && (
              <form onSubmit={handleConfirm} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Verification Code</label>
                  <input
                    type="text"
                    value={confirmCode}
                    onChange={(e) => setConfirmCode(e.target.value)}
                    className="input-field text-center text-2xl tracking-[0.3em] font-mono"
                    placeholder="000000"
                    required
                    maxLength={6}
                  />
                  <p className="text-xs text-gray-500 mt-2 text-center">
                    Code sent to <span className="text-primary-400">{email}</span>
                  </p>
                </div>
                <button
                  type="submit"
                  className="w-full py-3 bg-gradient-to-r from-primary-500 to-blue-600 text-white font-semibold rounded-xl hover:from-primary-600 hover:to-blue-700 transition-all duration-200 shadow-lg shadow-primary-500/20 disabled:opacity-50"
                  disabled={loading}
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Verifying...
                    </span>
                  ) : 'Verify & Continue'}
                </button>
              </form>
            )}

            {/* Toggle Mode */}
            <div className="mt-7 text-center">
              {mode === 'login' && (
                <p className="text-sm text-gray-400">
                  New to ArchLens?{' '}
                  <button onClick={() => setMode('signup')} className="text-primary-400 hover:text-primary-300 font-semibold transition-colors">
                    Create an account
                  </button>
                </p>
              )}
              {(mode === 'signup' || mode === 'confirm') && (
                <p className="text-sm text-gray-400">
                  Already have an account?{' '}
                  <button onClick={() => setMode('login')} className="text-primary-400 hover:text-primary-300 font-semibold transition-colors">
                    Sign in
                  </button>
                </p>
              )}
            </div>
          </div>

          {/* Security Note */}
          <div className="mt-5 flex items-center justify-center gap-2 text-xs text-gray-500">
            <ShieldCheckIcon className="w-3.5 h-3.5 text-gray-500" />
            <p>Secured by AWS Cognito</p>
          </div>
        </div>
      </div>

    </div>
  );
}

function FeatureItem({
  Icon,
  title,
  description,
}: {
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-4">
      <div className="w-11 h-11 bg-primary-500/10 border border-primary-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
        <Icon className="w-5 h-5 text-primary-400" />
      </div>
      <div>
        <p className="text-base font-semibold text-white">{title}</p>
        <p className="text-sm text-gray-400 mt-1 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

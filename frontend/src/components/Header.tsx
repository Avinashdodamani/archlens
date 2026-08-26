import { signOut } from 'aws-amplify/auth';
import { useAppStore } from '../store/useAppStore';
import {
  SunIcon,
  MoonIcon,
  ArrowRightOnRectangleIcon,
} from '@heroicons/react/24/outline';

export default function Header() {
  const { user, darkMode, toggleDarkMode, currentStep, setAuth } = useAppStore();

  async function handleSignOut() {
    try {
      await signOut();
      setAuth(false, null);
    } catch (error) {
      console.error('Sign out error:', error);
    }
  }

  // Apply theme on mount
  if (darkMode) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }

  function getStepLabel(): string {
    const labels: Record<string, string> = {
      idle: '',
      discovering: 'Discovering Resources...',
      discovered: 'Architecture Ready',
      analyzing: 'AI Analyzing...',
      analyzed: 'Recommendations Ready',
      generating_scripts: 'Generating Scripts...',
      scripts_ready: 'Scripts Ready',
      backing_up: 'Taking Backups...',
      backup_complete: 'Backups Complete',
      deploying: 'Deploying...',
      monitoring: 'Monitoring...',
      success: 'Deployment Successful',
      failed: 'Deployment Failed',
      rolling_back: 'Rolling Back...',
    };
    return labels[currentStep] || '';
  }

  function getStepColor(): string {
    if (['discovering', 'analyzing', 'generating_scripts', 'backing_up', 'deploying', 'monitoring', 'rolling_back'].includes(currentStep)) {
      return 'text-yellow-400 bg-yellow-500/10';
    }
    if (['discovered', 'analyzed', 'scripts_ready', 'backup_complete', 'success'].includes(currentStep)) {
      return 'text-green-400 bg-green-500/10';
    }
    if (currentStep === 'failed') return 'text-red-400 bg-red-500/10';
    return '';
  }

  const username = user?.name || user?.email?.split('@')[0] || 'User';
  const initial = (user?.name || user?.email || 'U').charAt(0).toUpperCase();

  return (
    <header className={`h-14 backdrop-blur-md border-b flex items-center justify-between px-6 sticky top-0 z-30 ${
      darkMode ? 'bg-dark-900/80 border-dark-700/50' : 'bg-white/90 border-gray-200'
    }`}>
      {/* Left - Status */}
      <div className="flex items-center gap-3">
        {getStepLabel() && (
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium ${getStepColor()}`}>
            {['discovering', 'analyzing', 'generating_scripts', 'backing_up', 'deploying', 'monitoring', 'rolling_back'].includes(currentStep) && (
              <div className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
            )}
            {['discovered', 'analyzed', 'scripts_ready', 'backup_complete', 'success'].includes(currentStep) && (
              <div className="w-1.5 h-1.5 rounded-full bg-current" />
            )}
            <span>{getStepLabel()}</span>
          </div>
        )}
      </div>

      {/* Right - Actions */}
      <div className="flex items-center gap-2">
        {/* Dark/Light Mode */}
        <button
          onClick={toggleDarkMode}
          className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-dark-800 transition-all duration-200"
          title={darkMode ? 'Light Mode' : 'Dark Mode'}
        >
          {darkMode ? <SunIcon className="w-5 h-5" /> : <MoonIcon className="w-5 h-5" />}
        </button>

        {/* Profile Dropdown */}
        <div className="relative group">
          <button className="flex items-center gap-2.5 pl-2 pr-3 py-1.5 rounded-xl hover:bg-dark-800 transition-all duration-200 border border-transparent hover:border-dark-700">
            <div className="w-8 h-8 bg-gradient-to-br from-primary-500 to-blue-600 rounded-lg flex items-center justify-center text-xs font-bold text-white shadow-md">
              {initial}
            </div>
            <span className="text-sm text-gray-300 font-medium hidden md:block">{username}</span>
          </button>

          {/* Dropdown */}
          <div className="absolute right-0 top-full mt-2 w-64 bg-dark-800 border border-dark-700 rounded-xl shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 overflow-hidden">
            {/* Profile header */}
            <div className="p-4 bg-gradient-to-r from-primary-900/30 to-dark-800 border-b border-dark-700">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 bg-gradient-to-br from-primary-500 to-blue-600 rounded-xl flex items-center justify-center text-sm font-bold text-white shadow-lg">
                  {initial}
                </div>
                <div>
                  <p className="text-sm text-white font-semibold">{username}</p>
                  <p className="text-xs text-gray-400 max-w-[160px] truncate">{user?.email}</p>
                </div>
              </div>
            </div>
            {/* Actions */}
            <div className="p-2">
              <div className="px-3 py-2.5 text-sm text-gray-300 rounded-lg">
                <p className="text-xs text-gray-500 mb-1">Name</p>
                <p className="font-medium">{username}</p>
              </div>
              <div className="px-3 py-2.5 text-sm text-gray-300 rounded-lg">
                <p className="text-xs text-gray-500 mb-1">Email</p>
                <p className="font-medium text-xs">{user?.email || ''}</p>
              </div>
              <div className="border-t border-dark-700 my-1" />
              <button
                onClick={handleSignOut}
                className="w-full text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg px-3 py-2 text-left flex items-center gap-2.5 transition-colors"
              >
                <ArrowRightOnRectangleIcon className="w-4 h-4" />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

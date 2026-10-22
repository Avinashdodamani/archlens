import { signOut } from 'aws-amplify/auth';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import NotificationCenter from './NotificationCenter';
import {
  SunIcon,
  MoonIcon,
  ArrowRightOnRectangleIcon,
  MagnifyingGlassIcon,
  GlobeAltIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';

export default function Header() {
  const { user, darkMode, toggleDarkMode, currentStep, setAuth, scanResult, selectedRegion, activeAccountId, connectedAccounts } = useAppStore();
  const location = useLocation();
  const navigate = useNavigate();

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
      return 'text-accent-600 bg-accent-50 border border-accent-200';
    }
    if (['discovered', 'analyzed', 'scripts_ready', 'backup_complete', 'success'].includes(currentStep)) {
      return 'text-success bg-success/10 border border-success/20';
    }
    if (currentStep === 'failed') return 'text-danger bg-danger/10 border border-danger/20';
    return '';
  }

  // Breadcrumbs based on path
  const breadcrumbMap: Record<string, { tab: string; section: string }> = {
    '/': { tab: 'Dashboard', section: 'Executive Command Center' },
    '/your-arch': { tab: 'YourArch', section: 'Architecture Topology & Discovery' },
    '/redefine': { tab: 'RedefineYourArch', section: 'Bedrock WAF Optimization' },
    '/auto-remediate': { tab: 'AutoRemediate', section: 'Safe Staged Implementation' },
    '/insights': { tab: 'InsightHub', section: 'Continuous Intelligence & Schedules' },
  };
  const currentCrumb = breadcrumbMap[location.pathname] || { tab: 'ArchLens', section: 'Platform' };

  const activeAccount = connectedAccounts.find(a => a.id === activeAccountId) || connectedAccounts[0];
  const accountId = scanResult?.accountId || activeAccount?.accountId;
  const regionDisplay = scanResult?.regions?.length && scanResult.regions.length > 1
    ? `${scanResult.regions.length} Regions`
    : (selectedRegion || scanResult?.regions?.[0] || 'ap-south-1');

  const username = user?.name || user?.email?.split('@')[0] || 'User';
  const initial = (user?.name || user?.email || 'U').charAt(0).toUpperCase();

  return (
    <header className={`h-14 border-b flex items-center justify-between px-6 sticky top-0 z-30 transition-colors ${
      darkMode ? 'bg-dark-900 border-dark-800' : 'bg-white border-dark-200'
    }`}>
      {/* Left - Breadcrumbs & Context */}
      <div className="flex items-center gap-3 min-w-0">
        <div className={`flex items-center gap-1.5 text-xs truncate ${darkMode ? 'text-dark-400' : 'text-dark-500'}`}>
          <span className={`font-semibold cursor-pointer transition-colors ${darkMode ? 'text-dark-200 hover:text-white' : 'text-dark-700 hover:text-primary-700'}`} onClick={() => navigate('/')}>
            ArchLens
          </span>
          <ChevronRightIcon className="w-3 h-3 text-dark-400 flex-shrink-0" />
          <span className="font-medium text-primary-600">{currentCrumb.tab}</span>
          <span className={`hidden lg:inline-flex items-center gap-1.5 ${darkMode ? 'text-dark-500' : 'text-dark-400'}`}>
            <span className="text-dark-300">•</span>
            <span className="text-[11px] truncate">{currentCrumb.section}</span>
          </span>
        </div>

        {getStepLabel() && (
          <div className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${getStepColor()}`}>
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
      <div className="flex items-center gap-2.5">
        {/* Active Account & Region Badge */}
        {accountId && (
          <div className={`hidden md:flex items-center gap-2 px-3 py-1 rounded-lg border text-xs ${
            darkMode ? 'bg-dark-800/60 border-dark-700' : 'bg-dark-50 border-dark-200'
          }`}>
            <div className={`flex items-center gap-1.5 ${darkMode ? 'text-dark-300' : 'text-dark-600'}`}>
              <GlobeAltIcon className="w-3.5 h-3.5 text-primary-600" />
              <span className="font-mono text-[11px]">{regionDisplay}</span>
            </div>
            <span className="text-dark-300">|</span>
            <span className={`font-mono text-[11px] ${darkMode ? 'text-dark-400' : 'text-dark-500'}`}>{accountId}</span>
          </div>
        )}

        {/* Command palette hint (Cmd/Ctrl+K) */}
        <button
          onClick={() => {
            const evt = new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true, bubbles: true });
            window.dispatchEvent(evt);
          }}
          className={`hidden md:flex items-center gap-2 px-2.5 py-1.5 rounded-lg border transition-all ${
            darkMode
              ? 'text-dark-400 hover:text-white hover:bg-dark-800 border-dark-700'
              : 'text-dark-500 hover:text-primary-700 hover:bg-primary-50 border-dark-200'
          }`}
          title="Search (Ctrl/Cmd + K)"
        >
          <MagnifyingGlassIcon className="w-4 h-4" />
          <span className="text-xs">Search</span>
          <kbd className={`text-[10px] px-1.5 py-0.5 rounded ${darkMode ? 'text-dark-500 bg-dark-900' : 'text-dark-400 bg-dark-100'}`}>⌘K</kbd>
        </button>

        {/* Notifications */}
        <NotificationCenter />

        {/* Dark/Light Mode */}
        <button
          onClick={toggleDarkMode}
          className={`p-2 rounded-lg transition-all duration-200 ${
            darkMode ? 'text-dark-400 hover:text-white hover:bg-dark-800' : 'text-dark-500 hover:text-primary-700 hover:bg-primary-50'
          }`}
          title={darkMode ? 'Light Mode' : 'Dark Mode'}
        >
          {darkMode ? <SunIcon className="w-5 h-5" /> : <MoonIcon className="w-5 h-5" />}
        </button>

        {/* Profile Dropdown */}
        <div className="relative group">
          <button className={`flex items-center gap-2.5 pl-2 pr-3 py-1.5 rounded-lg transition-all duration-200 border border-transparent ${
            darkMode ? 'hover:bg-dark-800 hover:border-dark-700' : 'hover:bg-primary-50'
          }`}>
            <div className="w-8 h-8 bg-primary-700 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-sm">
              {initial}
            </div>
            <span className={`text-sm font-medium hidden md:block ${darkMode ? 'text-dark-200' : 'text-dark-700'}`}>{username}</span>
          </button>

          {/* Dropdown */}
          <div className={`absolute right-0 top-full mt-2 w-64 rounded-xl shadow-card-hover opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 overflow-hidden border ${
            darkMode ? 'bg-dark-800 border-dark-700' : 'bg-white border-dark-200'
          }`}>
            {/* Profile header */}
            <div className={`p-4 border-b ${darkMode ? 'bg-dark-900 border-dark-700' : 'bg-primary-50 border-dark-200'}`}>
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 bg-primary-700 rounded-full flex items-center justify-center text-sm font-bold text-white shadow-sm">
                  {initial}
                </div>
                <div>
                  <p className={`text-sm font-semibold ${darkMode ? 'text-white' : 'text-dark-800'}`}>{username}</p>
                  <p className="text-xs text-dark-400 max-w-[160px] truncate">{user?.email}</p>
                </div>
              </div>
            </div>
            {/* Actions */}
            <div className="p-2">
              <div className={`px-3 py-2.5 text-sm rounded-lg ${darkMode ? 'text-dark-300' : 'text-dark-600'}`}>
                <p className="text-xs text-dark-400 mb-1">Name</p>
                <p className="font-medium">{username}</p>
              </div>
              <div className={`px-3 py-2.5 text-sm rounded-lg ${darkMode ? 'text-dark-300' : 'text-dark-600'}`}>
                <p className="text-xs text-dark-400 mb-1">Email</p>
                <p className="font-medium text-xs">{user?.email || ''}</p>
              </div>
              <div className={`border-t my-1 ${darkMode ? 'border-dark-700' : 'border-dark-200'}`} />
              <button
                onClick={handleSignOut}
                className="w-full text-sm text-danger hover:bg-danger/10 rounded-lg px-3 py-2 text-left flex items-center gap-2.5 transition-colors"
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

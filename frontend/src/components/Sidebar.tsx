import { useNavigate, useLocation } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import {
  HomeIcon,
  CpuChipIcon,
  SparklesIcon,
  WrenchScrewdriverIcon,
  ChartBarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';

const navItems = [
  { path: '/', label: 'Dashboard', icon: HomeIcon },
  { path: '/your-arch', label: 'YourArch', icon: CpuChipIcon },
  { path: '/redefine', label: 'RedefineYourArch', icon: SparklesIcon },
  { path: '/auto-remediate', label: 'AutoRemediate', icon: WrenchScrewdriverIcon },
  { path: '/insights', label: 'InsightHub', icon: ChartBarIcon },
];

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { sidebarCollapsed, toggleSidebar, darkMode, scanResult, analysisResult, activeAccountId, connectedAccounts } = useAppStore();

  const totalResources = scanResult?.summary?.total_resources || 0;
  const totalRecs = analysisResult?.analysis?.recommendations?.length || 0;
  const currentAcc = connectedAccounts.find(a => a.id === activeAccountId) || connectedAccounts[0];
  const connected = !!(scanResult || currentAcc);

  return (
    <aside
      className={`fixed left-0 top-0 h-full z-40 flex flex-col transition-all duration-300 border-r
        ${darkMode ? 'bg-dark-900 border-dark-800' : 'bg-white border-dark-200'}
        ${sidebarCollapsed ? 'w-[72px]' : 'w-[240px]'}`}
    >
      {/* Logo */}
      <div className={`flex items-center justify-center border-b ${sidebarCollapsed ? 'h-16 px-2' : 'h-20 px-4'} ${darkMode ? 'border-dark-800' : 'border-dark-200'}`}>
        <img
          src="/cloudthat-logo-removebg-preview.png"
          alt="CloudThat"
          className={`object-contain ${sidebarCollapsed ? 'h-10 w-10' : 'h-14'}`}
        />
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;

          let badgeText = '';
          if (item.path === '/your-arch' && totalResources > 0) badgeText = String(totalResources);
          else if (item.path === '/redefine' && totalRecs > 0) badgeText = String(totalRecs);

          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200
                ${isActive
                  ? 'bg-primary-700 text-white shadow-sm'
                  : darkMode
                    ? 'text-dark-300 hover:text-white hover:bg-dark-800'
                    : 'text-dark-600 hover:text-primary-700 hover:bg-primary-50'
                }
                ${sidebarCollapsed ? 'justify-center' : ''}`}
              title={sidebarCollapsed ? item.label : undefined}
            >
              <Icon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-white' : ''}`} />

              {!sidebarCollapsed && (
                <div className="flex-1 flex items-center justify-between min-w-0">
                  <span className="text-sm font-medium truncate">{item.label}</span>
                  {badgeText && (
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full
                      ${isActive ? 'bg-white/20 text-white' : 'bg-primary-100 text-primary-700'}`}>
                      {badgeText}
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </nav>

      {/* Account status pill */}
      {!sidebarCollapsed && (
        <div className={`px-3 py-2.5 mx-3 mb-2 rounded-lg border
          ${darkMode ? 'bg-dark-800/60 border-dark-700' : 'bg-dark-50 border-dark-200'}`}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-dark-400">Account</span>
            <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${connected ? 'text-success' : 'text-dark-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-success animate-pulse' : 'bg-dark-300'}`} />
              {connected ? 'Connected' : 'Offline'}
            </span>
          </div>
          <p className={`text-xs font-mono truncate ${darkMode ? 'text-dark-300' : 'text-dark-600'}`}>
            {scanResult?.accountId || currentAcc?.accountId || 'No Account Connected'}
          </p>
        </div>
      )}

      {/* Collapse toggle */}
      <div className={`p-3 border-t flex items-center justify-end ${darkMode ? 'border-dark-800' : 'border-dark-200'}`}>
        <button
          onClick={toggleSidebar}
          className={`p-2 rounded-lg transition-colors
            ${darkMode ? 'text-dark-400 hover:text-white hover:bg-dark-800' : 'text-dark-400 hover:text-primary-700 hover:bg-primary-50'}
            ${sidebarCollapsed ? 'w-full flex items-center justify-center' : ''}`}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? <ChevronRightIcon className="w-4 h-4" /> : <ChevronLeftIcon className="w-4 h-4" />}
        </button>
      </div>
    </aside>
  );
}

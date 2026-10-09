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
  { path: '/', label: 'Dashboard', icon: HomeIcon, color: 'from-blue-500 to-blue-600' },
  { path: '/your-arch', label: 'YourArch', icon: CpuChipIcon, color: 'from-cyan-500 to-cyan-600' },
  { path: '/redefine', label: 'RedefineYourArch', icon: SparklesIcon, color: 'from-purple-500 to-purple-600' },
  { path: '/auto-remediate', label: 'AutoRemediate', icon: WrenchScrewdriverIcon, color: 'from-orange-500 to-orange-600' },
  { path: '/insights', label: 'InsightHub', icon: ChartBarIcon, color: 'from-emerald-500 to-emerald-600' },
];

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { sidebarCollapsed, toggleSidebar, scanResult, analysisResult, activeAccountId, connectedAccounts } = useAppStore();

  const totalResources = scanResult?.summary?.total_resources || 0;
  const totalRecs = analysisResult?.analysis?.recommendations?.length || 0;
  const currentAcc = connectedAccounts.find(a => a.id === activeAccountId) || connectedAccounts[0];

  return (
    <aside
      className={`fixed left-0 top-0 h-full bg-dark-900 border-r border-dark-700/50 z-40 
                  flex flex-col transition-all duration-300 ${sidebarCollapsed ? 'w-[68px]' : 'w-[240px]'}`}
    >
      {/* Logo */}
      <div className="flex items-center h-16 px-4 border-b border-dark-700/50">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-primary-500 to-blue-600 rounded-xl flex items-center justify-center font-bold text-white text-sm shadow-lg shadow-primary-500/20 flex-shrink-0">
            AL
          </div>
          {!sidebarCollapsed && (
            <div className="min-w-0">
              <h1 className="text-base font-bold text-white tracking-tight truncate">ArchLens</h1>
              <p className="text-[9px] text-gray-500 font-medium tracking-wider uppercase -mt-0.5">Cloud Intelligence</p>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-2.5 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;

          let badgeText = '';
          let badgeColor = '';
          if (item.path === '/your-arch' && totalResources > 0) {
            badgeText = String(totalResources);
            badgeColor = 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20';
          } else if (item.path === '/redefine' && totalRecs > 0) {
            badgeText = String(totalRecs);
            badgeColor = 'bg-purple-500/10 text-purple-400 border border-purple-500/20';
          }

          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group
                ${isActive
                  ? 'bg-primary-500/10 text-primary-400 shadow-sm'
                  : 'text-gray-400 hover:text-white hover:bg-dark-800/70'
                }
                ${sidebarCollapsed ? 'justify-center' : ''}`}
              title={sidebarCollapsed ? item.label : undefined}
            >
              <div className={`p-1.5 rounded-lg transition-all duration-200 flex-shrink-0 ${
                isActive 
                  ? `bg-gradient-to-br ${item.color} shadow-lg` 
                  : 'bg-dark-800 group-hover:bg-dark-700'
              }`}>
                <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-gray-400 group-hover:text-white'}`} />
              </div>

              {!sidebarCollapsed && (
                <div className="flex-1 flex items-center justify-between min-w-0">
                  <span className={`text-sm font-medium truncate ${isActive ? 'text-primary-400' : ''}`}>
                    {item.label}
                  </span>
                  {badgeText && (
                    <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded-full ${badgeColor}`}>
                      {badgeText}
                    </span>
                  )}
                  {isActive && !badgeText && (
                    <div className="w-1.5 h-1.5 rounded-full bg-primary-400" />
                  )}
                </div>
              )}
            </button>
          );
        })}
      </nav>

      {/* Account Info Pill & Version Footer */}
      {!sidebarCollapsed && (
        <div className="px-3 py-2.5 mx-2.5 mb-2 rounded-xl bg-dark-950/60 border border-dark-700/50">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Account</span>
            <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${
              (scanResult || currentAcc) ? 'text-emerald-400' : 'text-gray-500'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                (scanResult || currentAcc) ? 'bg-emerald-400 animate-pulse' : 'bg-gray-600'
              }`} />
              {(scanResult || currentAcc) ? 'Connected' : 'Offline'}
            </span>
          </div>
          <p className="text-xs text-gray-300 font-mono truncate">
            {scanResult?.accountId || currentAcc?.accountId || 'No Account Connected'}
          </p>
        </div>
      )}

      {/* Collapse Toggle & Metadata */}
      <div className="p-3 border-t border-dark-700/50 flex items-center justify-between">
        {!sidebarCollapsed && (
          <div className="text-[10px] text-gray-500 font-medium tracking-tight">
            v1.0.0 Enterprise
          </div>
        )}
        <button
          onClick={toggleSidebar}
          className={`p-2 text-gray-500 hover:text-white rounded-lg hover:bg-dark-800 transition-colors ${
            sidebarCollapsed ? 'w-full flex items-center justify-center' : ''
          }`}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? (
            <ChevronRightIcon className="w-4 h-4" />
          ) : (
            <ChevronLeftIcon className="w-4 h-4" />
          )}
        </button>
      </div>
    </aside>
  );
}

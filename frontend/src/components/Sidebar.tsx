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
  const { sidebarCollapsed, toggleSidebar } = useAppStore();

  return (
    <aside
      className={`fixed left-0 top-0 h-full bg-dark-900 border-r border-dark-700/50 z-40 
                  flex flex-col transition-all duration-300 ${sidebarCollapsed ? 'w-[68px]' : 'w-[240px]'}`}
    >
      {/* Logo */}
      <div className="flex items-center h-16 px-4 border-b border-dark-700/50">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-primary-500 to-blue-600 rounded-xl flex items-center justify-center font-bold text-white text-sm shadow-lg shadow-primary-500/20">
            AL
          </div>
          {!sidebarCollapsed && (
            <div>
              <h1 className="text-base font-bold text-white tracking-tight">ArchLens</h1>
              <p className="text-[9px] text-gray-500 font-medium tracking-wider uppercase -mt-0.5">Cloud Intelligence</p>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-2.5 space-y-1">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;
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
              <div className={`p-1.5 rounded-lg transition-all duration-200 ${
                isActive 
                  ? `bg-gradient-to-br ${item.color} shadow-lg` 
                  : 'bg-dark-800 group-hover:bg-dark-700'
              }`}>
                <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-gray-400 group-hover:text-white'}`} />
              </div>
              {!sidebarCollapsed && (
                <span className={`text-sm font-medium ${isActive ? 'text-primary-400' : ''}`}>
                  {item.label}
                </span>
              )}
              {isActive && !sidebarCollapsed && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary-400" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Collapse Toggle */}
      <div className="p-3 border-t border-dark-700/50">
        <button
          onClick={toggleSidebar}
          className="w-full flex items-center justify-center p-2 text-gray-500 hover:text-white rounded-lg hover:bg-dark-800 transition-colors"
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

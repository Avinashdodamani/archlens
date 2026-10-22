/**
 * Mobile bottom navigation for small screens
 */
import { useNavigate, useLocation } from 'react-router-dom';
import {
  HomeIcon,
  CpuChipIcon,
  SparklesIcon,
  WrenchScrewdriverIcon,
  ChartBarIcon,
} from '@heroicons/react/24/outline';
import {
  HomeIcon as HomeIconSolid,
  CpuChipIcon as CpuChipIconSolid,
  SparklesIcon as SparklesIconSolid,
  WrenchScrewdriverIcon as WrenchScrewdriverIconSolid,
  ChartBarIcon as ChartBarIconSolid,
} from '@heroicons/react/24/solid';

const navItems = [
  { path: '/', label: 'Home', Icon: HomeIcon, IconActive: HomeIconSolid },
  { path: '/your-arch', label: 'Discover', Icon: CpuChipIcon, IconActive: CpuChipIconSolid },
  { path: '/redefine', label: 'Analyze', Icon: SparklesIcon, IconActive: SparklesIconSolid },
  { path: '/auto-remediate', label: 'Deploy', Icon: WrenchScrewdriverIcon, IconActive: WrenchScrewdriverIconSolid },
  { path: '/insights', label: 'Insights', Icon: ChartBarIcon, IconActive: ChartBarIconSolid },
];

export default function MobileNav() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-dark-900/95 backdrop-blur-lg border-t border-dark-700/50 lg:hidden safe-area-inset-bottom">
      <div className="flex items-center justify-around px-2 py-2">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = isActive ? item.IconActive : item.Icon;
          
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`
                flex flex-col items-center justify-center px-3 py-2 rounded-xl min-w-[64px] transition-all duration-200
                ${isActive
                  ? 'text-primary-400 bg-primary-500/10'
                  : 'text-gray-500 hover:text-gray-300 active:scale-95'
                }
              `}
            >
              <Icon className={`w-5 h-5 mb-1 ${isActive ? 'text-primary-400' : ''}`} />
              <span className={`text-[10px] font-medium ${isActive ? 'text-primary-400' : ''}`}>
                {item.label}
              </span>
              {isActive && (
                <span className="absolute -top-px left-1/2 -translate-x-1/2 w-8 h-1 bg-primary-500 rounded-b-full" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

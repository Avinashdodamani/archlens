/**
 * Reusable empty state component with illustrations
 */
import { ReactNode } from 'react';
import {
  CubeTransparentIcon,
  ChartBarIcon,
  ShieldCheckIcon,
  ClockIcon,
  SparklesIcon,
  GlobeAltIcon,
  DocumentMagnifyingGlassIcon,
  ServerStackIcon,
} from '@heroicons/react/24/outline';

type EmptyStateType = 
  | 'no-scans'
  | 'no-resources'
  | 'no-analysis'
  | 'no-recommendations'
  | 'no-account'
  | 'no-history'
  | 'no-data'
  | 'error';

interface EmptyStateProps {
  type?: EmptyStateType;
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

const defaultIcons: Record<EmptyStateType, ReactNode> = {
  'no-scans': <CubeTransparentIcon className="w-12 h-12" />,
  'no-resources': <ServerStackIcon className="w-12 h-12" />,
  'no-analysis': <SparklesIcon className="w-12 h-12" />,
  'no-recommendations': <ShieldCheckIcon className="w-12 h-12" />,
  'no-account': <GlobeAltIcon className="w-12 h-12" />,
  'no-history': <ClockIcon className="w-12 h-12" />,
  'no-data': <ChartBarIcon className="w-12 h-12" />,
  'error': <DocumentMagnifyingGlassIcon className="w-12 h-12" />,
};

const gradients: Record<EmptyStateType, string> = {
  'no-scans': 'from-blue-500/20 to-blue-600/10 border-blue-500/20',
  'no-resources': 'from-cyan-500/20 to-cyan-600/10 border-cyan-500/20',
  'no-analysis': 'from-primary-500/20 to-primary-600/10 border-primary-500/20',
  'no-recommendations': 'from-green-500/20 to-green-600/10 border-green-500/20',
  'no-account': 'from-primary-500/20 to-primary-600/10 border-primary-500/20',
  'no-history': 'from-amber-500/20 to-amber-600/10 border-amber-500/20',
  'no-data': 'from-gray-500/20 to-gray-600/10 border-gray-500/20',
  'error': 'from-red-500/20 to-red-600/10 border-red-500/20',
};

const iconColors: Record<EmptyStateType, string> = {
  'no-scans': 'text-blue-400',
  'no-resources': 'text-cyan-400',
  'no-analysis': 'text-primary-400',
  'no-recommendations': 'text-green-400',
  'no-account': 'text-primary-400',
  'no-history': 'text-amber-400',
  'no-data': 'text-gray-400',
  'error': 'text-red-400',
};

export default function EmptyState({
  type = 'no-data',
  title,
  description,
  action,
  icon,
  className = '',
}: EmptyStateProps) {
  return (
    <div className={`text-center py-16 ${className}`}>
      {/* Decorative background circles */}
      <div className="relative inline-block mb-6">
        <div className="absolute inset-0 bg-gradient-to-br from-primary-500/5 to-transparent rounded-full blur-xl scale-150" />
        <div className={`relative w-20 h-20 bg-gradient-to-br ${gradients[type]} rounded-2xl flex items-center justify-center border shadow-xl`}>
          <span className={iconColors[type]}>
            {icon || defaultIcons[type]}
          </span>
        </div>
      </div>

      <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
      <p className="text-gray-400 text-sm max-w-md mx-auto leading-relaxed mb-6">
        {description}
      </p>

      {action && (
        <div className="flex justify-center">
          {action}
        </div>
      )}
    </div>
  );
}

/**
 * Compact version for inline use
 */
export function EmptyStateCompact({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <div className="w-12 h-12 bg-dark-800 rounded-xl flex items-center justify-center mb-3 text-gray-500">
        {icon}
      </div>
      <p className="text-sm font-medium text-gray-300 mb-1">{title}</p>
      <p className="text-xs text-gray-500 max-w-[200px]">{description}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

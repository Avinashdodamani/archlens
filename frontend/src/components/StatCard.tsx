/**
 * Reusable stat card component
 */
import { ReactNode } from 'react';
import AnimatedCounter from './AnimatedCounter';

interface StatCardProps {
  label: string;
  value: number | string;
  icon: ReactNode;
  iconBgClass?: string;
  iconTextClass?: string;
  subtitle?: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  animate?: boolean;
  onClick?: () => void;
  className?: string;
}

export default function StatCard({
  label,
  value,
  icon,
  iconBgClass = 'from-primary-500/20 to-primary-600/10 border-primary-500/20',
  iconTextClass = 'text-primary-400',
  subtitle,
  trend,
  animate = true,
  onClick,
  className = '',
}: StatCardProps) {
  const isClickable = !!onClick;
  
  return (
    <div
      className={`
        card bg-gradient-to-br from-dark-800 via-dark-800 to-dark-900 border-dark-600/50 
        relative overflow-hidden group hover-lift
        ${isClickable ? 'cursor-pointer' : ''}
        ${className}
      `}
      onClick={onClick}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
    >
      {/* Background glow */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-white/[0.02] to-transparent rounded-full -mr-10 -mt-10 group-hover:from-white/[0.04] transition-colors" />
      
      <div className="flex items-center gap-4">
        <div className={`p-3.5 bg-gradient-to-br ${iconBgClass} rounded-xl border`}>
          <span className={iconTextClass}>{icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider">{label}</p>
          <div className="flex items-baseline gap-2 mt-0.5">
            <p className={`text-2xl font-bold ${typeof value === 'number' && value > 0 ? 'text-white' : 'text-gray-600'}`}>
              {typeof value === 'number' && value > 0 && animate ? (
                <AnimatedCounter value={value} duration={800} />
              ) : (
                value || '—'
              )}
            </p>
            {trend && (
              <span className={`text-xs font-medium flex items-center gap-0.5 ${trend.isPositive ? 'text-green-400' : 'text-red-400'}`}>
                {trend.isPositive ? '↑' : '↓'}
                {Math.abs(trend.value)}
              </span>
            )}
          </div>
          {subtitle && (
            <p className="text-[10px] text-gray-500 mt-0.5 truncate">{subtitle}</p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Mini stat for compact displays
 */
export function MiniStat({
  label,
  value,
  colorClass = 'text-white',
  className = '',
}: {
  label: string;
  value: number | string;
  colorClass?: string;
  className?: string;
}) {
  return (
    <div className={`text-center ${className}`}>
      <p className={`text-2xl font-bold ${colorClass}`}>
        {typeof value === 'number' ? <AnimatedCounter value={value} duration={600} /> : value}
      </p>
      <p className="text-[10px] text-gray-500 uppercase tracking-wide mt-0.5">{label}</p>
    </div>
  );
}

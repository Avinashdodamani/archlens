/**
 * Consistent status badge component with animations
 */
import { ReactNode } from 'react';

type StatusType = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'loading';
type Size = 'sm' | 'md' | 'lg';

interface StatusBadgeProps {
  status: StatusType;
  children: ReactNode;
  size?: Size;
  dot?: boolean;
  pulse?: boolean;
  icon?: ReactNode;
  className?: string;
}

const statusStyles: Record<StatusType, { bg: string; text: string; dot: string }> = {
  success: {
    bg: 'bg-green-500/10 border-green-500/20',
    text: 'text-green-400',
    dot: 'bg-green-400',
  },
  warning: {
    bg: 'bg-yellow-500/10 border-yellow-500/20',
    text: 'text-yellow-400',
    dot: 'bg-yellow-400',
  },
  error: {
    bg: 'bg-red-500/10 border-red-500/20',
    text: 'text-red-400',
    dot: 'bg-red-400',
  },
  info: {
    bg: 'bg-blue-500/10 border-blue-500/20',
    text: 'text-blue-400',
    dot: 'bg-blue-400',
  },
  neutral: {
    bg: 'bg-gray-500/10 border-gray-500/20',
    text: 'text-gray-400',
    dot: 'bg-gray-400',
  },
  loading: {
    bg: 'bg-primary-500/10 border-primary-500/20',
    text: 'text-primary-400',
    dot: 'bg-primary-400',
  },
};

const sizeStyles: Record<Size, { padding: string; text: string; dot: string }> = {
  sm: { padding: 'px-2 py-0.5', text: 'text-[10px]', dot: 'w-1.5 h-1.5' },
  md: { padding: 'px-2.5 py-1', text: 'text-xs', dot: 'w-2 h-2' },
  lg: { padding: 'px-3 py-1.5', text: 'text-sm', dot: 'w-2.5 h-2.5' },
};

export default function StatusBadge({
  status,
  children,
  size = 'md',
  dot = true,
  pulse = false,
  icon,
  className = '',
}: StatusBadgeProps) {
  const styles = statusStyles[status];
  const sizes = sizeStyles[size];

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 rounded-full font-medium border
        ${styles.bg} ${styles.text} ${sizes.padding} ${sizes.text}
        ${className}
      `}
    >
      {dot && (
        <span className="relative flex-shrink-0">
          <span className={`block rounded-full ${styles.dot} ${sizes.dot}`} />
          {(pulse || status === 'loading') && (
            <span
              className={`absolute inset-0 rounded-full ${styles.dot} animate-ping opacity-75`}
            />
          )}
        </span>
      )}
      {icon && <span className="flex-shrink-0">{icon}</span>}
      {children}
    </span>
  );
}

/**
 * Priority badge for recommendations
 */
export function PriorityBadge({ priority }: { priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | string }) {
  const priorityMap: Record<string, StatusType> = {
    CRITICAL: 'error',
    HIGH: 'warning',
    MEDIUM: 'info',
    LOW: 'success',
  };
  
  return (
    <StatusBadge status={priorityMap[priority] || 'neutral'} size="sm" dot={false}>
      {priority}
    </StatusBadge>
  );
}

/**
 * Connection status indicator
 */
export function ConnectionStatus({ isConnected }: { isConnected: boolean }) {
  return (
    <StatusBadge
      status={isConnected ? 'success' : 'neutral'}
      size="sm"
      pulse={isConnected}
    >
      {isConnected ? 'Connected' : 'Disconnected'}
    </StatusBadge>
  );
}

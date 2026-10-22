/**
 * Enhanced card component with variants
 */
import { ReactNode } from 'react';

type CardVariant = 'default' | 'glass' | 'gradient' | 'outlined' | 'elevated';

interface CardProps {
  children: ReactNode;
  variant?: CardVariant;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  className?: string;
  onClick?: () => void;
  hoverEffect?: boolean;
}

const variantClasses: Record<CardVariant, string> = {
  default: 'bg-dark-800 border border-dark-700/50',
  glass: 'backdrop-blur-xl bg-dark-800/60 border border-dark-700/30',
  gradient: 'bg-gradient-to-br from-dark-800 via-dark-800 to-dark-900 border border-dark-600/50',
  outlined: 'bg-transparent border-2 border-dark-600',
  elevated: 'bg-dark-800 border border-dark-700/50 shadow-2xl shadow-black/20',
};

const paddingClasses: Record<string, string> = {
  none: 'p-0',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
};

export default function Card({
  children,
  variant = 'default',
  padding = 'md',
  className = '',
  onClick,
  hoverEffect = false,
}: CardProps) {
  const isClickable = !!onClick;

  return (
    <div
      className={`
        rounded-xl shadow-lg
        ${variantClasses[variant]}
        ${paddingClasses[padding]}
        ${hoverEffect ? 'hover-lift transition-all duration-200' : ''}
        ${isClickable ? 'cursor-pointer' : ''}
        ${className}
      `}
      onClick={onClick}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
    >
      {children}
    </div>
  );
}

/**
 * Card header component
 */
export function CardHeader({
  title,
  subtitle,
  icon,
  action,
  className = '',
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center justify-between mb-4 ${className}`}>
      <div className="flex items-center gap-3">
        {icon && (
          <div className="text-gray-400">{icon}</div>
        )}
        <div>
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          {subtitle && <p className="text-sm text-gray-400">{subtitle}</p>}
        </div>
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

/**
 * Card footer component
 */
export function CardFooter({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mt-4 pt-4 border-t border-dark-700/50 ${className}`}>
      {children}
    </div>
  );
}

/**
 * Highlight card for featured content
 */
export function HighlightCard({
  children,
  accentColor = 'primary',
  className = '',
}: {
  children: ReactNode;
  accentColor?: 'primary' | 'success' | 'warning' | 'danger';
  className?: string;
}) {
  const accentClasses = {
    primary: 'border-l-primary-500 from-primary-900/10',
    success: 'border-l-green-500 from-green-900/10',
    warning: 'border-l-yellow-500 from-yellow-900/10',
    danger: 'border-l-red-500 from-red-900/10',
  };

  return (
    <div
      className={`
        p-4 rounded-lg border-l-4 
        ${accentClasses[accentColor]}
        bg-gradient-to-r to-transparent
        ${className}
      `}
    >
      {children}
    </div>
  );
}

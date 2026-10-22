/**
 * Resource card component for displaying AWS resources
 */
import { getServiceIconPath } from '../config/aws-icon-map';
import { useAppStore } from '../store/useAppStore';
import AnimatedCounter from './AnimatedCounter';

interface ResourceCardProps {
  type: string;
  count: number;
  onClick?: () => void;
  isSelected?: boolean;
  className?: string;
}

export default function ResourceCard({
  type,
  count,
  onClick,
  isSelected = false,
  className = '',
}: ResourceCardProps) {
  const { darkMode } = useAppStore();

  return (
    <div
      onClick={onClick}
      className={`
        bg-dark-900/70 rounded-xl p-4 border text-center transition-all duration-200
        ${onClick ? 'cursor-pointer' : ''}
        ${isSelected
          ? 'border-primary-500 bg-primary-500/10 shadow-lg shadow-primary-500/10'
          : 'border-dark-700/50 hover:border-primary-500/30 hover:bg-dark-800/50'
        }
        ${className}
      `}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <img
        src={getServiceIconPath(type, darkMode)}
        alt={type}
        className="w-9 h-9 mx-auto mb-2"
        loading="lazy"
      />
      <p className="text-2xl font-bold text-white">
        <AnimatedCounter value={count} duration={600} />
      </p>
      <p className="text-xs text-gray-500 mt-1 font-medium truncate" title={type}>
        {type}
      </p>
    </div>
  );
}

/**
 * Compact resource badge for inline display
 */
export function ResourceBadge({
  type,
  count,
  className = '',
}: {
  type: string;
  count: number;
  className?: string;
}) {
  const { darkMode } = useAppStore();

  return (
    <div className={`inline-flex items-center gap-2 px-2.5 py-1.5 bg-dark-900/70 rounded-lg border border-dark-700/50 ${className}`}>
      <img
        src={getServiceIconPath(type, darkMode)}
        alt={type}
        className="w-4 h-4"
        loading="lazy"
      />
      <span className="text-xs font-medium text-gray-300">{type}</span>
      <span className="text-xs font-bold text-primary-400">{count}</span>
    </div>
  );
}

/**
 * Resource grid for displaying multiple resource types
 */
export function ResourceGrid({
  resources,
  onSelect,
  selectedType,
  columns = 6,
  className = '',
}: {
  resources: Record<string, number>;
  onSelect?: (type: string) => void;
  selectedType?: string;
  columns?: number;
  className?: string;
}) {
  const sortedResources = Object.entries(resources)
    .sort(([, a], [, b]) => b - a);

  const colClasses: Record<number, string> = {
    4: 'grid-cols-2 md:grid-cols-4',
    5: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-5',
    6: 'grid-cols-2 md:grid-cols-4 lg:grid-cols-6',
    8: 'grid-cols-2 md:grid-cols-4 lg:grid-cols-8',
  };

  return (
    <div className={`grid ${colClasses[columns] || colClasses[6]} gap-3 ${className}`}>
      {sortedResources.map(([type, count]) => (
        <ResourceCard
          key={type}
          type={type}
          count={count}
          onClick={onSelect ? () => onSelect(selectedType === type ? 'all' : type) : undefined}
          isSelected={selectedType === type}
        />
      ))}
    </div>
  );
}

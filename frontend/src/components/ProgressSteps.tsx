/**
 * Progress steps component for workflows
 */
import { CheckCircleIcon } from '@heroicons/react/24/solid';

interface Step {
  label: string;
  done: boolean;
  active?: boolean;
}

interface ProgressStepsProps {
  steps: Step[];
  className?: string;
  variant?: 'horizontal' | 'vertical';
}

export default function ProgressSteps({
  steps,
  className = '',
  variant = 'horizontal',
}: ProgressStepsProps) {
  const completedCount = steps.filter(s => s.done).length;

  if (variant === 'vertical') {
    return (
      <div className={`space-y-3 ${className}`}>
        {steps.map((step, idx) => (
          <div key={step.label} className="flex items-start gap-3">
            <div className="flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-500 ${
                  step.done
                    ? 'bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-lg shadow-green-500/25'
                    : step.active
                    ? 'bg-gradient-to-br from-primary-500 to-blue-600 text-white shadow-lg shadow-primary-500/25 animate-pulse'
                    : 'bg-dark-700 text-gray-500 border border-dark-600'
                }`}
              >
                {step.done ? <CheckCircleIcon className="w-4 h-4" /> : idx + 1}
              </div>
              {idx < steps.length - 1 && (
                <div
                  className={`w-0.5 h-8 mt-1 rounded-full transition-all duration-500 ${
                    step.done ? 'bg-gradient-to-b from-green-500 to-emerald-400' : 'bg-dark-700'
                  }`}
                />
              )}
            </div>
            <div className="pt-1">
              <span className={`text-sm font-medium ${step.done ? 'text-green-400' : step.active ? 'text-primary-400' : 'text-gray-500'}`}>
                {step.label}
              </span>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-semibold text-white">Progress</p>
        <span className="text-xs text-primary-400 font-bold bg-primary-500/10 px-2.5 py-1 rounded-full">
          {completedCount}/{steps.length}
        </span>
      </div>
      <div className="flex items-center">
        {steps.map((step, idx) => (
          <div key={step.label} className="flex items-center flex-1">
            <div className="flex flex-col items-center flex-1">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold transition-all duration-500 ${
                  step.done
                    ? 'bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-lg shadow-green-500/25'
                    : step.active
                    ? 'bg-gradient-to-br from-primary-500 to-blue-600 text-white shadow-lg shadow-primary-500/25 animate-pulse'
                    : 'bg-dark-700 text-gray-500 border border-dark-600'
                }`}
              >
                {step.done ? <CheckCircleIcon className="w-5 h-5" /> : idx + 1}
              </div>
              <span className={`text-[11px] mt-2 font-medium ${step.done ? 'text-green-400' : step.active ? 'text-primary-400' : 'text-gray-500'}`}>
                {step.label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div
                className={`h-0.5 w-full mx-2 rounded-full transition-all duration-500 ${
                  step.done ? 'bg-gradient-to-r from-green-500 to-emerald-400' : 'bg-dark-700'
                }`}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Compact progress bar
 */
export function ProgressBar({
  value,
  max = 100,
  label,
  showPercentage = true,
  colorClass = 'bg-primary-500',
  className = '',
}: {
  value: number;
  max?: number;
  label?: string;
  showPercentage?: boolean;
  colorClass?: string;
  className?: string;
}) {
  const percentage = Math.min((value / max) * 100, 100);

  return (
    <div className={className}>
      {(label || showPercentage) && (
        <div className="flex items-center justify-between mb-1.5">
          {label && <span className="text-xs text-gray-400">{label}</span>}
          {showPercentage && (
            <span className="text-xs font-medium text-gray-300">{Math.round(percentage)}%</span>
          )}
        </div>
      )}
      <div className="w-full bg-dark-700 rounded-full h-2 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${colorClass}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

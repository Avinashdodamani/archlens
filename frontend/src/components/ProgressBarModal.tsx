import { useState, useEffect } from 'react';

interface ProgressBarModalProps {
  isOpen: boolean;
  title: string;
  subtitle?: string;
  initialProgress?: number;
  onCancel?: () => void;
}

export default function ProgressBarModal({
  isOpen,
  title,
  subtitle = 'Please wait while this operation completes',
  initialProgress = 12,
  onCancel,
}: ProgressBarModalProps) {
  const [progress, setProgress] = useState(initialProgress);

  useEffect(() => {
    if (!isOpen) {
      setProgress(initialProgress);
      return;
    }

    setProgress(initialProgress);
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 92) {
          return Math.min(94, prev + 0.3);
        }
        const inc = Math.random() * 3 + 2;
        return Math.min(92, prev + inc);
      });
    }, 700);

    return () => clearInterval(interval);
  }, [isOpen, initialProgress]);

  if (!isOpen) return null;

  const displayPercent = Math.round(progress);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
    >
      <div
        className="w-full max-w-lg p-6 sm:p-8 rounded-2xl transition-all duration-300 shadow-2xl
                   bg-white dark:bg-slate-900/95 
                   border border-slate-200/90 dark:border-cyan-500/30 
                   dark:shadow-[0_0_40px_rgba(6,182,212,0.18)]"
      >
        {/* Title */}
        <h3 className="text-lg sm:text-xl font-bold tracking-tight text-center text-slate-900 dark:text-white">
          {title}
        </h3>

        {/* Progress Bar Container */}
        <div className="mt-6 mb-2">
          <div className="flex justify-end mb-1.5">
            <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-md bg-blue-50 dark:bg-cyan-500/10 text-blue-600 dark:text-cyan-400 border border-blue-200/60 dark:border-cyan-500/20">
              {displayPercent}%
            </span>
          </div>

          {/* Track */}
          <div className="w-full h-3 rounded-full overflow-hidden bg-slate-100 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700/60 p-0.5">
            {/* Fill */}
            <div
              className="h-full rounded-full transition-all duration-500 ease-out 
                         bg-gradient-to-r from-blue-600 to-indigo-600 
                         dark:from-cyan-400 dark:via-sky-400 dark:to-blue-500 
                         dark:shadow-[0_0_12px_rgba(6,182,212,0.6)]"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Subtitle */}
        <p className="mt-3 text-center text-xs text-slate-500 dark:text-slate-400 font-medium">
          {subtitle}
        </p>

        {/* Cancel Button */}
        {onCancel && (
          <div className="mt-5 flex justify-center">
            <button
              type="button"
              onClick={onCancel}
              className="px-5 py-2 text-xs font-medium rounded-lg transition-colors
                         text-slate-600 dark:text-slate-300
                         bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/80 dark:hover:bg-slate-700
                         border border-slate-300 dark:border-slate-700/60
                         focus:outline-none focus:ring-2 focus:ring-slate-400 dark:focus:ring-cyan-500/50"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

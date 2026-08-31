import { useEffect, useState } from 'react';
import { SparklesIcon, MagnifyingGlassIcon, ShieldCheckIcon, RocketLaunchIcon } from '@heroicons/react/24/outline';

/**
 * First-time onboarding tour (SOW Section 9 / premium UX).
 * 4-step overlay shown once; dismissal persisted in localStorage.
 */

const STORAGE_KEY = 'archlens-tour-done';

const STEPS = [
  { icon: <MagnifyingGlassIcon className="w-7 h-7" />, title: 'Discover', body: 'Connect a read-only IAM role in YourArch and scan your account to auto-generate an architecture diagram.' },
  { icon: <SparklesIcon className="w-7 h-7" />, title: 'Analyze', body: 'In RedefineYourArch, pick Well-Architected pillars and let AI produce prioritized, risk-scored recommendations.' },
  { icon: <ShieldCheckIcon className="w-7 h-7" />, title: 'Remediate safely', body: 'AutoRemediate backs up resources, previews the change set, deploys, and auto-rolls back on failure.' },
  { icon: <RocketLaunchIcon className="w-7 h-7" />, title: 'Monitor', body: 'InsightHub tracks scans, detects drift, and exports executive reports. Press ⌘K anytime to jump anywhere.' },
];

export default function OnboardingTour() {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
  }, []);

  function finish() {
    localStorage.setItem(STORAGE_KEY, '1');
    setVisible(false);
  }

  if (!visible) return null;
  const s = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-dark-800 border border-dark-600 rounded-2xl shadow-2xl overflow-hidden">
        <div className="p-6 text-center">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 text-white"
            style={{ background: 'linear-gradient(135deg, #1A56DB 0%, #8B5CF6 100%)' }}
          >
            {s.icon}
          </div>
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Step {step + 1} of {STEPS.length}</p>
          <h2 className="text-xl font-semibold text-white mb-2">{s.title}</h2>
          <p className="text-sm text-gray-400 leading-relaxed">{s.body}</p>
        </div>
        <div className="flex items-center justify-center gap-1.5 pb-4">
          {STEPS.map((_, i) => (
            <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? 'w-6 bg-primary-400' : 'w-1.5 bg-dark-600'}`} />
          ))}
        </div>
        <div className="flex items-center justify-between px-6 py-4 border-t border-dark-700">
          <button onClick={finish} className="text-sm text-gray-500 hover:text-gray-300">Skip</button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button onClick={() => setStep((x) => x - 1)} className="btn-secondary text-sm">Back</button>
            )}
            <button
              onClick={() => (last ? finish() : setStep((x) => x + 1))}
              className="btn-primary text-sm"
            >
              {last ? 'Get started' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

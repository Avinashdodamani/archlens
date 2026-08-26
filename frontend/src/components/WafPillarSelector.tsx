import { WAF_PILLARS } from '../config/constants';
import { CheckCircleIcon } from '@heroicons/react/24/outline';

interface WafPillarSelectorProps {
  selected: string[];
  onChange: (pillars: string[]) => void;
}

export default function WafPillarSelector({ selected, onChange }: WafPillarSelectorProps) {
  function toggle(key: string) {
    if (selected.includes(key)) {
      onChange(selected.filter(p => p !== key));
    } else {
      onChange([...selected, key]);
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {WAF_PILLARS.map((pillar) => {
        const isSelected = selected.includes(pillar.key);
        return (
          <button
            key={pillar.key}
            onClick={() => toggle(pillar.key)}
            className={`relative p-4 rounded-lg border text-left transition-all duration-200 ${
              isSelected
                ? 'border-primary-500 bg-primary-500/10'
                : 'border-dark-600 bg-dark-900 hover:border-dark-500'
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">{pillar.icon}</span>
              <div>
                <p className={`font-medium text-sm ${isSelected ? 'text-primary-300' : 'text-white'}`}>
                  {pillar.name}
                </p>
                <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{pillar.description}</p>
              </div>
            </div>
            {isSelected && (
              <CheckCircleIcon className="w-5 h-5 text-primary-400 absolute top-3 right-3" />
            )}
          </button>
        );
      })}
    </div>
  );
}

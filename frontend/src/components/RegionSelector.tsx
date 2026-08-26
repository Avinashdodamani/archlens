import { AWS_REGIONS, ALL_REGIONS_OPTION } from '../config/aws-regions';

interface RegionSelectorProps {
  value: string;
  onChange: (region: string) => void;
  className?: string;
}

export default function RegionSelector({ value, onChange, className = '' }: RegionSelectorProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`select-field ${className}`}
    >
      <option value={ALL_REGIONS_OPTION.code}>{ALL_REGIONS_OPTION.displayName}</option>
      <optgroup label="Americas">
        {AWS_REGIONS.filter(r => r.code.startsWith('us-') || r.code.startsWith('ca-') || r.code.startsWith('sa-')).map(r => (
          <option key={r.code} value={r.code}>{r.displayName}</option>
        ))}
      </optgroup>
      <optgroup label="Europe">
        {AWS_REGIONS.filter(r => r.code.startsWith('eu-')).map(r => (
          <option key={r.code} value={r.code}>{r.displayName}</option>
        ))}
      </optgroup>
      <optgroup label="Asia Pacific">
        {AWS_REGIONS.filter(r => r.code.startsWith('ap-')).map(r => (
          <option key={r.code} value={r.code}>{r.displayName}</option>
        ))}
      </optgroup>
      <optgroup label="Middle East & Africa">
        {AWS_REGIONS.filter(r => r.code.startsWith('me-') || r.code.startsWith('af-') || r.code.startsWith('il-')).map(r => (
          <option key={r.code} value={r.code}>{r.displayName}</option>
        ))}
      </optgroup>
    </select>
  );
}

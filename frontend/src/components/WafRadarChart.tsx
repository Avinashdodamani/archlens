import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from 'recharts';
import { WAF_PILLARS } from '../config/constants';

interface WafRadarChartProps {
  pillarScores: Record<string, { score: number; status?: string }>;
  isDark: boolean;
}

/**
 * WAF Pillar Radar (spider) chart — visualizes compliance across all 6
 * Well-Architected Framework pillars, per the SOW dashboard spec.
 */
export default function WafRadarChart({ pillarScores, isDark }: WafRadarChartProps) {
  const data = WAF_PILLARS.map((pillar) => ({
    pillar: pillar.name.replace(' ', '\n'),
    shortName: pillar.name.split(' ')[0],
    score: pillarScores[pillar.key]?.score || 0,
    fullMark: 100,
  }));

  const gridColor = isDark ? '#334155' : '#e2e8f0';
  const textColor = isDark ? '#94a3b8' : '#64748b';

  return (
    <ResponsiveContainer width="100%" height={280}>
      <RadarChart data={data} outerRadius="72%">
        <PolarGrid stroke={gridColor} />
        <PolarAngleAxis
          dataKey="shortName"
          tick={{ fill: textColor, fontSize: 11, fontWeight: 500 }}
        />
        <PolarRadiusAxis
          angle={90}
          domain={[0, 100]}
          tick={{ fill: textColor, fontSize: 9 }}
          axisLine={false}
        />
        <Radar
          name="Score"
          dataKey="score"
          stroke="#3b82f6"
          fill="#3b82f6"
          fillOpacity={0.35}
          strokeWidth={2}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}

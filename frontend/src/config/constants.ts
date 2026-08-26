/**
 * Application-wide constants.
 * No hardcoded secrets — all sensitive values from environment variables.
 */

export const APP_CONFIG = {
  name: import.meta.env.VITE_APP_NAME || 'ArchLens',
  version: import.meta.env.VITE_APP_VERSION || '1.0.0',
  tagline: 'See Your Cloud. Reimagine It. Perfect It.',
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || '',
  region: import.meta.env.VITE_AWS_REGION || 'ap-south-1',
};

export const WAF_PILLARS = [
  {
    key: 'operational_excellence',
    name: 'Operational Excellence',
    icon: '⚙️',
    color: '#3B82F6',
    description: 'Automate operations, respond to events, define standards to manage daily operations',
  },
  {
    key: 'security',
    name: 'Security',
    icon: '🔒',
    color: '#EF4444',
    description: 'Protect data, manage permissions, detect and respond to security events',
  },
  {
    key: 'reliability',
    name: 'Reliability',
    icon: '🛡️',
    color: '#10B981',
    description: 'Recover from failures, scale to meet demand, mitigate disruptions',
  },
  {
    key: 'performance_efficiency',
    name: 'Performance Efficiency',
    icon: '⚡',
    color: '#F59E0B',
    description: 'Select right resources, monitor performance, adapt as demand changes',
  },
  {
    key: 'cost_optimization',
    name: 'Cost Optimization',
    icon: '💰',
    color: '#8B5CF6',
    description: 'Eliminate waste, right-size resources, leverage pricing models',
  },
  {
    key: 'sustainability',
    name: 'Sustainability',
    icon: '🌱',
    color: '#06B6D4',
    description: 'Reduce environmental impact, maximize utilization, minimize waste',
  },
];

/**
 * Resource type colors — sourced from official AWS Architecture Icons category palette.
 * See aws-theme.ts for the canonical source and category-to-hex mapping.
 * These are re-exported here for backward compatibility.
 */
export { AWS_SERVICE_COLORS as RESOURCE_TYPE_COLORS } from './aws-theme';

export const PRIORITY_CONFIG = {
  CRITICAL: { color: 'text-red-400', bg: 'bg-red-500/20', label: 'Critical' },
  HIGH: { color: 'text-orange-400', bg: 'bg-orange-500/20', label: 'High' },
  MEDIUM: { color: 'text-yellow-400', bg: 'bg-yellow-500/20', label: 'Medium' },
  LOW: { color: 'text-green-400', bg: 'bg-green-500/20', label: 'Low' },
};

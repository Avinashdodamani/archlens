/**
 * Complete list of all AWS regions with display names.
 * Used for the region selector dropdown across the application.
 */

export interface AWSRegion {
  code: string;
  name: string;
  displayName: string;
}

export const AWS_REGIONS: AWSRegion[] = [
  { code: 'us-east-1', name: 'US East (N. Virginia)', displayName: 'US East - N. Virginia' },
  { code: 'us-east-2', name: 'US East (Ohio)', displayName: 'US East - Ohio' },
  { code: 'us-west-1', name: 'US West (N. California)', displayName: 'US West - N. California' },
  { code: 'us-west-2', name: 'US West (Oregon)', displayName: 'US West - Oregon' },
  { code: 'af-south-1', name: 'Africa (Cape Town)', displayName: 'Africa - Cape Town' },
  { code: 'ap-east-1', name: 'Asia Pacific (Hong Kong)', displayName: 'Asia Pacific - Hong Kong' },
  { code: 'ap-south-1', name: 'Asia Pacific (Mumbai)', displayName: 'Asia Pacific - Mumbai' },
  { code: 'ap-south-2', name: 'Asia Pacific (Hyderabad)', displayName: 'Asia Pacific - Hyderabad' },
  { code: 'ap-southeast-1', name: 'Asia Pacific (Singapore)', displayName: 'Asia Pacific - Singapore' },
  { code: 'ap-southeast-2', name: 'Asia Pacific (Sydney)', displayName: 'Asia Pacific - Sydney' },
  { code: 'ap-southeast-3', name: 'Asia Pacific (Jakarta)', displayName: 'Asia Pacific - Jakarta' },
  { code: 'ap-southeast-4', name: 'Asia Pacific (Melbourne)', displayName: 'Asia Pacific - Melbourne' },
  { code: 'ap-northeast-1', name: 'Asia Pacific (Tokyo)', displayName: 'Asia Pacific - Tokyo' },
  { code: 'ap-northeast-2', name: 'Asia Pacific (Seoul)', displayName: 'Asia Pacific - Seoul' },
  { code: 'ap-northeast-3', name: 'Asia Pacific (Osaka)', displayName: 'Asia Pacific - Osaka' },
  { code: 'ca-central-1', name: 'Canada (Central)', displayName: 'Canada - Central' },
  { code: 'ca-west-1', name: 'Canada (Calgary)', displayName: 'Canada - Calgary' },
  { code: 'eu-central-1', name: 'Europe (Frankfurt)', displayName: 'Europe - Frankfurt' },
  { code: 'eu-central-2', name: 'Europe (Zurich)', displayName: 'Europe - Zurich' },
  { code: 'eu-west-1', name: 'Europe (Ireland)', displayName: 'Europe - Ireland' },
  { code: 'eu-west-2', name: 'Europe (London)', displayName: 'Europe - London' },
  { code: 'eu-west-3', name: 'Europe (Paris)', displayName: 'Europe - Paris' },
  { code: 'eu-south-1', name: 'Europe (Milan)', displayName: 'Europe - Milan' },
  { code: 'eu-south-2', name: 'Europe (Spain)', displayName: 'Europe - Spain' },
  { code: 'eu-north-1', name: 'Europe (Stockholm)', displayName: 'Europe - Stockholm' },
  { code: 'il-central-1', name: 'Israel (Tel Aviv)', displayName: 'Israel - Tel Aviv' },
  { code: 'me-south-1', name: 'Middle East (Bahrain)', displayName: 'Middle East - Bahrain' },
  { code: 'me-central-1', name: 'Middle East (UAE)', displayName: 'Middle East - UAE' },
  { code: 'sa-east-1', name: 'South America (São Paulo)', displayName: 'South America - São Paulo' },
];

export const ALL_REGIONS_OPTION = {
  code: 'all',
  name: 'All Regions',
  displayName: '🌐 All Regions (Multi-Region Scan)',
};

/**
 * AWS Official Architecture Diagram Theme Configuration
 * 
 * All colors extracted from the official AWS Architecture Icons PPT decks:
 *   - AWS-Architecture-Icons-Deck_For-Dark-BG_07312026.pptx
 *   - AWS-Architecture-Icons-Deck_For-Light-BG_07312026.pptx
 * 
 * When AWS updates icons/colors, replace the PPTs and update values here.
 * NO hardcoded defaults — everything sourced from the PPT decks.
 */

// ─── AWS Official Category Colors (extracted from PPT icon slides) ───────────

/** AWS Squid (#232F3E) — General, AWS Cloud boundary, Account */
export const AWS_COLOR_SQUID = '#232F3E';

/** AWS Gray (#7D8998) — Borders, neutral */
export const AWS_COLOR_GRAY = '#7D8998';

/** AWS Nebula (#C925D1) — Database, Developer Tools, Customer Enablement, Satellite */
export const AWS_COLOR_NEBULA = '#C925D1';

/** AWS Endor (#7AA116) — Storage, Cloud Financial Management, IoT */
export const AWS_COLOR_ENDOR = '#7AA116';

/** AWS Smile (#ED7100) — Compute, Containers, Blockchain, Media, Quantum */
export const AWS_COLOR_SMILE = '#ED7100';

/** AWS Cosmos (#E7157B) — Application Integration, Management & Governance */
export const AWS_COLOR_COSMOS = '#E7157B';

/** AWS Galaxy (#8C4FFF) — Networking & Content Delivery, Analytics, Serverless */
export const AWS_COLOR_GALAXY = '#8C4FFF';

/** AWS Mars (#DD344C) — Security, Identity & Compliance, Business Apps */
export const AWS_COLOR_MARS = '#DD344C';

/** AWS Orbit (#01A88D) — AI/ML, End User Computing, Migration */
export const AWS_COLOR_ORBIT = '#01A88D';


// ─── Service → Official Category Color Mapping ──────────────────────────────

export const AWS_SERVICE_COLORS: Record<string, string> = {
  // Compute (Smile/Orange)
  EC2: AWS_COLOR_SMILE,
  Lambda: AWS_COLOR_SMILE,
  ECS: AWS_COLOR_SMILE,
  EKS: AWS_COLOR_SMILE,

  // Storage (Endor/Green)
  S3: AWS_COLOR_ENDOR,

  // Database (Nebula/Purple-Pink)
  RDS: AWS_COLOR_NEBULA,
  Aurora: AWS_COLOR_NEBULA,
  DynamoDB: AWS_COLOR_NEBULA,

  // Networking & Content Delivery (Galaxy/Purple)
  VPC: AWS_COLOR_GALAXY,
  CloudFront: AWS_COLOR_GALAXY,
  ELB: AWS_COLOR_GALAXY,
  Route53: AWS_COLOR_GALAXY,
  Subnet: AWS_COLOR_GALAXY,
  InternetGateway: AWS_COLOR_GALAXY,
  NATGateway: AWS_COLOR_GALAXY,

  // Application Integration (Cosmos/Pink)
  APIGateway: AWS_COLOR_COSMOS,
  SNS: AWS_COLOR_COSMOS,
  SQS: AWS_COLOR_COSMOS,
  StepFunctions: AWS_COLOR_COSMOS,
  EventBridge: AWS_COLOR_COSMOS,

  // Security, Identity & Compliance (Mars/Red)
  IAM: AWS_COLOR_MARS,
  KMS: AWS_COLOR_MARS,
  Cognito: AWS_COLOR_MARS,
  SecurityGroup: AWS_COLOR_MARS,

  // AI & Machine Learning (Orbit/Turquoise)
  Bedrock: AWS_COLOR_ORBIT,

  // Management & Governance (Cosmos/Pink)
  CloudWatch: AWS_COLOR_COSMOS,

  // Developer Tools (Nebula)
  CodeBuild: AWS_COLOR_NEBULA,

  // SOW Appendix A additional services
  Neptune: AWS_COLOR_NEBULA,        // Database
  DocumentDB: AWS_COLOR_NEBULA,     // Database
  OpenSearch: AWS_COLOR_GALAXY,     // Analytics
  EMR: AWS_COLOR_GALAXY,            // Analytics
  GuardDuty: AWS_COLOR_MARS,        // Security
  WAF: AWS_COLOR_MARS,              // Security
  SecurityHub: AWS_COLOR_MARS,      // Security
  Config: AWS_COLOR_COSMOS,         // Management & Governance
  SystemsManager: AWS_COLOR_COSMOS, // Management & Governance
  TransitGateway: AWS_COLOR_GALAXY, // Networking
  FSx: AWS_COLOR_ENDOR,             // Storage
  Batch: AWS_COLOR_SMILE,           // Compute       // Compute
  AppSync: AWS_COLOR_COSMOS,        // Application Integration
};


// ─── AWS Group/Boundary Styles (from PPT Group Icons section) ────────────────

export interface GroupStyle {
  borderColor: string;
  borderStyle: 'solid' | 'dashed';
  borderWidth: number;
  backgroundColor: string;
  labelColor: string;
  label: string;
}

/** Dark theme group styles — extracted from Dark-BG PPT */
export const AWS_GROUP_STYLES_DARK: Record<string, GroupStyle> = {
  AWSCloud: {
    borderColor: AWS_COLOR_SQUID,
    borderStyle: 'solid',
    borderWidth: 2,
    backgroundColor: 'rgba(35, 47, 62, 0.3)',
    labelColor: '#FFFFFF',
    label: 'AWS Cloud',
  },
  Region: {
    borderColor: '#147EBA',
    borderStyle: 'dashed',
    borderWidth: 2,
    backgroundColor: 'rgba(20, 126, 186, 0.08)',
    labelColor: '#147EBA',
    label: 'Region',
  },
  VPC: {
    borderColor: AWS_COLOR_GALAXY,
    borderStyle: 'solid',
    borderWidth: 2,
    backgroundColor: 'rgba(140, 79, 255, 0.08)',
    labelColor: AWS_COLOR_GALAXY,
    label: 'VPC',
  },
  AvailabilityZone: {
    borderColor: '#147EBA',
    borderStyle: 'dashed',
    borderWidth: 1,
    backgroundColor: 'rgba(20, 126, 186, 0.05)',
    labelColor: '#147EBA',
    label: 'Availability Zone',
  },
  PublicSubnet: {
    borderColor: AWS_COLOR_ENDOR,
    borderStyle: 'dashed',
    borderWidth: 1,
    backgroundColor: 'rgba(122, 161, 22, 0.08)',
    labelColor: AWS_COLOR_ENDOR,
    label: 'Public subnet',
  },
  PrivateSubnet: {
    borderColor: '#147EBA',
    borderStyle: 'dashed',
    borderWidth: 1,
    backgroundColor: 'rgba(20, 126, 186, 0.08)',
    labelColor: '#147EBA',
    label: 'Private subnet',
  },
  SecurityGroup: {
    borderColor: AWS_COLOR_MARS,
    borderStyle: 'dashed',
    borderWidth: 1,
    backgroundColor: 'rgba(221, 52, 76, 0.05)',
    labelColor: AWS_COLOR_MARS,
    label: 'Security group',
  },
  TierIngress: {
    borderColor: AWS_COLOR_COSMOS,
    borderStyle: 'dashed',
    borderWidth: 1,
    backgroundColor: 'rgba(231, 21, 123, 0.05)',
    labelColor: AWS_COLOR_COSMOS,
    label: 'Ingress & API Management Tier',
  },
  TierCompute: {
    borderColor: AWS_COLOR_SMILE,
    borderStyle: 'dashed',
    borderWidth: 1,
    backgroundColor: 'rgba(237, 113, 0, 0.05)',
    labelColor: AWS_COLOR_SMILE,
    label: 'Serverless Compute & Orchestration Tier',
  },
  TierDatabase: {
    borderColor: AWS_COLOR_NEBULA,
    borderStyle: 'dashed',
    borderWidth: 1,
    backgroundColor: 'rgba(201, 37, 209, 0.05)',
    labelColor: AWS_COLOR_NEBULA,
    label: 'Database & Storage Layer',
  },
  TierMessaging: {
    borderColor: AWS_COLOR_COSMOS,
    borderStyle: 'dashed',
    borderWidth: 1,
    backgroundColor: 'rgba(231, 21, 123, 0.05)',
    labelColor: AWS_COLOR_COSMOS,
    label: 'Messaging & Event Integration',
  },
  SharedServices: {
    borderColor: AWS_COLOR_NEBULA,
    borderStyle: 'dashed',
    borderWidth: 1,
    backgroundColor: 'rgba(201, 37, 209, 0.05)',
    labelColor: AWS_COLOR_NEBULA,
    label: 'AWS Managed & Shared Services',
  },
};

/** Light theme group styles — extracted from Light-BG PPT */
export const AWS_GROUP_STYLES_LIGHT: Record<string, GroupStyle> = {
  AWSCloud: {
    borderColor: AWS_COLOR_SQUID,
    borderStyle: 'solid',
    borderWidth: 2,
    backgroundColor: 'rgba(35, 47, 62, 0.04)',
    labelColor: AWS_COLOR_SQUID,
    label: 'AWS Cloud',
  },
  Region: {
    borderColor: '#147EBA',
    borderStyle: 'dashed',
    borderWidth: 2,
    backgroundColor: 'rgba(20, 126, 186, 0.04)',
    labelColor: '#147EBA',
    label: 'Region',
  },
  VPC: {
    borderColor: AWS_COLOR_GALAXY,
    borderStyle: 'solid',
    borderWidth: 2,
    backgroundColor: 'rgba(140, 79, 255, 0.04)',
    labelColor: AWS_COLOR_GALAXY,
    label: 'VPC',
  },
  AvailabilityZone: {
    borderColor: '#147EBA',
    borderStyle: 'dashed',
    borderWidth: 1,
    backgroundColor: 'rgba(20, 126, 186, 0.03)',
    labelColor: '#147EBA',
    label: 'Availability Zone',
  },
  PublicSubnet: {
    borderColor: AWS_COLOR_ENDOR,
    borderStyle: 'dashed',
    borderWidth: 1,
    backgroundColor: 'rgba(122, 161, 22, 0.06)',
    labelColor: AWS_COLOR_ENDOR,
    label: 'Public subnet',
  },
  PrivateSubnet: {
    borderColor: '#147EBA',
    borderStyle: 'dashed',
    borderWidth: 1,
    backgroundColor: 'rgba(20, 126, 186, 0.06)',
    labelColor: '#147EBA',
    label: 'Private subnet',
  },
  SecurityGroup: {
    borderColor: AWS_COLOR_MARS,
    borderStyle: 'dashed',
    borderWidth: 1,
    backgroundColor: 'rgba(221, 52, 76, 0.04)',
    labelColor: AWS_COLOR_MARS,
    label: 'Security group',
  },
  TierIngress: {
    borderColor: AWS_COLOR_COSMOS,
    borderStyle: 'dashed',
    borderWidth: 1,
    backgroundColor: 'rgba(231, 21, 123, 0.03)',
    labelColor: AWS_COLOR_COSMOS,
    label: 'Ingress & API Management Tier',
  },
  TierCompute: {
    borderColor: AWS_COLOR_SMILE,
    borderStyle: 'dashed',
    borderWidth: 1,
    backgroundColor: 'rgba(237, 113, 0, 0.03)',
    labelColor: AWS_COLOR_SMILE,
    label: 'Serverless Compute & Orchestration Tier',
  },
  TierDatabase: {
    borderColor: AWS_COLOR_NEBULA,
    borderStyle: 'dashed',
    borderWidth: 1,
    backgroundColor: 'rgba(201, 37, 209, 0.03)',
    labelColor: AWS_COLOR_NEBULA,
    label: 'Database & Storage Layer',
  },
  TierMessaging: {
    borderColor: AWS_COLOR_COSMOS,
    borderStyle: 'dashed',
    borderWidth: 1,
    backgroundColor: 'rgba(231, 21, 123, 0.03)',
    labelColor: AWS_COLOR_COSMOS,
    label: 'Messaging & Event Integration',
  },
  SharedServices: {
    borderColor: AWS_COLOR_NEBULA,
    borderStyle: 'dashed',
    borderWidth: 1,
    backgroundColor: 'rgba(201, 37, 209, 0.03)',
    labelColor: AWS_COLOR_NEBULA,
    label: 'AWS Managed & Shared Services',
  },
};


// ─── Diagram Background Colors (from PPT) ───────────────────────────────────

export const DIAGRAM_BG_DARK = '#0d1117';
export const DIAGRAM_BG_LIGHT = '#FFFFFF';

export const DIAGRAM_GRID_DARK = '#1e293b';
export const DIAGRAM_GRID_LIGHT = '#e2e8f0';


// ─── Service Placement Rules (from AWS official documentation) ───────────────
// Services categorized by their network boundary placement.

/** Services that live OUTSIDE the VPC (global/edge services) */
export const SERVICES_OUTSIDE_VPC = new Set([
  'CloudFront', 'Route53', 'S3', 'IAM', 'Cognito', 'DynamoDB',
  'SNS', 'SQS', 'StepFunctions', 'EventBridge', 'Bedrock',
  'CloudWatch', 'CodeBuild', 'KMS', 'APIGateway',
]);

/** Services that live INSIDE VPC but outside specific subnets */
export const SERVICES_VPC_LEVEL = new Set([
  'VPC', 'SecurityGroup', 'InternetGateway', 'NATGateway',
]);

/** Services that live INSIDE subnets (placed within public or private) */
export const SERVICES_IN_SUBNET = new Set([
  'EC2', 'RDS', 'Aurora', 'ELB', 'ECS', 'EKS', 'Lambda',
]);

/**
 * Get group styles based on current theme
 */
export function getGroupStyles(isDark: boolean) {
  return isDark ? AWS_GROUP_STYLES_DARK : AWS_GROUP_STYLES_LIGHT;
}

/**
 * Get diagram background based on current theme
 */
export function getDiagramBackground(isDark: boolean) {
  return isDark ? DIAGRAM_BG_DARK : DIAGRAM_BG_LIGHT;
}

/**
 * Get grid color based on current theme
 */
export function getDiagramGridColor(isDark: boolean) {
  return isDark ? DIAGRAM_GRID_DARK : DIAGRAM_GRID_LIGHT;
}

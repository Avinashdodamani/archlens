/**
 * Central AWS service icon mapping.
 * Icons are extracted from the official AWS Architecture Icons PPT decks:
 *   /aws-icons/dark/  → Dark-BG PPT
 *   /aws-icons/light/ → Light-BG PPT
 *
 * Used by both the architecture diagram and dashboard resource distribution
 * so icons are consistent everywhere. Any resource type without a specific
 * mapping falls back to a generic resource icon and still renders (never dropped).
 */

const ICON_FILES: Record<string, string> = {
  EC2: 'arch-amazon-ec2-64.svg',
  Lambda: 'arch-aws-lambda-64.svg',
  S3: 'arch-amazon-simple-storage-service-64.svg',
  RDS: 'arch-amazon-rds-64.svg',
  Aurora: 'arch-amazon-rds-64.svg',
  DynamoDB: 'arch-amazon-dynamodb-64.svg',
  VPC: 'arch-amazon-virtual-private-cloud-64.svg',
  CloudFront: 'arch-amazon-cloudfront-64.svg',
  ELB: 'arch-elastic-load-balancing-64.svg',
  APIGateway: 'arch-amazon-api-gateway-64.svg',
  ECS: 'arch-amazon-elastic-container-service-64.svg',
  EKS: 'arch-amazon-elastic-kubernetes-service-64.svg',
  Route53: 'arch-amazon-route-53-64.svg',
  SNS: 'arch-amazon-simple-notification-service-64.svg',
  SQS: 'arch-amazon-simple-queue-service-64.svg',
  KMS: 'arch-aws-key-management-service-64.svg',
  CloudWatch: 'arch-amazon-cloudwatch-64.svg',
  IAM: 'arch-aws-identity-and-access-management-64.svg',
  Cognito: 'arch-amazon-cognito-64.svg',
  StepFunctions: 'arch-aws-step-functions-64.svg',
  Bedrock: 'arch-amazon-bedrock-64.svg',
  CodeBuild: 'arch-aws-codebuild-64.svg',
  EventBridge: 'arch-amazon-eventbridge-64.svg',
  ElastiCache: 'arch-amazon-elasticache-64.svg',
  EFS: 'arch-amazon-efs-64.svg',
  EBS: 'arch-amazon-elastic-block-store-64.svg',
  Redshift: 'arch-amazon-redshift-64.svg',
  Kinesis: 'arch-amazon-kinesis-64.svg',
  SageMaker: 'arch-amazon-sagemaker-64.svg',
  Glue: 'arch-aws-glue-64.svg',
  Athena: 'arch-amazon-athena-64.svg',
  CloudTrail: 'arch-aws-cloudtrail-64.svg',
  ElasticBeanstalk: 'arch-aws-elastic-beanstalk-64.svg',
  SecretsManager: 'arch-aws-secrets-manager-64.svg',
  AutoScaling: 'arch-amazon-ec2-auto-scaling-64.svg',
  SecurityGroup: 'arch-amazon-virtual-private-cloud-64.svg',
  Subnet: 'arch-amazon-virtual-private-cloud-64.svg',
  InternetGateway: 'arch-amazon-virtual-private-cloud-64.svg',
  NATGateway: 'arch-amazon-virtual-private-cloud-64.svg',
  RouteTable: 'arch-amazon-virtual-private-cloud-64.svg',
  Backup: 'arch-aws-backup-64.svg',
  Cost: 'arch-aws-cost-explorer-64.svg',
  // SOW Appendix A additional services
  Neptune: 'arch-amazon-neptune-64.svg',
  DocumentDB: 'arch-amazon-documentdb-64.svg',
  OpenSearch: 'arch-amazon-opensearch-service-64.svg',
  GuardDuty: 'arch-amazon-guardduty-64.svg',
  WAF: 'arch-aws-waf-64.svg',
  TransitGateway: 'arch-aws-transit-gateway-64.svg',
  SecurityHub: 'arch-aws-security-hub-64.svg',
  Config: 'arch-aws-config-64.svg',
  FSx: 'arch-amazon-fsx-64.svg',
  Batch: 'arch-aws-batch-64.svg',
  AppRunner: 'arch-aws-app-runner-64.svg',
  EMR: 'arch-amazon-emr-64.svg',
  AppSync: 'arch-aws-appsync-64.svg',
  SystemsManager: 'arch-aws-systems-manager-64.svg',
};

/**
 * Generic fallback icon for any service type we don't have a specific icon for.
 * Ensures unknown resource types still render (never silently dropped).
 * Uses a neutral AWS cloud icon present in both dark and light icon sets.
 */
const GENERIC_ICON = 'arch-aws-cloud-map-64.svg';

/**
 * Get the icon path for a resource type, theme-aware.
 * Returns a path that always resolves — unknown types get the generic icon.
 */
export function getServiceIconPath(type: string, isDark: boolean): string {
  const theme = isDark ? 'dark' : 'light';
  const file = ICON_FILES[type] || GENERIC_ICON;
  return `/aws-icons/${theme}/${file}`;
}

/**
 * Whether we have a specific (non-generic) icon for this type.
 */
export function hasSpecificIcon(type: string): boolean {
  return type in ICON_FILES;
}

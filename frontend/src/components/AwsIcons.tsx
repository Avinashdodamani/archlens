/**
 * AWS Official Architecture Icons Component
 * 
 * Uses the `aws-icons` npm package which is built from the OFFICIAL AWS Architecture Icons set.
 * Current version: Q2 2025
 * 
 * TO UPDATE ICONS:
 * When AWS releases new icons, simply run:
 *   npm update aws-icons
 * 
 * This will pull the latest official icon set. No manual download needed.
 * The icons are served from CDN (unpkg/jsdelivr) or bundled locally.
 * 
 * Icon source: https://aws.amazon.com/architecture/icons/
 * Package: https://www.npmjs.com/package/aws-icons
 */

/**
 * Map of ArchLens resource types to official AWS icon paths.
 * These paths correspond to SVG files in the aws-icons package.
 * Format: aws-icons/icons/<category>/<IconName>.svg
 */
const AWS_ICON_PATHS: Record<string, string> = {
  EC2: 'architecture-service/AmazonEC2',
  Lambda: 'architecture-service/AWSLambda',
  S3: 'architecture-service/AmazonSimpleStorageService',
  RDS: 'architecture-service/AmazonRDS',
  Aurora: 'architecture-service/AmazonAurora',
  DynamoDB: 'architecture-service/AmazonDynamoDB',
  VPC: 'architecture-service/AmazonVirtualPrivateCloud',
  CloudFront: 'architecture-service/AmazonCloudFront',
  ELB: 'architecture-service/ElasticLoadBalancing',
  APIGateway: 'architecture-service/AmazonAPIGateway',
  ECS: 'architecture-service/AmazonElasticContainerService',
  EKS: 'architecture-service/AmazonElasticKubernetesService',
  Route53: 'architecture-service/AmazonRoute53',
  SNS: 'architecture-service/AmazonSimpleNotificationService',
  SQS: 'architecture-service/AmazonSimpleQueueService',
  KMS: 'architecture-service/AWSKeyManagementService',
  ElastiCache: 'architecture-service/AmazonElastiCache',
  EFS: 'architecture-service/AmazonElasticFileSystem',
  CloudWatch: 'architecture-service/AmazonCloudWatch',
  IAM: 'architecture-service/AWSIdentityAccessManagement',
  Cognito: 'architecture-service/AmazonCognito',
  StepFunctions: 'architecture-service/AWSStepFunctions',
  Bedrock: 'architecture-service/AmazonBedrock',
  CodeBuild: 'architecture-service/AWSCodeBuild',
  SecurityGroup: 'resource/AmazonVPCSecurityGroup',
  Subnet: 'resource/AmazonVPCSubnet',
  InternetGateway: 'resource/AmazonVPCInternetGateway',
  NATGateway: 'resource/AmazonVPCNATGateway',
};

/**
 * CDN base URL for aws-icons package.
 * Using unpkg CDN which automatically serves the latest version.
 * Alternative: https://cdn.jsdelivr.net/npm/aws-icons@latest/icons/
 */
const CDN_BASE = 'https://unpkg.com/aws-icons@latest/icons';

/**
 * Get the CDN URL for an AWS service icon.
 * Falls back to a category icon if specific service icon not found.
 */
export function getAwsIconUrl(resourceType: string): string {
  const iconPath = AWS_ICON_PATHS[resourceType];
  if (iconPath) {
    return `${CDN_BASE}/${iconPath}.svg`;
  }
  // Fallback — generic AWS icon
  return `${CDN_BASE}/architecture-service/AWSCloud.svg`;
}

/**
 * AWS Icon component that renders the official icon from CDN.
 * Automatically loads the latest version.
 */
interface AwsIconProps {
  type: string;
  size?: number;
  className?: string;
}

export function AwsIcon({ type, size = 32, className = '' }: AwsIconProps) {
  const iconUrl = getAwsIconUrl(type);

  return (
    <img
      src={iconUrl}
      alt={`AWS ${type}`}
      width={size}
      height={size}
      className={`inline-block ${className}`}
      loading="lazy"
      onError={(e) => {
        // Fallback to text if icon fails to load
        const target = e.target as HTMLImageElement;
        target.style.display = 'none';
        const parent = target.parentElement;
        if (parent && !parent.querySelector('.icon-fallback')) {
          const fallback = document.createElement('div');
          fallback.className = 'icon-fallback w-8 h-8 rounded-lg bg-gray-600 flex items-center justify-center text-white text-[10px] font-bold';
          fallback.textContent = type.slice(0, 3);
          parent.appendChild(fallback);
        }
      }}
    />
  );
}

/**
 * Get all supported resource types with their icon URLs.
 * Useful for legends and documentation.
 */
export function getAllIconTypes(): Array<{ type: string; url: string }> {
  return Object.keys(AWS_ICON_PATHS).map(type => ({
    type,
    url: getAwsIconUrl(type),
  }));
}

export default AwsIcon;

import React, { useEffect, useState } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  ConnectionLineType,
  MarkerType,
  Position,
  Panel,
} from 'reactflow';
import 'reactflow/dist/style.css';
// elkjs ships its own types; the bundled entry has no declaration, so silence TS.
// @ts-ignore
import ELK from 'elkjs/lib/elk.bundled.js';
import { useAppStore, type DiagramViewMode } from '../store/useAppStore';
import {
  AWS_SERVICE_COLORS,
  getGroupStyles,
  getDiagramBackground,
  getDiagramGridColor,
} from '../config/aws-theme';
import { getServiceIconPath, getGroupIconPath } from '../config/aws-icon-map';
import { AWS_REGIONS } from '../config/aws-regions';

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface Resource {
  type: string;
  id: string;
  name: string;
  region?: string;
  vpc_id?: string;
  subnet_id?: string;
  availability_zone?: string;
  security_groups?: string[];
  tags?: Record<string, string>;
  public_ip?: string;
  encryption?: string;
  publicly_accessible?: boolean;
  storage_encrypted?: boolean;
  public_access_blocked?: boolean | string;
  map_public_ip?: boolean;
  is_public?: boolean;
  subnet_tier?: string;
  isRecommended?: boolean;
  [key: string]: unknown;
}

interface Relationship {
  source: string;
  source_type: string;
  target: string;
  target_type: string;
  relationship: string;
}

interface ArchitectureDiagramProps {
  resources: Resource[];
  relationships: Relationship[];
  servicesFootprint?: { service: string; monthly_cost_usd: number }[];
  viewMode?: DiagramViewMode;
}

// Custom group node to ensure boundary headers, icons, and titles render properly in ReactFlow
const CustomGroupNode: React.FC<{ data: { label?: React.ReactNode } }> = ({ data }) => {
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', pointerEvents: 'none' }}>
      {data?.label}
    </div>
  );
};

// ─── Constants ───────────────────────────────────────────────────────────────

const NODE_WIDTH = 165;
const NODE_HEIGHT = 100;
// Vertical space reserved at the top of each boundary for its label badge.
const LABEL_RESERVE = 36;

// Official AWS Service names for display in diagram nodes
const AWS_SERVICE_NAMES: Record<string, string> = {
  EC2: 'Amazon EC2',
  Lambda: 'AWS Lambda',
  S3: 'Amazon S3',
  RDS: 'Amazon RDS',
  Aurora: 'Amazon Aurora',
  DynamoDB: 'Amazon DynamoDB',
  VPC: 'Amazon VPC',
  CloudFront: 'Amazon CloudFront',
  ELB: 'Elastic Load Balancing',
  APIGateway: 'Amazon API Gateway',
  ECS: 'Amazon ECS',
  EKS: 'Amazon EKS',
  Route53: 'Amazon Route 53',
  SNS: 'Amazon SNS',
  SQS: 'Amazon SQS',
  KMS: 'AWS KMS',
  CloudWatch: 'Amazon CloudWatch',
  IAM: 'AWS IAM',
  Cognito: 'Amazon Cognito',
  StepFunctions: 'AWS Step Functions',
  Bedrock: 'Amazon Bedrock',
  CodeBuild: 'AWS CodeBuild',
  EventBridge: 'Amazon EventBridge',
  ElastiCache: 'Amazon ElastiCache',
  EFS: 'Amazon EFS',
  EBS: 'Amazon EBS',
  Redshift: 'Amazon Redshift',
  Kinesis: 'Amazon Kinesis',
  SageMaker: 'Amazon SageMaker',
  Glue: 'AWS Glue',
  Athena: 'Amazon Athena',
  CloudTrail: 'AWS CloudTrail',
  SecretsManager: 'AWS Secrets Manager',
  AutoScaling: 'EC2 Auto Scaling',
  SecurityGroup: 'Security Group',
  Subnet: 'VPC Subnet',
  InternetGateway: 'Internet Gateway',
  NATGateway: 'NAT Gateway',
  VPCEndpoint: 'VPC Endpoint',
  OpenSearch: 'Amazon OpenSearch',
  WAF: 'AWS WAF',
  TransitGateway: 'AWS Transit Gateway',
  SecurityHub: 'AWS Security Hub',
};

function getRegionDisplayName(code: string): string {
  const match = AWS_REGIONS.find((r) => r.code === code);
  return match ? match.name : code;
}

// Container/group types handled as boundary boxes, not leaf service nodes
const INFRASTRUCTURE_CONTAINER_TYPES = new Set([
  'VPC',
  'Subnet',
  'SecurityGroup',
]);

// Identity/plumbing/ops types that should NEVER appear as diagram nodes
const NON_DIAGRAM_TYPES = new Set([
  'IAM',
  'IAMUser',
  'IAMRole',
  'ACMCertificate',
  'Config',
  'NetworkInterface',
  'AMI',
  'Snapshot',
  'KeyPair',
  'ElasticIP',
  'DHCPOptions',
  'NetworkACL',
  'RouteTable',
  'CloudFormation',
  'CloudWatchLogs',
  'LogGroup',
  'SSMParameter',
  'SSMDocument',
  'CodeDeploy',
  'Cassandra',
  'AppConfig',
  'Route53Resolver',
  'ResourceExplorer2',
  'Scheduler',
  'Backup',
  'BackupPlan',
  'BackupVault',
  'CodeBuild',
]);

// Types that are conceptually global / edge — outside any specific AWS region
const GLOBAL_TYPES = new Set(['CloudFront', 'Route53', 'IAM']);

// Entry points where traffic ENTERS the account from the internet
const PUBLIC_FACING_TYPES = new Set(['Route53', 'CloudFront', 'InternetGateway', 'APIGateway', 'ELB']);

const INTERNET_ID = '__internet__';

// ─── ELK setup ───────────────────────────────────────────────────────────────

const elk = new ELK();

// Layout options shared by every container in the graph.
const ROOT_LAYOUT_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.layered.spacing.nodeNodeBetweenLayers': '60',
  'elk.spacing.nodeNode': '40',
  'elk.padding': '[top=40,left=30,bottom=30,right=30]',
};

// Container padding that reserves room for the boundary label at the top.
const containerLayoutOptions = (): Record<string, string> => ({
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.layered.spacing.nodeNodeBetweenLayers': '50',
  'elk.spacing.nodeNode': '40',
  'elk.padding': `[top=${LABEL_RESERVE + 22},left=26,bottom=24,right=26]`,
});

// Tier containers stack services side-by-side inside the tier
const tierLayoutOptions = (): Record<string, string> => ({
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.layered.spacing.nodeNodeBetweenLayers': '36',
  'elk.spacing.nodeNode': '26',
  'elk.padding': `[top=${LABEL_RESERVE + 20},left=22,bottom=20,right=22]`,
});

// AZ columns should sit side-by-side — lay their subnet bands out top-to-bottom
// but keep AZ siblings in a horizontal row (handled by the parent VPC's RIGHT flow).
const azRowLayoutOptions = (): Record<string, string> => ({
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.layered.spacing.nodeNodeBetweenLayers': '40',
  'elk.spacing.nodeNode': '30',
  'elk.padding': `[top=${LABEL_RESERVE + 18},left=22,bottom=22,right=22]`,
});

// ─── ELK graph types ─────────────────────────────────────────────────────────

interface ElkNode {
  id: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  layoutOptions?: Record<string, string>;
  children?: ElkNode[];
  edges?: Array<{ id: string; sources: string[]; targets: string[] }>;
  // Local metadata we attach to rebuild ReactFlow nodes after layout.
  __kind?: 'service' | 'boundary' | 'internet';
  __boundaryStyleKey?: string;
  __labelText?: string;
  __resource?: Resource;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getIconPath(type: string, isDark: boolean): string {
  return getServiceIconPath(type, isDark);
}

function getSecurityColor(resource: Resource): string {
  if (
    resource.public_ip ||
    resource.publicly_accessible === true ||
    resource.is_public === true ||
    resource.public_access_blocked === false ||
    resource.public_access_blocked === 'false'
  ) {
    return '#ef4444';
  }
  if (resource.encryption === 'Disabled' || resource.storage_encrypted === false) {
    return '#eab308';
  }
  return '#22c55e';
}

function truncateName(name: string, maxLen = 16): string {
  if (!name) return '';
  if (name.length <= maxLen) return name;
  return name.slice(0, maxLen - 1) + '…';
}

// Is this subnet a public tier? Handles both boolean and string discovery fields.
function isPublicSubnet(meta?: Resource): boolean {
  if (!meta) return false;
  if (meta.is_public === true || meta.map_public_ip === true) return true;
  const tier = (meta.subnet_tier || '').toLowerCase();
  return tier === 'public';
}

// ─── Data grouping → nested ELK graph ─────────────────────────────────────────

interface GroupContext {
  isDark: boolean;
  viewMode: DiagramViewMode;
  vpcMeta: Map<string, Resource>;
  subnetMeta: Map<string, Resource>;
}

// Build a leaf service ELK node (fixed size — elk positions it).
function serviceElkNode(r: Resource): ElkNode {
  return {
    id: r.id,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    __kind: 'service',
    __resource: r,
  };
}

// Build a boundary container ELK node.
function boundaryElkNode(
  id: string,
  styleKey: string,
  labelText: string,
  children: ElkNode[],
  layoutOptions: Record<string, string>
): ElkNode {
  return {
    id,
    __kind: 'boundary',
    __boundaryStyleKey: styleKey,
    __labelText: labelText,
    layoutOptions,
    children,
  };
}

function buildCloudChildren(
  serviceResources: Resource[],
  ctx: GroupContext
): ElkNode[] {
  const cloudChildren: ElkNode[] = [];

  // 1. Separate true global services (Route53, CloudFront) vs regional services
  const globalResources: Resource[] = [];
  const regionalResources: Resource[] = [];

  for (const r of serviceResources) {
    const isGlobal = GLOBAL_TYPES.has(r.type) || r.region === 'global';
    if (isGlobal) globalResources.push(r);
    else regionalResources.push(r);
  }

  // 2. Global Edge services container
  if (globalResources.length > 0) {
    cloudChildren.push(
      boundaryElkNode(
        '__global_edge_tier__',
        'AWSCloud',
        'Global Edge & Content Delivery (Route 53 · CloudFront)',
        globalResources.map(serviceElkNode),
        tierLayoutOptions()
      )
    );
  }

  // 3. Group regional resources by region
  const regionGroups = new Map<string, Resource[]>();
  for (const r of regionalResources) {
    const region = (r.region as string) || 'default-region';
    if (!regionGroups.has(region)) regionGroups.set(region, []);
    regionGroups.get(region)!.push(r);
  }

  for (const [regionName, regionResources] of regionGroups.entries()) {
    const regionChildren: ElkNode[] = [];
    const vpcGroups = new Map<string, Resource[]>();
    const regionalNonVpc: Resource[] = [];

    // Ensure all discovered VPCs in this region from ctx.vpcMeta are tracked
    for (const [vpcId, vpcRes] of ctx.vpcMeta.entries()) {
      if ((vpcRes.region || 'default-region') === regionName || !vpcRes.region) {
        if (!vpcGroups.has(vpcId)) vpcGroups.set(vpcId, []);
      }
    }

    for (const r of regionResources) {
      if (r.vpc_id) {
        const vpcId = r.vpc_id as string;
        if (!vpcGroups.has(vpcId)) vpcGroups.set(vpcId, []);
        vpcGroups.get(vpcId)!.push(r);
      } else {
        regionalNonVpc.push(r);
      }
    }

    // Categorize regional non-VPC resources into standard AWS architecture tiers
    const ingressRes: Resource[] = [];
    const computeRes: Resource[] = [];
    const databaseRes: Resource[] = [];
    const messagingRes: Resource[] = [];
    const otherRes: Resource[] = [];

    for (const r of regionalNonVpc) {
      if (r.type === 'APIGateway' || r.type === 'Cognito') {
        ingressRes.push(r);
      } else if (r.type === 'Lambda' || r.type === 'StepFunctions' || r.type === 'Bedrock') {
        computeRes.push(r);
      } else if (r.type === 'DynamoDB' || r.type === 'S3' || r.type === 'ElastiCache' || r.type === 'RDS') {
        databaseRes.push(r);
      } else if (r.type === 'EventBridge' || r.type === 'SQS' || r.type === 'SNS') {
        messagingRes.push(r);
      } else {
        otherRes.push(r);
      }
    }

    // Tier 1: Ingress & API Management Tier
    if (ingressRes.length > 0) {
      regionChildren.push(
        boundaryElkNode(
          `__tier_ingress_${regionName}__`,
          'TierIngress',
          'Ingress & API Management Tier',
          ingressRes.map(serviceElkNode),
          tierLayoutOptions()
        )
      );
    }

    // Tier 2: Serverless Compute & Orchestration Tier
    if (computeRes.length > 0) {
      regionChildren.push(
        boundaryElkNode(
          `__tier_compute_${regionName}__`,
          'TierCompute',
          'Serverless Compute & App Services',
          computeRes.map(serviceElkNode),
          tierLayoutOptions()
        )
      );
    }

    // Tier 3: Database & Storage Layer
    if (databaseRes.length > 0) {
      regionChildren.push(
        boundaryElkNode(
          `__tier_database_${regionName}__`,
          'TierDatabase',
          'Database & Storage Layer',
          databaseRes.map(serviceElkNode),
          tierLayoutOptions()
        )
      );
    }

    // Tier 4: Messaging & Event Integration Tier
    if (messagingRes.length > 0) {
      regionChildren.push(
        boundaryElkNode(
          `__tier_messaging_${regionName}__`,
          'TierMessaging',
          'Messaging & Event Integration',
          messagingRes.map(serviceElkNode),
          tierLayoutOptions()
        )
      );
    }

    // Other non-VPC resources
    for (const r of otherRes) {
      regionChildren.push(serviceElkNode(r));
    }

    // Tier 5: VPC Containers inside the Region
    for (const [vpcId, vpcResources] of vpcGroups.entries()) {
      const vpcChildren: ElkNode[] = [];

      // Track subnets
      const bySubnet = new Map<string, Resource[]>();
      for (const [subnetId, subnetRes] of ctx.subnetMeta.entries()) {
        if (subnetRes.vpc_id === vpcId) {
          if (!bySubnet.has(subnetId)) bySubnet.set(subnetId, []);
        }
      }

      // VPC-level resources (InternetGateway, SecurityGroup, etc.)
      const vpcLevelResources: Resource[] = [];
      for (const r of vpcResources) {
        if (r.subnet_id) {
          if (!bySubnet.has(r.subnet_id)) bySubnet.set(r.subnet_id, []);
          bySubnet.get(r.subnet_id)!.push(r);
        } else {
          vpcLevelResources.push(r);
        }
      }

      // VPC-level leaves placed at VPC ingress level
      for (const r of vpcLevelResources) {
        vpcChildren.push(serviceElkNode(r));
      }

      // Group subnets by availability zone
      const byAz = new Map<string, Array<[string, Resource[]]>>();
      for (const [subnetId, subnetResources] of bySubnet.entries()) {
        const meta = ctx.subnetMeta.get(subnetId);
        const az =
          meta?.availability_zone ||
          (subnetResources[0] && subnetResources[0].availability_zone) ||
          'az-a';
        if (!byAz.has(az)) byAz.set(az, []);
        byAz.get(az)!.push([subnetId, subnetResources]);
      }

      const azNames = Array.from(byAz.keys()).sort((a, b) => a.localeCompare(b));

      for (const azName of azNames) {
        const subnetEntries = byAz.get(azName)!;
        subnetEntries.sort((a, b) => {
          const aPub = isPublicSubnet(ctx.subnetMeta.get(a[0])) ? 0 : 1;
          const bPub = isPublicSubnet(ctx.subnetMeta.get(b[0])) ? 0 : 1;
          return aPub - bPub;
        });

        const azSubnetContainers: ElkNode[] = [];

        for (const [subnetId, subnetResources] of subnetEntries) {
          const meta = ctx.subnetMeta.get(subnetId);
          const isPublic = isPublicSubnet(meta);
          const styleKey = isPublic ? 'PublicSubnet' : 'PrivateSubnet';
          const subnetTitle = isPublic ? 'Public Subnet' : 'Private Subnet';
          const subnetName = meta?.name && meta.name !== subnetId ? `${meta.name} · ` : '';
          const subnetCidr = meta?.cidr_block || subnetId;
          const subnetLabel = `${subnetTitle}: ${subnetName}${subnetCidr} (${azName})`;

          const subnetLeaves = subnetResources.length > 0
            ? subnetResources.map((r) => serviceElkNode(r))
            : [
                {
                  id: `__subnet_badge_${subnetId}__`,
                  width: 140,
                  height: 50,
                  __kind: 'service' as const,
                  __resource: {
                    type: isPublic ? 'PublicSubnet' : 'PrivateSubnet',
                    id: `__subnet_badge_${subnetId}__`,
                    name: meta?.cidr_block || 'Active Subnet',
                    is_public: isPublic,
                    region: regionName,
                    vpc_id: vpcId,
                    subnet_id: subnetId,
                  },
                }
              ];

          azSubnetContainers.push(
            boundaryElkNode(
              `__subnet_${subnetId}__`,
              styleKey,
              subnetLabel,
              subnetLeaves,
              containerLayoutOptions()
            )
          );
        }

        // AZ container holds its subnet bands stacked vertically
        vpcChildren.push(
          boundaryElkNode(
            `__az_${vpcId}_${azName}__`,
            'AvailabilityZone',
            `Availability Zone: ${azName}`,
            azSubnetContainers,
            azRowLayoutOptions()
          )
        );
      }

      const vpcMetaRes = ctx.vpcMeta.get(vpcId);
      const vpcName = vpcMetaRes?.name && vpcMetaRes.name !== vpcId ? `${vpcMetaRes.name} · ` : '';
      const vpcCidr = vpcMetaRes?.cidr_block ? ` · CIDR: ${vpcMetaRes.cidr_block}` : '';
      const vpcLabel = `VPC: ${vpcName}${vpcId}${vpcCidr}`;

      regionChildren.push(
        boundaryElkNode(
          `__vpc_${vpcId}__`,
          'VPC',
          vpcLabel,
          vpcChildren,
          containerLayoutOptions()
        )
      );
    }

    const regionDisplay = getRegionDisplayName(regionName);
    const regionLabel = regionDisplay && regionDisplay !== regionName
      ? `AWS Region: ${regionName} (${regionDisplay})`
      : `AWS Region: ${regionName}`;

    cloudChildren.push(
      boundaryElkNode(
        `__region_${regionName}__`,
        'Region',
        regionLabel,
        regionChildren,
        containerLayoutOptions()
      )
    );
  }

  return cloudChildren;
}

// ─── ELK → ReactFlow conversion ────────────────────────────────────────────────

function serviceNodeData(r: Resource, isDark: boolean, costUsd?: number) {
  if (r.id.startsWith('__subnet_badge_')) {
    const isPublic = r.is_public;
    return {
      label: (
        <div style={{ textAlign: 'center', padding: '6px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: isPublic ? '#7aa116' : '#147eba' }}>
            {r.name}
          </div>
          <div style={{ fontSize: '9px', color: isDark ? '#94a3b8' : '#64748b', marginTop: '2px' }}>
            {isPublic ? 'Public Subnet CIDR' : 'Private Subnet CIDR'}
          </div>
        </div>
      ),
    };
  }

  const iconPath = getIconPath(r.type, isDark);
  const officialServiceName = AWS_SERVICE_NAMES[r.type] || r.type;

  return {
    label: (
      <div style={{ textAlign: 'center', padding: '6px 8px', overflow: 'hidden', position: 'relative', width: '100%' }}>
        {r.isRecommended && (
          <span
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              fontSize: '8px',
              fontWeight: 700,
              background: '#22c55e',
              color: '#ffffff',
              padding: '1px 4px',
              borderRadius: '4px',
              zIndex: 10,
            }}
            title="Recommended by AWS Well-Architected Framework"
          >
            +WAF
          </span>
        )}
        {iconPath && (
          <img
            src={iconPath}
            alt=""
            aria-hidden="true"
            style={{ width: '36px', height: '36px', margin: '0 auto', objectFit: 'contain' }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
          />
        )}
        <div
          style={{
            fontSize: '11px',
            fontWeight: 600,
            color: isDark ? '#f1f5f9' : '#0f172a',
            marginTop: '3px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={r.name}
        >
          {truncateName(r.name, 18)}
        </div>
        <div
          style={{
            fontSize: '9px',
            fontWeight: 500,
            color: isDark ? '#94a3b8' : '#64748b',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={officialServiceName}
        >
          {officialServiceName}
        </div>
        {costUsd !== undefined && costUsd > 0 && (
          <div style={{ fontSize: '9px', fontWeight: 700, color: '#22c55e', marginTop: '1px' }}>
            ${costUsd.toFixed(0)}/mo
          </div>
        )}
      </div>
    ),
  };
}

function boundaryNodeData(labelText: string, labelColor: string, styleKey: string, isDark: boolean) {
  const groupIcon = getGroupIconPath(styleKey, isDark);
  return {
    label: (
      <div
        style={{
          position: 'absolute',
          top: 6,
          left: 10,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '4px 10px',
          borderRadius: '6px',
          backgroundColor: isDark ? 'rgba(15, 23, 42, 0.92)' : 'rgba(255, 255, 255, 0.95)',
          border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)'}`,
          boxShadow: isDark ? '0 2px 8px rgba(0,0,0,0.5)' : '0 2px 6px rgba(0,0,0,0.06)',
          backdropFilter: 'blur(6px)',
          pointerEvents: 'none',
          zIndex: 10,
        }}
      >
        {groupIcon && (
          <img
            src={groupIcon}
            alt=""
            aria-hidden="true"
            style={{ width: '18px', height: '18px', objectFit: 'contain' }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        )}
        <span
          style={{
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.3px',
            color: labelColor || (isDark ? '#f8fafc' : '#0f172a'),
            whiteSpace: 'nowrap',
          }}
        >
          {labelText}
        </span>
      </div>
    ),
  };
}

/**
 * Walk the laid-out ELK tree and emit ReactFlow nodes. ELK gives coordinates
 * relative to the parent, which is exactly what ReactFlow expects for children.
 * Parents are pushed before children (ReactFlow requirement).
 */
function elkToReactFlow(
  root: ElkNode,
  isDark: boolean,
  viewMode: DiagramViewMode,
  costMap: Map<string, number> = new Map(),
  maxCost = 0
): Node[] {
  const nodes: Node[] = [];
  const groupStyles = getGroupStyles(isDark);
  const isSecurity = viewMode === 'security';

  const walk = (node: ElkNode, parentId?: string) => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;

    if (node.__kind === 'internet') {
      nodes.push({
        id: node.id,
        type: 'default',
        position: { x, y },
        ...(parentId ? { parentNode: parentId, extent: 'parent' as const } : {}),
        data: {
          label: (
            <div style={{ textAlign: 'center', padding: '8px' }}>
              <div style={{ fontSize: '24px' }}>🌐</div>
              <div
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: isDark ? '#e2e8f0' : '#334155',
                  marginTop: '4px',
                }}
              >
                Internet / Users
              </div>
            </div>
          ),
        },
        style: {
          width: node.width ?? NODE_WIDTH,
          height: node.height ?? NODE_HEIGHT,
          background: isDark ? '#1e293b' : '#ffffff',
          border: `2px solid ${isDark ? '#475569' : '#94a3b8'}`,
          borderRadius: '10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
      });
      return;
    }

    if (node.__kind === 'service' && node.__resource) {
      const r = node.__resource;

      if (r.id.startsWith('__subnet_badge_')) {
        nodes.push({
          id: r.id,
          type: 'default',
          position: { x, y },
          ...(parentId ? { parentNode: parentId, extent: 'parent' as const } : {}),
          data: serviceNodeData(r, isDark),
          style: {
            width: node.width ?? 140,
            height: node.height ?? 50,
            background: isDark ? 'rgba(30, 41, 59, 0.3)' : 'rgba(241, 245, 249, 0.6)',
            border: `1px dashed ${isDark ? '#475569' : '#cbd5e1'}`,
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          },
          selectable: false,
        });
        return;
      }

      let borderColor = AWS_SERVICE_COLORS[r.type] || '#64748b';
      let boxShadow: string | undefined;
      if (isSecurity) {
        borderColor = getSecurityColor(r);
        boxShadow = `0 0 8px ${borderColor}80`;
      } else if (r.isRecommended) {
        borderColor = '#22c55e';
        boxShadow = '0 0 10px rgba(34, 197, 94, 0.6)';
      }

      // Cost View: size the node by its service's monthly cost + show $.
      const isCost = viewMode === 'cost';
      const costUsd = isCost ? costMap.get(r.type) : undefined;
      let extraW = 0;
      let extraH = 0;
      if (isCost && costUsd && maxCost > 0) {
        const scale = Math.min(costUsd / maxCost, 1); // 0..1
        extraW = Math.round(scale * 60);
        extraH = Math.round(scale * 40);
        borderColor = '#22c55e';
        boxShadow = `0 0 ${4 + scale * 12}px #22c55e80`;
      }

      nodes.push({
        id: r.id,
        type: 'default',
        position: { x, y },
        ...(parentId ? { parentNode: parentId, extent: 'parent' as const } : {}),
        data: serviceNodeData(r, isDark, costUsd),
        style: {
          width: (node.width ?? NODE_WIDTH) + extraW,
          height: (node.height ?? NODE_HEIGHT) + extraH,
          background: isDark ? '#1e293b' : '#ffffff',
          border: `${isSecurity || isCost || r.isRecommended ? 3 : 2}px solid ${borderColor}`,
          borderRadius: '10px',
          ...(boxShadow ? { boxShadow } : {}),
        },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
      });
      return;
    }

    // Boundary container
    if (node.__kind === 'boundary') {
      const styleKey = node.__boundaryStyleKey || 'VPC';
      const style = groupStyles[styleKey] || groupStyles.VPC;

      nodes.push({
        id: node.id,
        type: 'group',
        position: { x, y },
        ...(parentId ? { parentNode: parentId, extent: 'parent' as const } : {}),
        data: boundaryNodeData(node.__labelText || style.label, style.labelColor, styleKey, isDark),
        style: {
          width: node.width ?? NODE_WIDTH,
          height: node.height ?? NODE_HEIGHT,
          border: `${style.borderWidth}px ${style.borderStyle} ${style.borderColor}`,
          borderRadius: '10px',
          backgroundColor: style.backgroundColor,
        },
        selectable: false,
      });

      // Children come after the parent
      for (const child of node.children || []) {
        walk(child, node.id);
      }
    }
  };

  // Root is the AWS Cloud boundary — emit it, then its subtree.
  walk(root, undefined);
  return nodes;
}

// ─── Edges ─────────────────────────────────────────────────────────────────────

function buildEdges(
  serviceResources: Resource[],
  relationships: Relationship[],
  isDark: boolean,
  hasInternet: boolean,
  viewMode: DiagramViewMode = 'logical'
): Edge[] {
  const isDataFlow = viewMode === 'dataflow';
  const flowColor = isDark ? '#38bdf8' : '#0284c7';
  const strokeColor = isDataFlow ? flowColor : (isDark ? '#64748b' : '#94a3b8');
  const edges: Edge[] = [];
  const nodeIds = new Set(serviceResources.map((r) => r.id));
  const edgeSet = new Set<string>();

  const addEdge = (src: string, tgt: string, label?: string, dashed = false) => {
    if (!nodeIds.has(src) && src !== INTERNET_ID) return;
    if (!nodeIds.has(tgt)) return;
    if (src === tgt) return;
    const key = `${src}->${tgt}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);

    edges.push({
      id: `edge-${edges.length}`,
      source: src,
      target: tgt,
      type: 'smoothstep',
      animated: isDataFlow || src === INTERNET_ID,
      style: {
        stroke: dashed ? (isDark ? '#475569' : '#94a3b8') : strokeColor,
        strokeWidth: isDataFlow ? 2.5 : 1.5,
        ...(dashed ? { strokeDasharray: '5 4' } : {}),
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: dashed ? (isDark ? '#475569' : '#94a3b8') : strokeColor,
        width: 14,
        height: 14,
      },
      ...(label ? {
        label,
        labelStyle: { fontSize: 9, fill: isDark ? '#94a3b8' : '#64748b' },
        labelBgStyle: { fill: isDark ? '#1e293b' : '#ffffff', fillOpacity: 0.8 },
      } : {}),
    });
  };

  // 1. Discovered real relationships from AWS configuration
  for (const rel of relationships) {
    if (nodeIds.has(rel.source) && nodeIds.has(rel.target)) {
      addEdge(rel.source, rel.target, rel.relationship);
    }
  }

  // 2. Resource category lists
  const route53List = serviceResources.filter((r) => r.type === 'Route53');
  const cloudFrontList = serviceResources.filter((r) => r.type === 'CloudFront');
  const igwList = serviceResources.filter((r) => r.type === 'InternetGateway');
  const elbList = serviceResources.filter((r) => r.type === 'ELB');
  const apiGwList = serviceResources.filter((r) => r.type === 'APIGateway');
  const cognitoList = serviceResources.filter((r) => r.type === 'Cognito');
  const lambdaList = serviceResources.filter((r) => r.type === 'Lambda');
  const dynamoList = serviceResources.filter((r) => r.type === 'DynamoDB');
  const s3List = serviceResources.filter((r) => r.type === 'S3');
  const sqsList = serviceResources.filter((r) => r.type === 'SQS');
  const snsList = serviceResources.filter((r) => r.type === 'SNS');
  const stepFunctions = serviceResources.filter((r) => r.type === 'StepFunctions');
  const eventList = serviceResources.filter((r) => r.type === 'EventBridge');
  const bedrockList = serviceResources.filter((r) => r.type === 'Bedrock');
  const ec2List = serviceResources.filter((r) => r.type === 'EC2');
  const ecsList = serviceResources.filter((r) => r.type === 'ECS' || r.type === 'EKS');
  const rdsList = serviceResources.filter((r) => r.type === 'RDS' || r.type === 'Aurora');
  const cacheList = serviceResources.filter((r) => r.type === 'ElastiCache');
  const natList = serviceResources.filter((r) => r.type === 'NATGateway');
  const kmsList = serviceResources.filter((r) => r.type === 'KMS');
  const secretsList = serviceResources.filter((r) => r.type === 'SecretsManager');

  if (hasInternet) {
    // Route 53 (DNS resolution)
    if (route53List.length > 0) {
      for (const r53 of route53List) addEdge(INTERNET_ID, r53.id, 'DNS Query', true);
      for (const r53 of route53List) {
        for (const cf of cloudFrontList) addEdge(r53.id, cf.id, 'Alias Target', false);
        if (cloudFrontList.length === 0) {
          for (const elb of elbList) addEdge(r53.id, elb.id, 'A Record', false);
          for (const gw of apiGwList) addEdge(r53.id, gw.id, 'Custom Domain', false);
        }
      }
    }

    // Direct Internet Ingress to Public Facing Services
    if (cloudFrontList.length > 0) {
      for (const cf of cloudFrontList) addEdge(INTERNET_ID, cf.id, 'HTTPS (CDN)', true);
    }
    if (apiGwList.length > 0) {
      for (const gw of apiGwList) addEdge(INTERNET_ID, gw.id, 'API Calls (REST/HTTP)', true);
    }
    if (elbList.length > 0) {
      for (const elb of elbList) addEdge(INTERNET_ID, elb.id, 'HTTPS Request', true);
    }
    if (igwList.length > 0 && elbList.length === 0) {
      for (const igw of igwList) addEdge(INTERNET_ID, igw.id, 'VPC Ingress', true);
    }

    // CloudFront to Origins (S3, APIGateway, ELB)
    for (const cf of cloudFrontList) {
      for (const elb of elbList) addEdge(cf.id, elb.id, 'ALB Origin', false);
      for (const gw of apiGwList) addEdge(cf.id, gw.id, 'API Origin', false);
      // S3 static web origin
      const webS3 = s3List.filter((r) =>
        r.name.includes('frontend') || r.name.includes('web') || r.name.includes('site') || r.name.includes('ui') || r.name.includes('app')
      );
      const targetS3 = webS3.length > 0 ? webS3 : s3List.slice(0, 2);
      for (const s3 of targetS3) addEdge(cf.id, s3.id, 'Origin Access (OAC)', false);
    }

    // Cognito -> API Gateway / ELB (Authentication)
    for (const cog of cognitoList) {
      for (const gw of apiGwList) addEdge(cog.id, gw.id, 'User Pool / JWT Auth', true);
      for (const elb of elbList) addEdge(cog.id, elb.id, 'OIDC Auth', true);
    }
  }

  // 3. API Gateway -> Compute (Lambda)
  for (const gw of apiGwList) {
    const targetLambdas = lambdaList.length <= 6 ? lambdaList : lambdaList.slice(0, 5);
    for (const l of targetLambdas) {
      addEdge(gw.id, l.id, 'Proxy Integration');
    }
  }

  // 4. ELB -> Compute (EC2 / ECS / EKS)
  for (const elb of elbList) {
    const ec2Targets = ec2List.filter((c) => !elb.vpc_id || !c.vpc_id || c.vpc_id === elb.vpc_id);
    for (const tgt of ec2Targets) addEdge(elb.id, tgt.id, 'Target Group (HTTP)');
    const ecsTargets = ecsList.filter((c) => !elb.vpc_id || !c.vpc_id || c.vpc_id === elb.vpc_id);
    for (const tgt of ecsTargets) addEdge(elb.id, tgt.id, 'Target Group (Containers)');
  }

  // 5. Orchestration (Step Functions & EventBridge)
  for (const sf of stepFunctions) {
    const targetLambdas = lambdaList.length <= 4 ? lambdaList : lambdaList.slice(0, 3);
    for (const l of targetLambdas) addEdge(sf.id, l.id, 'State Machine Task');
  }

  for (const ev of eventList) {
    for (const sf of stepFunctions) addEdge(ev.id, sf.id, 'Scheduled Trigger');
    for (const s of snsList) addEdge(ev.id, s.id, 'Event Rule Target');
    for (const q of sqsList) addEdge(ev.id, q.id, 'Event Target');
    if (stepFunctions.length === 0 && snsList.length === 0) {
      for (const l of lambdaList.slice(0, 2)) addEdge(ev.id, l.id, 'Scheduled Event');
    }
  }

  // 6. Messaging Fanout (SNS -> SQS / Lambda)
  for (const s of snsList) {
    for (const q of sqsList) addEdge(s.id, q.id, 'Subscription Fanout');
    for (const l of lambdaList.slice(0, 2)) addEdge(s.id, l.id, 'Notification Trigger');
  }

  // 7. SQS -> Consumers (Lambda / EC2)
  for (const q of sqsList) {
    const workerLambdas = lambdaList.filter((l) =>
      l.name.includes('worker') || l.name.includes('process') || l.name.includes('queue') || l.name.includes('consumer')
    );
    const toTrigger = workerLambdas.length > 0 ? workerLambdas : lambdaList.slice(0, 2);
    for (const l of toTrigger) addEdge(q.id, l.id, 'Poll & Consume');
  }

  // 8. Compute -> Bedrock AI Inference
  if (bedrockList.length > 0) {
    const aiCallers = lambdaList.filter((l) =>
      l.name.includes('analyzer') || l.name.includes('ai') || l.name.includes('chat') || l.name.includes('gen') || l.name.includes('bedrock')
    );
    const toConnectBedrock = aiCallers.length > 0 ? aiCallers : (lambdaList.length > 0 ? lambdaList.slice(0, 2) : ec2List.slice(0, 1));
    for (const src of toConnectBedrock) {
      for (const b of bedrockList) addEdge(src.id, b.id, 'Model Invocation / RAG');
    }
  }

  // 9. Compute -> Databases & Storage
  // Lambda -> DynamoDB & S3
  for (const l of lambdaList) {
    if (dynamoList.length > 0) {
      const matchedTables = dynamoList.filter((d) => {
        const dBase = d.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        const lBase = l.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        return lBase.includes(dBase) || dBase.includes(lBase);
      });
      const toConnectDyn = matchedTables.length > 0 ? matchedTables : dynamoList.slice(0, 2);
      for (const d of toConnectDyn) {
        addEdge(l.id, d.id, 'Put/Get Item');
      }
    }

    if (s3List.length > 0) {
      const dataBuckets = s3List.filter((s) => !s.name.includes('frontend') && !s.name.includes('web'));
      const buckets = dataBuckets.length > 0 ? dataBuckets : s3List;
      for (const s of buckets.slice(0, 2)) {
        addEdge(l.id, s.id, 'S3 Get/Put Object');
      }
    }
  }

  // EC2 / ECS -> RDS, ElastiCache, S3
  const computeFleet = [...ec2List, ...ecsList];
  for (const cmp of computeFleet) {
    // RDS
    const matchingRds = rdsList.filter((d) => !cmp.vpc_id || !d.vpc_id || d.vpc_id === cmp.vpc_id);
    const rdsTargets = matchingRds.length > 0 ? matchingRds : rdsList;
    for (const rds of rdsTargets) {
      addEdge(cmp.id, rds.id, 'SQL Queries (Port 5432/3306)');
    }

    // ElastiCache
    const matchingCache = cacheList.filter((c) => !cmp.vpc_id || !c.vpc_id || cmp.vpc_id === c.vpc_id);
    const cacheTargets = matchingCache.length > 0 ? matchingCache : cacheList;
    for (const c of cacheTargets) {
      addEdge(cmp.id, c.id, 'Redis/Memcached');
    }

    // S3 data storage
    const dataBuckets = s3List.filter((s) => !s.name.includes('frontend') && !s.name.includes('web'));
    if (dataBuckets.length > 0) {
      for (const s of dataBuckets.slice(0, 1)) {
        addEdge(cmp.id, s.id, 'Storage API');
      }
    }

    // Outbound NAT for private subnets
    if (cmp.vpc_id) {
      const vpcNats = natList.filter((n) => n.vpc_id === cmp.vpc_id);
      for (const nat of vpcNats) {
        addEdge(cmp.id, nat.id, 'Outbound Route', true);
      }
    }
  }

  // 10. Security & Secrets (KMS / Secrets Manager)
  if (kmsList.length > 0) {
    const kmsTarget = kmsList[0];
    if (rdsList.length > 0) addEdge(rdsList[0].id, kmsTarget.id, 'KMS CMK Encryption');
    if (s3List.length > 0) addEdge(s3List[0].id, kmsTarget.id, 'SSE-KMS Key');
  }
  if (secretsList.length > 0) {
    const secretTarget = secretsList[0];
    if (computeFleet.length > 0) addEdge(computeFleet[0].id, secretTarget.id, 'Fetch DB Creds');
    else if (lambdaList.length > 0) addEdge(lambdaList[0].id, secretTarget.id, 'Fetch Secret');
  }

  // 11. VPC Gateways (NAT -> IGW)
  for (const nat of natList) {
    const vpcIgws = igwList.filter((i) => !nat.vpc_id || i.vpc_id === nat.vpc_id);
    const targets = vpcIgws.length > 0 ? vpcIgws : igwList;
    for (const igw of targets) {
      addEdge(nat.id, igw.id, 'Egress NAT Route', true);
    }
  }

  return edges;
}

// ─── Build + layout (async) ────────────────────────────────────────────────────

async function buildAndLayout(
  resources: Resource[],
  relationships: Relationship[],
  isDark: boolean,
  viewMode: DiagramViewMode,
  servicesFootprint: { service: string; monthly_cost_usd: number }[] = []
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  const serviceResources = resources.filter(
    (r) => !INFRASTRUCTURE_CONTAINER_TYPES.has(r.type) && !NON_DIAGRAM_TYPES.has(r.type)
  );

  if (serviceResources.length === 0) {
    return { nodes: [], edges: [] };
  }

  // Cost View: map each resource TYPE → monthly cost from the billing footprint.
  // Billing service strings are fuzzy (e.g. "Amazon Elastic Compute Cloud"),
  // so match by keyword against our type names.
  const costMap = new Map<string, number>();
  let maxCost = 0;
  if (viewMode === 'cost' && servicesFootprint.length) {
    const typeKeywords: Record<string, string[]> = {
      EC2: ['elastic compute', 'ec2'], Lambda: ['lambda'], S3: ['simple storage', 's3'],
      RDS: ['relational database', 'rds'], DynamoDB: ['dynamodb'], VPC: ['virtual private cloud', 'vpc'],
      CloudFront: ['cloudfront'], ELB: ['load balancing'], APIGateway: ['api gateway'],
      ECS: ['container service', 'ecs'], EKS: ['kubernetes', 'eks'], SNS: ['notification'],
      SQS: ['queue'], KMS: ['key management'], ElastiCache: ['elasticache'], EFS: ['elastic file'],
      Redshift: ['redshift'], Route53: ['route 53'], CloudWatch: ['cloudwatch'],
      Neptune: ['neptune'], OpenSearch: ['opensearch', 'elasticsearch'], EMR: ['emr'],
    };
    for (const r of serviceResources) {
      const kws = typeKeywords[r.type];
      if (!kws) continue;
      const match = servicesFootprint.find((s) =>
        kws.some((kw) => (s.service || '').toLowerCase().includes(kw))
      );
      if (match) {
        costMap.set(r.type, match.monthly_cost_usd);
        maxCost = Math.max(maxCost, match.monthly_cost_usd);
      }
    }
  }

  // Metadata maps from the full (unfiltered) resource set.
  const vpcMeta = new Map<string, Resource>();
  const subnetMeta = new Map<string, Resource>();
  for (const r of resources) {
    if (r.type === 'VPC') vpcMeta.set(r.id, r);
    else if (r.type === 'Subnet') subnetMeta.set(r.id, r);
  }

  const ctx: GroupContext = { isDark, viewMode, vpcMeta, subnetMeta };
  const cloudChildren = buildCloudChildren(serviceResources, ctx);

  const groupStyles = getGroupStyles(isDark);
  const accountRes = resources.find((r) => r.account_id || r.account);
  const accountId = (accountRes?.account_id || accountRes?.account || '338920687491') as string;
  const cloudLabel = `AWS Cloud · Account: ${accountId}`;

  // AWS Cloud container wraps every region + global row.
  const cloudNode = boundaryElkNode(
    '__aws_cloud__',
    'AWSCloud',
    cloudLabel,
    cloudChildren,
    containerLayoutOptions()
  );

  // Internet node sits at the top level, above AWS Cloud, connected downward.
  const hasPublicFacing = serviceResources.some((r) => PUBLIC_FACING_TYPES.has(r.type));

  const rootChildren: ElkNode[] = [];
  if (hasPublicFacing) {
    rootChildren.push({
      id: INTERNET_ID,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      __kind: 'internet',
    });
  }
  rootChildren.push(cloudNode);

  const rootEdges = hasPublicFacing
    ? [{ id: 'root-inet', sources: [INTERNET_ID], targets: ['__aws_cloud__'] }]
    : [];

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: ROOT_LAYOUT_OPTIONS,
    children: rootChildren,
    edges: rootEdges,
  };

  // elk.layout is async and returns the graph with computed geometry.
  // elkjs types are loose; cast through unknown to our local ElkNode shape.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const laid = (await elk.layout(graph as any)) as unknown as ElkNode;

  const nodes: Node[] = [];

  // Emit each top-level child (internet + aws cloud) and their subtrees.
  for (const child of laid.children || []) {
    if (child.__kind === 'internet') {
      // Internet is a top-level node with no parent.
      const single = elkToReactFlow(
        { ...child, __kind: 'internet' },
        isDark,
        viewMode,
        costMap,
        maxCost
      );
      nodes.push(...single);
    } else {
      // AWS Cloud boundary subtree.
      nodes.push(...elkToReactFlow(child, isDark, viewMode, costMap, maxCost));
    }
  }

  const edges = buildEdges(serviceResources, relationships, isDark, hasPublicFacing, viewMode);

  return { nodes, edges };
}

// ─── Legend ─────────────────────────────────────────────────────────────────────

function DiagramLegend({
  viewMode,
  isDark,
}: {
  viewMode: DiagramViewMode;
  isDark: boolean;
}) {
  return (
    <div
      style={{
        background: isDark ? 'rgba(15, 23, 42, 0.9)' : 'rgba(255, 255, 255, 0.9)',
        border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
        borderRadius: '8px',
        padding: '10px 14px',
        fontSize: '11px',
        color: isDark ? '#cbd5e1' : '#475569',
        lineHeight: '1.6',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: '6px', fontSize: '12px' }}>Legend</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
        <div
          style={{ width: '24px', height: '2px', background: isDark ? '#64748b' : '#94a3b8' }}
        />
        <span>Discovered</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
        <div
          style={{
            width: '24px',
            height: 0,
            borderTop: '2px dashed',
            borderColor: isDark ? '#475569' : '#cbd5e1',
          }}
        />
        <span>Inferred</span>
      </div>
      {viewMode === 'cost' && (
        <>
          <div style={{ marginTop: '8px', fontWeight: 600, marginBottom: '4px' }}>
            Cost View
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '3px', background: '#22c55e' }} />
            <span>Larger = higher monthly $</span>
          </div>
        </>
      )}
      {viewMode === 'dataflow' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px' }}>
          <div style={{ width: '24px', height: '2px', background: isDark ? '#38bdf8' : '#0284c7' }} />
          <span>Data flow direction</span>
        </div>
      )}
      {viewMode === 'security' && (
        <>
          <div style={{ marginTop: '8px', fontWeight: 600, marginBottom: '4px' }}>
            Security Posture
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ef4444' }} />
            <span>Public / Exposed</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#eab308' }} />
            <span>Encryption Risk</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#22c55e' }} />
            <span>Secure</span>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ArchitectureDiagram({
  resources,
  relationships,
  servicesFootprint = [],
  viewMode: propViewMode,
}: ArchitectureDiagramProps) {
  const { darkMode: isDark, diagramViewMode: storeViewMode } = useAppStore();
  const diagramViewMode = propViewMode || storeViewMode;

  const nodeTypes = React.useMemo(() => ({
    group: CustomGroupNode,
  }), []);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [isLayingOut, setIsLayingOut] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (resources.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }

    setIsLayingOut(true);
    buildAndLayout(resources, relationships, isDark, diagramViewMode, servicesFootprint)
      .then(({ nodes: laidNodes, edges: laidEdges }) => {
        if (cancelled) return;
        setNodes(laidNodes);
        setEdges(laidEdges);
        setIsLayingOut(false);
      })
      .catch(() => {
        if (cancelled) return;
        setNodes([]);
        setEdges([]);
        setIsLayingOut(false);
      });

    return () => {
      cancelled = true;
    };
  }, [resources, relationships, isDark, diagramViewMode, servicesFootprint, setNodes, setEdges]);

  const diagramBg = getDiagramBackground(isDark);
  const gridColor = getDiagramGridColor(isDark);

  // ── Empty State ──
  if (resources.length === 0) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: diagramBg,
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        <div style={{ fontSize: '48px' }}>🏗️</div>
        <div
          style={{
            fontSize: '16px',
            color: isDark ? '#94a3b8' : '#64748b',
            textAlign: 'center',
            maxWidth: '360px',
          }}
        >
          No resources discovered yet — Run a scan to visualize your architecture
        </div>
      </div>
    );
  }

  const viewModeLabel =
    diagramViewMode === 'logical'
      ? 'Logical View'
      : diagramViewMode === 'network'
      ? 'Network View'
      : diagramViewMode === 'security'
      ? 'Security View'
      : diagramViewMode === 'dataflow'
      ? 'Data Flow View'
      : 'Cost View';

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* Loading overlay while elk computes the layout. */}
      {isLayingOut && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: isDark ? 'rgba(13,17,23,0.6)' : 'rgba(255,255,255,0.6)',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              fontSize: '13px',
              fontWeight: 600,
              color: isDark ? '#94a3b8' : '#64748b',
            }}
          >
            Computing layout…
          </div>
        </div>
      )}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        connectionLineType={ConnectionLineType.SmoothStep}
        fitView
        fitViewOptions={{ padding: 0.1 }}
        minZoom={0.05}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
        style={{ background: diagramBg }}
      >
        <Background color={gridColor} gap={20} size={1} />
        <Controls
          style={{
            background: isDark ? '#1e293b' : '#ffffff',
            border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
            borderRadius: '8px',
          }}
        />
        <MiniMap
          style={{
            background: isDark ? '#0f172a' : '#f8fafc',
            border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
            borderRadius: '8px',
          }}
          nodeColor={(node) => {
            if (node.id.startsWith('__')) return 'transparent';
            return isDark ? '#334155' : '#cbd5e1';
          }}
          maskColor={isDark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.1)'}
        />

        {/* Top-left: Legend */}
        <Panel position="top-left">
          <DiagramLegend viewMode={diagramViewMode} isDark={isDark} />
        </Panel>

        {/* Bottom-right: View mode badge */}
        <Panel position="bottom-right">
          <div
            style={{
              background: isDark ? 'rgba(15, 23, 42, 0.9)' : 'rgba(255, 255, 255, 0.9)',
              border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
              borderRadius: '6px',
              padding: '6px 12px',
              fontSize: '11px',
              fontWeight: 600,
              color: isDark ? '#94a3b8' : '#64748b',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            {viewModeLabel}
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}


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
import { getServiceIconPath } from '../config/aws-icon-map';

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
}

// ─── Constants ───────────────────────────────────────────────────────────────

const NODE_WIDTH = 150;
const NODE_HEIGHT = 90;
// Vertical space reserved at the top of each boundary for its label.
const LABEL_RESERVE = 28;

const INFRASTRUCTURE_TYPES = new Set([
  'VPC',
  'Subnet',
  'SecurityGroup',
  'InternetGateway',
  'NATGateway',
]);

// Types that are conceptually global / edge — never bound to a VPC.
const GLOBAL_TYPES = new Set(['CloudFront', 'Route53', 'IAM', 'S3']);

const PUBLIC_FACING_TYPES = new Set(['Route53', 'CloudFront', 'APIGateway', 'ELB']);

// Inferred connection rules: source_type → target_types
const INFERRED_CONNECTIONS: Record<string, string[]> = {
  APIGateway: ['Lambda'],
  ELB: ['EC2', 'ECS'],
  Lambda: ['DynamoDB', 'S3', 'RDS'],
  CloudFront: ['S3', 'ELB'],
  EC2: ['RDS'],
};

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
  'elk.padding': `[top=${LABEL_RESERVE + 16},left=24,bottom=24,right=24]`,
});

// AZ columns should sit side-by-side — lay their subnet bands out top-to-bottom
// but keep AZ siblings in a horizontal row (handled by the parent VPC's RIGHT flow).
const azRowLayoutOptions = (): Record<string, string> => ({
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.layered.spacing.nodeNodeBetweenLayers': '40',
  'elk.spacing.nodeNode': '30',
  'elk.padding': `[top=${LABEL_RESERVE + 12},left=20,bottom=20,right=20]`,
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

/**
 * Group resources into the nested container hierarchy and return the ELK
 * children of the AWS Cloud container. Structure:
 *   AWS Cloud
 *   ├── global service row (leaf nodes)
 *   └── Region → VPC → (VPC-level leaves) + AZ → Subnet band → leaves
 */
function buildCloudChildren(
  serviceResources: Resource[],
  ctx: GroupContext
): ElkNode[] {
  const cloudChildren: ElkNode[] = [];

  // 1. Split global vs regional-with-vpc.
  const globalResources: Resource[] = [];
  const regionalResources: Resource[] = [];

  for (const r of serviceResources) {
    const isGlobal = GLOBAL_TYPES.has(r.type) || !r.region || !r.vpc_id;
    if (isGlobal) globalResources.push(r);
    else regionalResources.push(r);
  }

  // 2. Global service leaves live directly under AWS Cloud.
  for (const r of globalResources) {
    cloudChildren.push(serviceElkNode(r));
  }

  // 3. Group regional resources by region → vpc.
  const regionGroups = new Map<string, Resource[]>();
  for (const r of regionalResources) {
    const region = r.region as string;
    if (!regionGroups.has(region)) regionGroups.set(region, []);
    regionGroups.get(region)!.push(r);
  }

  for (const [regionName, regionResources] of regionGroups.entries()) {
    const vpcGroups = new Map<string, Resource[]>();
    for (const r of regionResources) {
      const vpcId = r.vpc_id as string;
      if (!vpcGroups.has(vpcId)) vpcGroups.set(vpcId, []);
      vpcGroups.get(vpcId)!.push(r);
    }

    const vpcContainers: ElkNode[] = [];

    for (const [vpcId, vpcResources] of vpcGroups.entries()) {
      const vpcChildren: ElkNode[] = [];

      // VPC-level resources (vpc_id but no subnet_id) → placed above AZ columns.
      const vpcLevelResources: Resource[] = [];
      // subnet_id → resources
      const bySubnet = new Map<string, Resource[]>();

      for (const r of vpcResources) {
        if (r.subnet_id) {
          if (!bySubnet.has(r.subnet_id)) bySubnet.set(r.subnet_id, []);
          bySubnet.get(r.subnet_id)!.push(r);
        } else {
          vpcLevelResources.push(r);
        }
      }

      // VPC-level leaves first so elk lays them above the AZ row.
      for (const r of vpcLevelResources) {
        vpcChildren.push(serviceElkNode(r));
      }

      // Group subnets by availability zone.
      const byAz = new Map<string, Array<[string, Resource[]]>>();
      for (const [subnetId, subnetResources] of bySubnet.entries()) {
        const meta = ctx.subnetMeta.get(subnetId);
        const az =
          meta?.availability_zone ||
          (subnetResources[0] && subnetResources[0].availability_zone) ||
          'az-unknown';
        if (!byAz.has(az)) byAz.set(az, []);
        byAz.get(az)!.push([subnetId, subnetResources]);
      }

      // Sort AZ names alphabetically for stable left-to-right ordering.
      const azNames = Array.from(byAz.keys()).sort((a, b) => a.localeCompare(b));

      for (const azName of azNames) {
        const subnetEntries = byAz.get(azName)!;

        // Public band above private band: sort public subnets first.
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
          const groupStyles = getGroupStyles(ctx.isDark);
          const baseLabel = groupStyles[styleKey].label;
          const subnetLabel = `${baseLabel} (${meta?.name || subnetId})`;

          const subnetLeaves = subnetResources.map((r) => serviceElkNode(r));

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

        // AZ container holds its subnet bands stacked vertically (public→private).
        vpcChildren.push(
          boundaryElkNode(
            `__az_${vpcId}_${azName}__`,
            'AvailabilityZone',
            `Availability Zone (${azName})`,
            azSubnetContainers,
            azRowLayoutOptions()
          )
        );
      }

      const vpcMetaRes = ctx.vpcMeta.get(vpcId);
      const vpcLabel = `VPC (${vpcMetaRes?.name || vpcId})`;

      vpcContainers.push(
        boundaryElkNode(
          `__vpc_${vpcId}__`,
          'VPC',
          vpcLabel,
          vpcChildren,
          containerLayoutOptions()
        )
      );
    }

    cloudChildren.push(
      boundaryElkNode(
        `__region_${regionName}__`,
        'Region',
        `Region (${regionName})`,
        vpcContainers,
        containerLayoutOptions()
      )
    );
  }

  return cloudChildren;
}

// ─── ELK → ReactFlow conversion ────────────────────────────────────────────────

function serviceNodeData(r: Resource, isDark: boolean) {
  const iconPath = getIconPath(r.type, isDark);
  return {
    label: (
      <div style={{ textAlign: 'center', padding: '6px', overflow: 'hidden' }}>
        {iconPath && (
          <img
            src={iconPath}
            alt={r.type}
            style={{ width: '32px', height: '32px', margin: '0 auto' }}
          />
        )}
        <div
          style={{
            fontSize: '10px',
            fontWeight: 600,
            color: isDark ? '#e2e8f0' : '#334155',
            marginTop: '2px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={r.name}
        >
          {truncateName(r.name)}
        </div>
        <div style={{ fontSize: '9px', color: isDark ? '#94a3b8' : '#64748b' }}>
          {r.type}
        </div>
      </div>
    ),
  };
}

function boundaryNodeData(labelText: string, labelColor: string) {
  return {
    label: (
      <div
        style={{
          position: 'absolute',
          top: 6,
          left: 12,
          fontSize: '11px',
          fontWeight: 700,
          color: labelColor,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}
      >
        {labelText}
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
  viewMode: DiagramViewMode
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
      let borderColor = AWS_SERVICE_COLORS[r.type] || '#64748b';
      let boxShadow: string | undefined;
      if (isSecurity) {
        borderColor = getSecurityColor(r);
        boxShadow = `0 0 8px ${borderColor}80`;
      }

      nodes.push({
        id: r.id,
        type: 'default',
        position: { x, y },
        ...(parentId ? { parentNode: parentId, extent: 'parent' as const } : {}),
        data: serviceNodeData(r, isDark),
        style: {
          width: node.width ?? NODE_WIDTH,
          height: node.height ?? NODE_HEIGHT,
          background: isDark ? '#1e293b' : '#ffffff',
          border: `${isSecurity ? 3 : 2}px solid ${borderColor}`,
          borderRadius: '10px',
          ...(boxShadow ? { boxShadow } : {}),
        },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
      });
      return;
    }

    // Boundary container.
    if (node.__kind === 'boundary') {
      const styleKey = node.__boundaryStyleKey || 'VPC';
      const style = groupStyles[styleKey] || groupStyles.VPC;

      nodes.push({
        id: node.id,
        type: 'group',
        position: { x, y },
        ...(parentId ? { parentNode: parentId, extent: 'parent' as const } : {}),
        data: boundaryNodeData(node.__labelText || style.label, style.labelColor),
        style: {
          width: node.width ?? NODE_WIDTH,
          height: node.height ?? NODE_HEIGHT,
          border: `${style.borderWidth}px ${style.borderStyle} ${style.borderColor}`,
          borderRadius: '10px',
          backgroundColor: style.backgroundColor,
        },
        selectable: false,
      });

      // Children come after the parent.
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
  hasInternet: boolean
): Edge[] {
  const edges: Edge[] = [];
  const nodeIds = new Set(serviceResources.map((r) => r.id));
  const typeToIds = new Map<string, string[]>();

  for (const r of serviceResources) {
    if (!typeToIds.has(r.type)) typeToIds.set(r.type, []);
    typeToIds.get(r.type)!.push(r.id);
  }

  const edgeSet = new Set<string>();

  // Real relationships (both endpoints must exist).
  for (const rel of relationships) {
    if (nodeIds.has(rel.source) && nodeIds.has(rel.target)) {
      const key = `${rel.source}->${rel.target}`;
      if (edgeSet.has(key)) continue;
      edgeSet.add(key);

      edges.push({
        id: `rel-${edges.length}`,
        source: rel.source,
        target: rel.target,
        type: 'smoothstep',
        animated: false,
        style: { stroke: isDark ? '#64748b' : '#94a3b8', strokeWidth: 1.5 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isDark ? '#64748b' : '#94a3b8',
          width: 16,
          height: 16,
        },
        label: rel.relationship,
        labelStyle: { fontSize: 9, fill: isDark ? '#94a3b8' : '#64748b' },
        labelBgStyle: { fill: isDark ? '#1e293b' : '#ffffff', fillOpacity: 0.8 },
      });
    }
  }

  // Internet → public-facing services (dashed, animated).
  if (hasInternet) {
    for (const t of PUBLIC_FACING_TYPES) {
      const ids = typeToIds.get(t) || [];
      for (const id of ids) {
        const key = `${INTERNET_ID}->${id}`;
        if (edgeSet.has(key)) continue;
        edgeSet.add(key);

        edges.push({
          id: `inf-inet-${edges.length}`,
          source: INTERNET_ID,
          target: id,
          type: 'smoothstep',
          animated: true,
          style: {
            stroke: isDark ? '#475569' : '#cbd5e1',
            strokeWidth: 1,
            strokeDasharray: '5 3',
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: isDark ? '#475569' : '#cbd5e1',
            width: 14,
            height: 14,
          },
        });
      }
    }
  }

  // Inferred connections (only when both types exist).
  for (const [sourceType, targetTypes] of Object.entries(INFERRED_CONNECTIONS)) {
    const sourceIds = typeToIds.get(sourceType) || [];
    for (const targetType of targetTypes) {
      const targetIds = typeToIds.get(targetType) || [];
      for (const srcId of sourceIds) {
        for (const tgtId of targetIds) {
          if (srcId === tgtId) continue;
          const key = `${srcId}->${tgtId}`;
          if (edgeSet.has(key)) continue;
          edgeSet.add(key);

          edges.push({
            id: `inf-${edges.length}`,
            source: srcId,
            target: tgtId,
            type: 'smoothstep',
            animated: true,
            style: {
              stroke: isDark ? '#475569' : '#cbd5e1',
              strokeWidth: 1,
              strokeDasharray: '5 3',
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: isDark ? '#475569' : '#cbd5e1',
              width: 14,
              height: 14,
            },
          });
        }
      }
    }
  }

  return edges;
}

// ─── Build + layout (async) ────────────────────────────────────────────────────

async function buildAndLayout(
  resources: Resource[],
  relationships: Relationship[],
  isDark: boolean,
  viewMode: DiagramViewMode
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  const serviceResources = resources.filter((r) => !INFRASTRUCTURE_TYPES.has(r.type));

  if (serviceResources.length === 0) {
    return { nodes: [], edges: [] };
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
  const cloudStyle = groupStyles.AWSCloud;

  // AWS Cloud container wraps every region + global row.
  const cloudNode = boundaryElkNode(
    '__aws_cloud__',
    'AWSCloud',
    cloudStyle.label,
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
        viewMode
      );
      nodes.push(...single);
    } else {
      // AWS Cloud boundary subtree.
      nodes.push(...elkToReactFlow(child, isDark, viewMode));
    }
  }

  const edges = buildEdges(serviceResources, relationships, isDark, hasPublicFacing);

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
}: ArchitectureDiagramProps) {
  const { darkMode: isDark, diagramViewMode } = useAppStore();

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
    buildAndLayout(resources, relationships, isDark, diagramViewMode)
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
  }, [resources, relationships, isDark, diagramViewMode, setNodes, setEdges]);

  const diagramBg = getDiagramBackground(isDark);
  const gridColor = getDiagramGridColor(isDark);

  const serviceCount = resources.filter((r) => !INFRASTRUCTURE_TYPES.has(r.type)).length;

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
      : diagramViewMode.charAt(0).toUpperCase() + diagramViewMode.slice(1) + ' View';

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

        {/* Top-right: Resource count */}
        <Panel position="top-right">
          <div
            style={{
              background: isDark ? 'rgba(15, 23, 42, 0.9)' : 'rgba(255, 255, 255, 0.9)',
              border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
              borderRadius: '6px',
              padding: '6px 12px',
              fontSize: '12px',
              fontWeight: 500,
              color: isDark ? '#cbd5e1' : '#475569',
            }}
          >
            {serviceCount} resources
          </div>
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

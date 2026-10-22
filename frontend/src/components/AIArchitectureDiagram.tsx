/**
 * AI-Powered Architecture Diagram Component
 * 
 * Uses Amazon Bedrock to analyze discovered resources and generate
 * an intelligent architecture layout showing the REAL connections
 * and data flow between services.
 * 
 * Features:
 * - AI-inferred service connections
 * - Automatic tier grouping (Edge → API → Compute → Data)
 * - Data flow visualization
 * - Architecture insights
 */

import React, { useEffect, useState, useCallback } from 'react';
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
// @ts-ignore
import ELK from 'elkjs/lib/elk.bundled.js';
import { useAppStore } from '../store/useAppStore';
import { generateAILayout } from '../services/api';
import {
  AWS_SERVICE_COLORS,
  getGroupStyles,
  getDiagramBackground,
  getDiagramGridColor,
} from '../config/aws-theme';
import { getServiceIconPath } from '../config/aws-icon-map';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Resource {
  type: string;
  id: string;
  name: string;
  region?: string;
  vpc_id?: string;
  subnet_id?: string;
  [key: string]: unknown;
}

interface Relationship {
  source: string;
  source_type: string;
  target: string;
  target_type: string;
  relationship: string;
}

interface AIConnection {
  source: string;
  target: string;
  label?: string;
  type?: 'sync' | 'async' | 'event';
  description?: string;
}

interface AITier {
  id: string;
  name: string;
  order: number;
  resources: string[];
}

interface AILayout {
  architecture_type?: string;
  description?: string;
  tiers: AITier[];
  connections: AIConnection[];
  data_flows?: Array<{
    name: string;
    path: string[];
    description?: string;
  }>;
  insights?: string[];
}

interface AIArchitectureDiagramProps {
  resources: Resource[];
  relationships: Relationship[];
  scanId?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const NODE_WIDTH = 160;
const NODE_HEIGHT = 100;
const TIER_PADDING = 40;
const TIER_LABEL_HEIGHT = 36;

const elk = new ELK();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getIconPath(type: string, isDark: boolean): string {
  return getServiceIconPath(type, isDark);
}

function truncateName(name: string, maxLen = 18): string {
  if (!name) return '';
  if (name.length <= maxLen) return name;
  return name.slice(0, maxLen - 1) + '…';
}

// Tier colors for visual distinction
const TIER_COLORS: Record<string, { border: string; bg: string; label: string }> = {
  'edge': { border: '#f97316', bg: 'rgba(249, 115, 22, 0.08)', label: '#f97316' },
  'cdn': { border: '#f97316', bg: 'rgba(249, 115, 22, 0.08)', label: '#f97316' },
  'api': { border: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.08)', label: '#8b5cf6' },
  'compute': { border: '#ec4899', bg: 'rgba(236, 72, 153, 0.08)', label: '#ec4899' },
  'data': { border: '#06b6d4', bg: 'rgba(6, 182, 212, 0.08)', label: '#06b6d4' },
  'storage': { border: '#06b6d4', bg: 'rgba(6, 182, 212, 0.08)', label: '#06b6d4' },
  'messaging': { border: '#eab308', bg: 'rgba(234, 179, 8, 0.08)', label: '#eab308' },
  'integration': { border: '#eab308', bg: 'rgba(234, 179, 8, 0.08)', label: '#eab308' },
  'management': { border: '#64748b', bg: 'rgba(100, 116, 139, 0.08)', label: '#64748b' },
  'security': { border: '#ef4444', bg: 'rgba(239, 68, 68, 0.08)', label: '#ef4444' },
  'other': { border: '#94a3b8', bg: 'rgba(148, 163, 184, 0.08)', label: '#94a3b8' },
};

function getTierColors(tierName: string) {
  const lowerName = tierName.toLowerCase();
  for (const [key, colors] of Object.entries(TIER_COLORS)) {
    if (lowerName.includes(key)) {
      return colors;
    }
  }
  return TIER_COLORS.other;
}

// ─── Layout Generation ───────────────────────────────────────────────────────

async function generateLayout(
  resources: Resource[],
  aiLayout: AILayout,
  isDark: boolean
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  // Build resource lookup
  const resourceMap = new Map<string, Resource>();
  for (const r of resources) {
    resourceMap.set(r.id, r);
  }

  // Sort tiers by order
  const sortedTiers = [...aiLayout.tiers].sort((a, b) => a.order - b.order);

  // Build ELK graph structure
  const elkChildren: any[] = [];

  // Add Internet node at top
  elkChildren.push({
    id: '__internet__',
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    __kind: 'internet',
  });

  // Add tier containers
  for (const tier of sortedTiers) {
    if (tier.resources.length === 0) continue;

    const tierResources = tier.resources
      .map((id) => resourceMap.get(id))
      .filter((r): r is Resource => r !== undefined);

    if (tierResources.length === 0) continue;

    const tierChildren = tierResources.map((r) => ({
      id: r.id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      __kind: 'service',
      __resource: r,
    }));

    elkChildren.push({
      id: tier.id,
      __kind: 'tier',
      __tierName: tier.name,
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.layered.spacing.nodeNodeBetweenLayers': '40',
        'elk.spacing.nodeNode': '30',
        'elk.padding': `[top=${TIER_LABEL_HEIGHT + 16},left=24,bottom=24,right=24]`,
      },
      children: tierChildren,
    });
  }

  // Build edges for ELK
  const elkEdges = aiLayout.connections.map((conn, i) => ({
    id: `edge-${i}`,
    sources: [conn.source],
    targets: [conn.target],
  }));

  // Add edges from internet to edge tier resources
  const edgeTier = sortedTiers.find((t) =>
    t.name.toLowerCase().includes('edge') ||
    t.name.toLowerCase().includes('cdn') ||
    t.name.toLowerCase().includes('api')
  );
  if (edgeTier) {
    for (const resourceId of edgeTier.resources.slice(0, 3)) {
      elkEdges.push({
        id: `inet-${resourceId}`,
        sources: ['__internet__'],
        targets: [resourceId],
      });
    }
  }

  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      'elk.spacing.nodeNode': '60',
      'elk.padding': '[top=40,left=40,bottom=40,right=40]',
    },
    children: elkChildren,
    edges: elkEdges,
  };

  // Run ELK layout
  const layouted = await elk.layout(elkGraph);

  // Convert to ReactFlow nodes
  const nodes: Node[] = [];
  const processNode = (elkNode: any, parentId?: string) => {
    const x = elkNode.x ?? 0;
    const y = elkNode.y ?? 0;

    if (elkNode.__kind === 'internet') {
      nodes.push({
        id: elkNode.id,
        type: 'default',
        position: { x, y },
        data: {
          label: (
            <div style={{ textAlign: 'center', padding: '8px' }}>
              <div style={{ fontSize: '28px' }}>🌐</div>
              <div style={{
                fontSize: '12px',
                fontWeight: 600,
                color: isDark ? '#e2e8f0' : '#334155',
                marginTop: '4px',
              }}>
                Internet / Users
              </div>
            </div>
          ),
        },
        style: {
          width: elkNode.width,
          height: elkNode.height,
          background: isDark ? '#1e293b' : '#ffffff',
          border: `2px solid ${isDark ? '#475569' : '#94a3b8'}`,
          borderRadius: '12px',
        },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
      });
    } else if (elkNode.__kind === 'tier') {
      const tierColors = getTierColors(elkNode.__tierName || '');
      
      nodes.push({
        id: elkNode.id,
        type: 'group',
        position: { x, y },
        data: {
          label: (
            <div style={{
              position: 'absolute',
              top: 8,
              left: 16,
              fontSize: '13px',
              fontWeight: 700,
              color: tierColors.label,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>
              {elkNode.__tierName}
            </div>
          ),
        },
        style: {
          width: elkNode.width,
          height: elkNode.height,
          border: `2px dashed ${tierColors.border}`,
          borderRadius: '12px',
          backgroundColor: tierColors.bg,
        },
        selectable: false,
      });

      // Process children
      for (const child of elkNode.children || []) {
        processNode(child, elkNode.id);
      }
    } else if (elkNode.__kind === 'service' && elkNode.__resource) {
      const r = elkNode.__resource;
      const iconPath = getIconPath(r.type, isDark);
      const borderColor = AWS_SERVICE_COLORS[r.type] || '#64748b';

      nodes.push({
        id: r.id,
        type: 'default',
        position: { x, y },
        parentNode: parentId,
        extent: parentId ? 'parent' : undefined,
        data: {
          label: (
            <div style={{ textAlign: 'center', padding: '8px', overflow: 'hidden' }}>
              {iconPath && (
                <img
                  src={iconPath}
                  alt={r.type}
                  style={{ width: '36px', height: '36px', margin: '0 auto' }}
                />
              )}
              <div style={{
                fontSize: '11px',
                fontWeight: 600,
                color: isDark ? '#e2e8f0' : '#334155',
                marginTop: '4px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }} title={r.name}>
                {truncateName(r.name)}
              </div>
              <div style={{
                fontSize: '10px',
                color: isDark ? '#94a3b8' : '#64748b',
              }}>
                {r.type}
              </div>
            </div>
          ),
        },
        style: {
          width: elkNode.width,
          height: elkNode.height,
          background: isDark ? '#1e293b' : '#ffffff',
          border: `2px solid ${borderColor}`,
          borderRadius: '10px',
        },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
      });
    }
  };

  for (const child of layouted.children || []) {
    processNode(child);
  }

  // Build edges
  const edges: Edge[] = aiLayout.connections.map((conn, i) => {
    const isAsync = conn.type === 'async' || conn.type === 'event';
    const strokeColor = isAsync
      ? (isDark ? '#eab308' : '#ca8a04')
      : (isDark ? '#64748b' : '#94a3b8');

    return {
      id: `edge-${i}`,
      source: conn.source,
      target: conn.target,
      type: 'smoothstep',
      animated: isAsync,
      label: conn.label,
      labelStyle: {
        fontSize: 10,
        fill: isDark ? '#94a3b8' : '#64748b',
        fontWeight: 500,
      },
      labelBgStyle: {
        fill: isDark ? '#1e293b' : '#ffffff',
        fillOpacity: 0.9,
      },
      style: {
        stroke: strokeColor,
        strokeWidth: 2,
        ...(isAsync ? { strokeDasharray: '5 3' } : {}),
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: strokeColor,
        width: 18,
        height: 18,
      },
    };
  });

  // Add internet edges
  if (edgeTier) {
    for (const resourceId of edgeTier.resources.slice(0, 3)) {
      edges.push({
        id: `inet-edge-${resourceId}`,
        source: '__internet__',
        target: resourceId,
        type: 'smoothstep',
        animated: true,
        style: {
          stroke: isDark ? '#475569' : '#cbd5e1',
          strokeWidth: 1.5,
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

  return { nodes, edges };
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function AIArchitectureDiagram({
  resources,
  relationships,
  scanId,
}: AIArchitectureDiagramProps) {
  const { darkMode: isDark } = useAppStore();

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [aiLayout, setAiLayout] = useState<AILayout | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Generate AI layout
  const fetchAILayout = useCallback(async () => {
    if (resources.length === 0) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await generateAILayout({
        scanId,
        resources,
        relationships,
      });

      if (response.error) {
        throw new Error(response.error);
      }

      const layoutData = (response.data as any)?.layout;
      if (layoutData) {
        setAiLayout(layoutData);
      } else {
        // Fallback to basic layout if API fails
        setAiLayout(generateFallbackLayout(resources));
      }
    } catch (err) {
      console.error('AI Layout error:', err);
      // Use fallback layout
      setAiLayout(generateFallbackLayout(resources));
      setError('Using basic layout (AI unavailable)');
    } finally {
      setIsLoading(false);
    }
  }, [resources, relationships, scanId]);

  // Generate fallback layout on the client side
  function generateFallbackLayout(resources: Resource[]): AILayout {
    const tierMapping: Record<string, string> = {
      CloudFront: 'edge', Route53: 'edge', WAF: 'edge',
      APIGateway: 'api', ELB: 'api', AppRunner: 'api',
      Lambda: 'compute', EC2: 'compute', ECS: 'compute', EKS: 'compute',
      StepFunctions: 'compute', Batch: 'compute',
      DynamoDB: 'data', RDS: 'data', Aurora: 'data', S3: 'data',
      ElastiCache: 'data', EFS: 'data', Redshift: 'data',
      SNS: 'messaging', SQS: 'messaging', EventBridge: 'messaging', Kinesis: 'messaging',
      CloudWatch: 'management', CloudTrail: 'management', IAM: 'management',
    };

    const tiers: Record<string, AITier> = {
      edge: { id: 'tier-edge', name: 'Edge / CDN', order: 1, resources: [] },
      api: { id: 'tier-api', name: 'API Layer', order: 2, resources: [] },
      compute: { id: 'tier-compute', name: 'Compute', order: 3, resources: [] },
      data: { id: 'tier-data', name: 'Data Layer', order: 4, resources: [] },
      messaging: { id: 'tier-messaging', name: 'Messaging', order: 5, resources: [] },
      management: { id: 'tier-management', name: 'Management', order: 6, resources: [] },
      other: { id: 'tier-other', name: 'Other', order: 7, resources: [] },
    };

    for (const r of resources) {
      const tierKey = tierMapping[r.type] || 'other';
      tiers[tierKey].resources.push(r.id);
    }

    // Infer basic connections
    const connections: AIConnection[] = [];
    const byType: Record<string, Resource[]> = {};
    for (const r of resources) {
      if (!byType[r.type]) byType[r.type] = [];
      byType[r.type].push(r);
    }

    // API Gateway → Lambda
    for (const apigw of byType['APIGateway'] || []) {
      for (const lamb of byType['Lambda'] || []) {
        const prefix = apigw.name?.split('-')[0];
        if (prefix && lamb.name?.startsWith(prefix)) {
          connections.push({
            source: apigw.id,
            target: lamb.id,
            label: 'invoke',
            type: 'sync',
          });
        }
      }
    }

    // Lambda → DynamoDB
    for (const lamb of byType['Lambda'] || []) {
      for (const ddb of byType['DynamoDB'] || []) {
        const prefix = lamb.name?.split('-')[0];
        if (prefix && ddb.name?.includes(prefix)) {
          connections.push({
            source: lamb.id,
            target: ddb.id,
            label: 'read/write',
            type: 'sync',
          });
        }
      }
    }

    // Lambda → S3
    for (const lamb of byType['Lambda'] || []) {
      for (const s3 of byType['S3'] || []) {
        const prefix = lamb.name?.split('-')[0];
        if (prefix && s3.name?.includes(prefix)) {
          connections.push({
            source: lamb.id,
            target: s3.id,
            label: 'read/write',
            type: 'sync',
          });
        }
      }
    }

    return {
      architecture_type: 'unknown',
      description: 'Basic layout (AI analysis not available)',
      tiers: Object.values(tiers).filter((t) => t.resources.length > 0),
      connections,
      insights: ['Using fallback layout based on resource types'],
    };
  }

  // Fetch AI layout when resources change
  useEffect(() => {
    fetchAILayout();
  }, [fetchAILayout]);

  // Generate diagram when AI layout is ready
  useEffect(() => {
    if (!aiLayout || resources.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }

    generateLayout(resources, aiLayout, isDark)
      .then(({ nodes: n, edges: e }) => {
        setNodes(n);
        setEdges(e);
      })
      .catch((err) => {
        console.error('Layout generation error:', err);
      });
  }, [aiLayout, resources, isDark, setNodes, setEdges]);

  const diagramBg = getDiagramBackground(isDark);
  const gridColor = getDiagramGridColor(isDark);

  // Empty state
  if (resources.length === 0) {
    return (
      <div style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: diagramBg,
        flexDirection: 'column',
        gap: '16px',
      }}>
        <div style={{ fontSize: '48px' }}>🏗️</div>
        <div style={{
          fontSize: '16px',
          color: isDark ? '#94a3b8' : '#64748b',
          textAlign: 'center',
          maxWidth: '360px',
        }}>
          No resources discovered yet — Run a scan to visualize your architecture
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* Loading overlay */}
      {isLoading && (
        <div style={{
          position: 'absolute',
          inset: 0,
          zIndex: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: isDark ? 'rgba(13,17,23,0.8)' : 'rgba(255,255,255,0.8)',
          flexDirection: 'column',
          gap: '12px',
        }}>
          <div className="animate-spin" style={{
            width: '40px',
            height: '40px',
            border: `3px solid ${isDark ? '#334155' : '#e2e8f0'}`,
            borderTopColor: '#8b5cf6',
            borderRadius: '50%',
          }} />
          <div style={{
            fontSize: '14px',
            fontWeight: 600,
            color: isDark ? '#94a3b8' : '#64748b',
          }}>
            🤖 AI is analyzing your architecture...
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
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.05}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
        style={{ background: diagramBg }}
      >
        <Background color={gridColor} gap={20} size={1} />
        <Controls style={{
          background: isDark ? '#1e293b' : '#ffffff',
          border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
          borderRadius: '8px',
        }} />
        <MiniMap
          style={{
            background: isDark ? '#0f172a' : '#f8fafc',
            border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
            borderRadius: '8px',
          }}
          nodeColor={(node) => {
            if (node.id.startsWith('__') || node.id.startsWith('tier-')) return 'transparent';
            return isDark ? '#334155' : '#cbd5e1';
          }}
          maskColor={isDark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.1)'}
        />

        {/* AI Insights Panel */}
        {aiLayout?.insights && aiLayout.insights.length > 0 && (
          <Panel position="top-left">
            <div style={{
              background: isDark ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.95)',
              border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
              borderRadius: '10px',
              padding: '14px 18px',
              maxWidth: '320px',
            }}>
              <div style={{
                fontSize: '13px',
                fontWeight: 700,
                color: isDark ? '#e2e8f0' : '#1e293b',
                marginBottom: '10px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}>
                🤖 AI Architecture Insights
              </div>
              {aiLayout.architecture_type && (
                <div style={{
                  fontSize: '11px',
                  color: '#8b5cf6',
                  fontWeight: 600,
                  marginBottom: '8px',
                  textTransform: 'uppercase',
                }}>
                  {aiLayout.architecture_type} Architecture
                </div>
              )}
              {aiLayout.description && (
                <div style={{
                  fontSize: '12px',
                  color: isDark ? '#94a3b8' : '#64748b',
                  marginBottom: '10px',
                  lineHeight: 1.5,
                }}>
                  {aiLayout.description}
                </div>
              )}
              <ul style={{
                margin: 0,
                padding: '0 0 0 16px',
                fontSize: '11px',
                color: isDark ? '#cbd5e1' : '#475569',
                lineHeight: 1.6,
              }}>
                {aiLayout.insights.slice(0, 4).map((insight, i) => (
                  <li key={i} style={{ marginBottom: '4px' }}>{insight}</li>
                ))}
              </ul>
            </div>
          </Panel>
        )}

        {/* Resource count */}
        <Panel position="top-right">
          <div style={{
            background: isDark ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.95)',
            border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
            borderRadius: '8px',
            padding: '8px 14px',
            fontSize: '12px',
            fontWeight: 600,
            color: isDark ? '#cbd5e1' : '#475569',
          }}>
            {resources.length} resources • {aiLayout?.connections?.length || 0} connections
          </div>
        </Panel>

        {/* Legend */}
        <Panel position="bottom-left">
          <div style={{
            background: isDark ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.95)',
            border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
            borderRadius: '8px',
            padding: '12px 16px',
            fontSize: '11px',
            color: isDark ? '#cbd5e1' : '#475569',
          }}>
            <div style={{ fontWeight: 600, marginBottom: '8px' }}>Legend</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <div style={{ width: '20px', height: '2px', background: isDark ? '#64748b' : '#94a3b8' }} />
              <span>Sync connection</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '20px',
                height: 0,
                borderTop: '2px dashed #eab308',
              }} />
              <span>Async / Event</span>
            </div>
          </div>
        </Panel>

        {/* Error indicator */}
        {error && (
          <Panel position="bottom-right">
            <div style={{
              background: 'rgba(234, 179, 8, 0.1)',
              border: '1px solid #eab308',
              borderRadius: '6px',
              padding: '6px 12px',
              fontSize: '11px',
              color: '#eab308',
            }}>
              ⚠️ {error}
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}

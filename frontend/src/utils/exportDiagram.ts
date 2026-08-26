/**
 * Export utilities for architecture diagrams.
 * Supports: PNG, SVG, PDF, draw.io XML, JSON
 */

import { toPng, toSvg } from 'html-to-image';
import { jsPDF } from 'jspdf';
import type { Resource, Relationship } from '../store/useAppStore';
import { getDiagramBackground } from '../config/aws-theme';

/**
 * Export diagram as PNG image.
 */
export async function exportAsPng(element: HTMLElement, filename: string, isDark = true): Promise<void> {
  const dataUrl = await toPng(element, {
    backgroundColor: getDiagramBackground(isDark),
    quality: 1,
    pixelRatio: 2,
  });
  downloadDataUrl(dataUrl, filename);
}

/**
 * Export diagram as SVG.
 */
export async function exportAsSvg(element: HTMLElement, filename: string, isDark = true): Promise<void> {
  const dataUrl = await toSvg(element, { backgroundColor: getDiagramBackground(isDark) });
  downloadDataUrl(dataUrl, filename);
}

/**
 * Export diagram as PDF.
 */
export async function exportAsPdf(element: HTMLElement, filename: string, isDark = true): Promise<void> {
  const dataUrl = await toPng(element, {
    backgroundColor: getDiagramBackground(isDark),
    quality: 1,
    pixelRatio: 2,
  });

  const img = new Image();
  img.src = dataUrl;
  await new Promise((resolve) => { img.onload = resolve; });

  const pdf = new jsPDF({
    orientation: img.width > img.height ? 'landscape' : 'portrait',
    unit: 'px',
    format: [img.width, img.height],
  });

  pdf.addImage(dataUrl, 'PNG', 0, 0, img.width, img.height);
  pdf.save(filename);
}

/**
 * Export architecture as draw.io XML format.
 * This can be imported directly into draw.io/diagrams.net.
 * Uses a proper layered layout for professional-looking diagrams.
 */
export function exportAsDrawioXml(resources: Resource[], relationships: Relationship[], filename: string): void {
  let cellId = 2;
  const cells: string[] = [];
  const idMap: Record<string, number> = {};

  // Layer assignments for proper top-to-bottom layout
  const layerOrder: Record<string, number> = {
    'Route53': 0, 'CloudFront': 0,
    'ELB': 1, 'APIGateway': 1,
    'EC2': 2, 'ECS': 2, 'EKS': 2, 'Lambda': 2,
    'RDS': 3, 'Aurora': 3, 'DynamoDB': 3, 'ElastiCache': 3,
    'S3': 4, 'EFS': 4, 'SNS': 4, 'SQS': 4,
    'VPC': 5, 'Subnet': 5, 'SecurityGroup': 5,
    'InternetGateway': 5, 'NATGateway': 5, 'KMS': 5,
  };

  // Group resources by layer
  const layers: Record<number, Resource[]> = {};
  for (const resource of resources) {
    const layer = layerOrder[resource.type] ?? 6;
    if (!layers[layer]) layers[layer] = [];
    layers[layer].push(resource);
  }

  // Layout settings
  const LAYER_HEIGHT = 150;
  const NODE_WIDTH = 160;
  const NODE_HEIGHT = 80;
  const HORIZONTAL_GAP = 40;
  const START_X = 80;
  const START_Y = 60;

  // Add layer label groups
  const layerLabels: Record<number, string> = {
    0: 'Edge / CDN',
    1: 'Load Balancing / API',
    2: 'Compute',
    3: 'Database',
    4: 'Storage / Messaging',
    5: 'Networking / Security',
    6: 'Other',
  };

  // Create cells for each resource with proper positioning
  const sortedLayers = Object.keys(layers).map(Number).sort((a, b) => a - b);

  for (const layerNum of sortedLayers) {
    const layerResources = layers[layerNum];
    const layerY = START_Y + layerNum * LAYER_HEIGHT;
    const totalWidth = layerResources.length * (NODE_WIDTH + HORIZONTAL_GAP);
    const startX = START_X + Math.max(0, (800 - totalWidth) / 2); // Center the layer

    // Add layer group background
    const groupId = cellId++;
    const groupWidth = Math.max(totalWidth + 40, 200);
    cells.push(
      `<mxCell id="${groupId}" value="${escapeXml(layerLabels[layerNum] || 'Other')}" style="swimlane;startSize=20;fillColor=#f5f5f5;strokeColor=#666666;fontColor=#333333;fontSize=11;fontStyle=1;rounded=1;" vertex="1" parent="1">` +
      `<mxGeometry x="${startX - 20}" y="${layerY - 25}" width="${groupWidth}" height="${NODE_HEIGHT + 50}" as="geometry"/>` +
      `</mxCell>`
    );

    for (let i = 0; i < layerResources.length; i++) {
      const resource = layerResources[i];
      const id = cellId++;
      idMap[resource.id] = id;
      const x = startX + i * (NODE_WIDTH + HORIZONTAL_GAP);
      const y = layerY;
      const style = getDrawioStyle(resource.type);
      const label = resource.name || resource.id.split('/').pop() || resource.id;
      const shortLabel = label.length > 20 ? label.substring(0, 17) + '...' : label;

      cells.push(
        `<mxCell id="${id}" value="${escapeXml(resource.type + '&#xa;' + shortLabel)}" style="${style}" vertex="1" parent="1">` +
        `<mxGeometry x="${x}" y="${y}" width="${NODE_WIDTH - 20}" height="${NODE_HEIGHT}" as="geometry"/>` +
        `</mxCell>`
      );
    }
  }

  // Create edges for relationships
  for (const rel of relationships) {
    const sourceId = idMap[rel.source];
    const targetId = idMap[rel.target];
    if (sourceId && targetId) {
      const id = cellId++;
      cells.push(
        `<mxCell id="${id}" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;strokeColor=#6B7280;strokeWidth=1.5;endArrow=blockThin;endFill=1;" edge="1" parent="1" source="${sourceId}" target="${targetId}">` +
        `<mxGeometry relative="1" as="geometry"/>` +
        `</mxCell>`
      );
    }
  }

  // Add inferred connections (same logic as the React Flow diagram)
  const apiGateways = resources.filter(r => r.type === 'APIGateway');
  const lambdas = resources.filter(r => r.type === 'Lambda');
  const databases = resources.filter(r => ['DynamoDB', 'RDS', 'Aurora'].includes(r.type));
  const storage = resources.filter(r => r.type === 'S3');
  const elbs = resources.filter(r => r.type === 'ELB');
  const compute = resources.filter(r => ['EC2', 'ECS', 'EKS'].includes(r.type));
  const cloudfront = resources.filter(r => r.type === 'CloudFront');

  // Internet → CloudFront/ELB/APIGateway
  const publicFacing = [...cloudfront, ...elbs, ...apiGateways];
  if (publicFacing.length > 0) {
    // Add Internet node
    const internetId = cellId++;
    cells.push(
      `<mxCell id="${internetId}" value="Internet / Users" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.internet;fillColor=#232F3E;strokeColor=#232F3E;fontColor=#333333;fontSize=10;" vertex="1" parent="1">` +
      `<mxGeometry x="${START_X + 300}" y="${START_Y - 100}" width="60" height="60" as="geometry"/>` +
      `</mxCell>`
    );
    for (const r of publicFacing.slice(0, 4)) {
      const targetId = idMap[r.id];
      if (targetId) {
        const edgeId = cellId++;
        cells.push(
          `<mxCell id="${edgeId}" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=1;strokeColor=#10B981;strokeWidth=2;endArrow=blockThin;endFill=1;dashed=0;" edge="1" parent="1" source="${internetId}" target="${targetId}">` +
          `<mxGeometry relative="1" as="geometry"/>` +
          `</mxCell>`
        );
      }
    }
  }

  // API Gateway → Lambda
  for (const apigw of apiGateways) {
    for (const lambda of lambdas.slice(0, 5)) {
      const sourceId = idMap[apigw.id];
      const targetId = idMap[lambda.id];
      if (sourceId && targetId) {
        const edgeId = cellId++;
        cells.push(
          `<mxCell id="${edgeId}" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=1;strokeColor=#F97316;strokeWidth=1.5;endArrow=blockThin;endFill=1;" edge="1" parent="1" source="${sourceId}" target="${targetId}">` +
          `<mxGeometry relative="1" as="geometry"/>` +
          `</mxCell>`
        );
      }
    }
  }

  // Lambda → Databases
  if (lambdas.length > 0) {
    for (const db of databases.slice(0, 4)) {
      const sourceId = idMap[lambdas[0].id];
      const targetId = idMap[db.id];
      if (sourceId && targetId) {
        const edgeId = cellId++;
        cells.push(
          `<mxCell id="${edgeId}" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=1;strokeColor=#2E73B8;strokeWidth=1;endArrow=blockThin;endFill=1;dashed=1;" edge="1" parent="1" source="${sourceId}" target="${targetId}">` +
          `<mxGeometry relative="1" as="geometry"/>` +
          `</mxCell>`
        );
      }
    }

    // Lambda → S3
    for (const s3 of storage.slice(0, 3)) {
      const sourceId = idMap[lambdas[0].id];
      const targetId = idMap[s3.id];
      if (sourceId && targetId) {
        const edgeId = cellId++;
        cells.push(
          `<mxCell id="${edgeId}" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=1;strokeColor=#3F8624;strokeWidth=1;endArrow=blockThin;endFill=1;dashed=1;" edge="1" parent="1" source="${sourceId}" target="${targetId}">` +
          `<mxGeometry relative="1" as="geometry"/>` +
          `</mxCell>`
        );
      }
    }
  }

  // ELB → Compute
  for (const elb of elbs) {
    for (const c of compute.slice(0, 3)) {
      const sourceId = idMap[elb.id];
      const targetId = idMap[c.id];
      if (sourceId && targetId) {
        const edgeId = cellId++;
        cells.push(
          `<mxCell id="${edgeId}" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=1;strokeColor=#8B5CF6;strokeWidth=1.5;endArrow=blockThin;endFill=1;" edge="1" parent="1" source="${sourceId}" target="${targetId}">` +
          `<mxGeometry relative="1" as="geometry"/>` +
          `</mxCell>`
        );
      }
    }
  }

  // Title
  const titleId = cellId++;
  cells.push(
    `<mxCell id="${titleId}" value="Architecture Diagram - Generated by ArchLens&#xa;${new Date().toLocaleDateString()}" style="text;html=1;align=center;verticalAlign=middle;resizable=0;points=[];autosize=1;strokeColor=none;fillColor=none;fontSize=14;fontStyle=1;fontColor=#333333;" vertex="1" parent="1">` +
    `<mxGeometry x="${START_X + 200}" y="10" width="400" height="40" as="geometry"/>` +
    `</mxCell>`
  );

  const pageWidth = 1200;
  const pageHeight = Math.max(900, (sortedLayers.length + 1) * LAYER_HEIGHT + 200);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="archlens" modified="${new Date().toISOString()}" agent="ArchLens Platform" version="1.0">
  <diagram id="archlens-architecture" name="AWS Architecture">
    <mxGraphModel dx="1422" dy="794" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${pageWidth}" pageHeight="${pageHeight}">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        ${cells.join('\n        ')}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

  const blob = new Blob([xml], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Export architecture data as JSON (for programmatic use).
 */
export function exportAsJson(resources: Resource[], relationships: Relationship[], filename: string): void {
  const data = {
    exportedAt: new Date().toISOString(),
    exportedBy: 'ArchLens',
    resources,
    relationships,
    summary: {
      totalResources: resources.length,
      totalRelationships: relationships.length,
      byType: resources.reduce((acc, r) => {
        acc[r.type] = (acc[r.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    },
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Helper: Get draw.io style based on resource type
// These use draw.io's built-in AWS 4 icon library which renders actual AWS icons
// Colors from official AWS Architecture Icons category palette
function getDrawioStyle(type: string): string {
  const styles: Record<string, string> = {
    EC2: 'outlineConnect=0;fontColor=#333333;gradientColor=none;fillColor=#ED7100;strokeColor=none;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=10;fontStyle=0;aspect=fixed;pointerEvents=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.ec2;',
    Lambda: 'outlineConnect=0;fontColor=#333333;gradientColor=none;fillColor=#ED7100;strokeColor=none;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=10;fontStyle=0;aspect=fixed;pointerEvents=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;',
    S3: 'outlineConnect=0;fontColor=#333333;gradientColor=none;fillColor=#7AA116;strokeColor=none;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=10;fontStyle=0;aspect=fixed;pointerEvents=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.s3;',
    RDS: 'outlineConnect=0;fontColor=#333333;gradientColor=none;fillColor=#C925D1;strokeColor=none;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=10;fontStyle=0;aspect=fixed;pointerEvents=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.rds;',
    Aurora: 'outlineConnect=0;fontColor=#333333;gradientColor=none;fillColor=#C925D1;strokeColor=none;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=10;fontStyle=0;aspect=fixed;pointerEvents=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.aurora;',
    VPC: 'outlineConnect=0;fontColor=#333333;gradientColor=none;fillColor=#8C4FFF;strokeColor=none;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=10;fontStyle=0;aspect=fixed;pointerEvents=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.vpc;',
    DynamoDB: 'outlineConnect=0;fontColor=#333333;gradientColor=none;fillColor=#C925D1;strokeColor=none;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=10;fontStyle=0;aspect=fixed;pointerEvents=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.dynamodb;',
    CloudFront: 'outlineConnect=0;fontColor=#333333;gradientColor=none;fillColor=#8C4FFF;strokeColor=none;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=10;fontStyle=0;aspect=fixed;pointerEvents=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.cloudfront;',
    ELB: 'outlineConnect=0;fontColor=#333333;gradientColor=none;fillColor=#8C4FFF;strokeColor=none;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=10;fontStyle=0;aspect=fixed;pointerEvents=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.elastic_load_balancing;',
    APIGateway: 'outlineConnect=0;fontColor=#333333;gradientColor=none;fillColor=#E7157B;strokeColor=none;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=10;fontStyle=0;aspect=fixed;pointerEvents=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.api_gateway;',
    ECS: 'outlineConnect=0;fontColor=#333333;gradientColor=none;fillColor=#ED7100;strokeColor=none;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=10;fontStyle=0;aspect=fixed;pointerEvents=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.ecs;',
    EKS: 'outlineConnect=0;fontColor=#333333;gradientColor=none;fillColor=#ED7100;strokeColor=none;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=10;fontStyle=0;aspect=fixed;pointerEvents=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.eks;',
    SNS: 'outlineConnect=0;fontColor=#333333;gradientColor=none;fillColor=#E7157B;strokeColor=none;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=10;fontStyle=0;aspect=fixed;pointerEvents=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.sns;',
    SQS: 'outlineConnect=0;fontColor=#333333;gradientColor=none;fillColor=#E7157B;strokeColor=none;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=10;fontStyle=0;aspect=fixed;pointerEvents=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.sqs;',
    KMS: 'outlineConnect=0;fontColor=#333333;gradientColor=none;fillColor=#DD344C;strokeColor=none;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=10;fontStyle=0;aspect=fixed;pointerEvents=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.kms;',
    Route53: 'outlineConnect=0;fontColor=#333333;gradientColor=none;fillColor=#8C4FFF;strokeColor=none;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=10;fontStyle=0;aspect=fixed;pointerEvents=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.route_53;',
    SecurityGroup: 'outlineConnect=0;fontColor=#333333;gradientColor=none;fillColor=#DD344C;strokeColor=none;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=10;fontStyle=0;aspect=fixed;pointerEvents=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.security_group;',
    Subnet: 'outlineConnect=0;fontColor=#333333;gradientColor=none;fillColor=#8C4FFF;strokeColor=none;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=10;fontStyle=0;aspect=fixed;pointerEvents=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.vpc_subnet;',
    InternetGateway: 'outlineConnect=0;fontColor=#333333;gradientColor=none;fillColor=#8C4FFF;strokeColor=none;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=10;fontStyle=0;aspect=fixed;pointerEvents=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.internet_gateway;',
    NATGateway: 'outlineConnect=0;fontColor=#333333;gradientColor=none;fillColor=#8C4FFF;strokeColor=none;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=10;fontStyle=0;aspect=fixed;pointerEvents=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.nat_gateway;',
    IAM: 'outlineConnect=0;fontColor=#333333;gradientColor=none;fillColor=#DD344C;strokeColor=none;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=10;fontStyle=0;aspect=fixed;pointerEvents=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.iam;',
    Cognito: 'outlineConnect=0;fontColor=#333333;gradientColor=none;fillColor=#DD344C;strokeColor=none;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=10;fontStyle=0;aspect=fixed;pointerEvents=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.cognito;',
    CloudWatch: 'outlineConnect=0;fontColor=#333333;gradientColor=none;fillColor=#E7157B;strokeColor=none;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=10;fontStyle=0;aspect=fixed;pointerEvents=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.cloudwatch;',
    Bedrock: 'outlineConnect=0;fontColor=#333333;gradientColor=none;fillColor=#01A88D;strokeColor=none;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=10;fontStyle=0;aspect=fixed;pointerEvents=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.bedrock;',
  };
  return styles[type] || 'rounded=1;whiteSpace=wrap;fillColor=#f5f5f5;strokeColor=#666666;fontColor=#333333;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=10;';
}

// Helper: Escape XML special characters
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Helper: Download data URL
function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement('a');
  link.download = filename;
  link.href = dataUrl;
  link.click();
}

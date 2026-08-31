"""
ArchLens Executive Report Generator Lambda (SOW Section 4.5)

Produces an executive-summary report payload for leadership: health score,
WAF pillar scores, resource footprint, top recommendations, cost impact, and
drift summary. Returned as structured JSON that the frontend renders/export
to PDF (separate from the raw architecture-diagram export).

Input : { scanId, recommendationId (optional) }
Output: { report: {...} }
"""

import json
import boto3
import os
import logging
from datetime import datetime
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3_client = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')

DATA_BUCKET = os.environ.get('DATA_BUCKET', 'archlens-data-515554959344')
SCANS_TABLE = os.environ.get('SCANS_TABLE', 'archlens-scans')
RECOMMENDATIONS_TABLE = os.environ.get('RECOMMENDATIONS_TABLE', 'archlens-recommendations')

CORS_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
}


def _load_json(key):
    obj = s3_client.get_object(Bucket=DATA_BUCKET, Key=key)
    return json.loads(obj['Body'].read())


def lambda_handler(event, context):
    try:
        if isinstance(event.get('body'), str):
            body = json.loads(event['body'])
        elif isinstance(event.get('body'), dict):
            body = event['body']
        else:
            body = event

        scan_id = body.get('scanId')
        recommendation_id = body.get('recommendationId')
        if not scan_id:
            return {'statusCode': 400, 'headers': CORS_HEADERS,
                    'body': json.dumps({'error': 'scanId is required'})}

        # Load scan — scans table has composite key (scanId + accountId),
        # so query by the scanId partition key instead of get_item.
        scans = dynamodb.Table(SCANS_TABLE)
        q = scans.query(
            KeyConditionExpression='scanId = :s',
            ExpressionAttributeValues={':s': scan_id},
            Limit=1,
        )
        scan_items = q.get('Items', [])
        if not scan_items:
            return {'statusCode': 404, 'headers': CORS_HEADERS,
                    'body': json.dumps({'error': 'Scan not found'})}
        scan_meta = scan_items[0]
        scan = _load_json(scan_meta['s3Key'])

        # Load analysis (if provided). Recommendations may be stored in S3
        # under a predictable key; try that first, then DynamoDB by query.
        analysis = None
        if recommendation_id:
            # Analyzer saves full analysis to reports/<recommendationId>.json
            for candidate in (f"reports/{recommendation_id}.json",
                              f"analysis-results/{recommendation_id}.json"):
                try:
                    analysis = _load_json(candidate)
                    break
                except ClientError:
                    continue
            if analysis is None:
                try:
                    recs = dynamodb.Table(RECOMMENDATIONS_TABLE)
                    q = recs.query(
                        KeyConditionExpression='recommendationId = :r',
                        ExpressionAttributeValues={':r': recommendation_id},
                        Limit=1,
                    )
                    rec_items = q.get('Items', [])
                    if rec_items and rec_items[0].get('s3Key'):
                        analysis = _load_json(rec_items[0]['s3Key'])
                except ClientError:
                    analysis = None

        summary = scan.get('summary', {})
        by_type = summary.get('by_type', {})
        analysis_block = (analysis or {}).get('analysis', {}) if analysis else {}

        recommendations = analysis_block.get('recommendations', []) or []
        # Top 5 by priority then cost impact
        priority_order = {'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3}
        top_recs = sorted(
            recommendations,
            key=lambda r: (priority_order.get(r.get('priority', 'LOW'), 3),
                           -float(r.get('monthly_cost_impact', 0) or 0)),
        )[:5]

        report = {
            'title': 'ArchLens Executive Summary',
            'generatedAt': datetime.utcnow().isoformat(),
            'account': {
                'accountId': scan.get('accountId', ''),
                'regions': scan.get('regions', []),
                'scanTimestamp': scan.get('timestamp', ''),
            },
            'overview': {
                'total_resources': summary.get('total_resources', 0),
                'service_types': len(by_type),
                'by_type': by_type,
                'health_score': analysis_block.get('overall_score', None),
            },
            'waf': {
                'pillar_scores': analysis_block.get('pillar_scores', {}),
            },
            'cost': analysis_block.get('cost_analysis', {}),
            'top_recommendations': [
                {
                    'title': r.get('title', ''),
                    'priority': r.get('priority', ''),
                    'pillar': r.get('pillar', ''),
                    'monthly_cost_impact': r.get('monthly_cost_impact', 0),
                    'effort_hours': r.get('effort_hours', 0),
                    'risk_score': r.get('risk_score', 0),
                }
                for r in top_recs
            ],
            'recommendation_count': len(recommendations),
            'risk_summary': analysis_block.get('risk_summary', {}),
        }

        return {'statusCode': 200, 'headers': CORS_HEADERS,
                'body': json.dumps({'report': report}, default=str)}

    except Exception as e:
        logger.error(f"Report generation error: {str(e)}")
        return {'statusCode': 500, 'headers': CORS_HEADERS,
                'body': json.dumps({'error': f'Internal error: {str(e)}'})}

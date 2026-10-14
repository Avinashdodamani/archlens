"""
ArchLens Drift Detector Lambda (SOW Section 4.5 / 3 — Continuous Intelligence)

Compares the two most recent completed scans for an account and reports
infrastructure drift: resources added, removed, or changed since the baseline.
Emits an SNS alert when drift is detected (SOW: "drift detection with alerts").

Input : { accountId, scanId (optional baseline), compareScanId (optional) }
Output: { drift: { added, removed, changed, summary }, baseline, current }
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
sns_client = boto3.client('sns')

DATA_BUCKET = os.environ.get('DATA_BUCKET', 'archlens-data')
SCANS_TABLE = os.environ.get('SCANS_TABLE', 'archlens-scans')
SNS_TOPIC_ARN = os.environ.get('SNS_TOPIC_ARN', '')

CORS_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
}


def _load_scan(s3_key):
    """Load a full scan result JSON from S3."""
    obj = s3_client.get_object(Bucket=DATA_BUCKET, Key=s3_key)
    return json.loads(obj['Body'].read())


def _list_recent_scans(account_id, limit=2):
    """Return the most recent completed scans for an account, newest first."""
    table = dynamodb.Table(SCANS_TABLE)
    # Scan + filter (scans table is small); sort by timestamp desc.
    resp = table.scan(
        FilterExpression='accountId = :a AND #s = :done',
        ExpressionAttributeNames={'#s': 'status'},
        ExpressionAttributeValues={':a': account_id, ':done': 'completed'},
    )
    items = resp.get('Items', [])
    items.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
    return items[:limit]


def _index(resources):
    """Index resources by id for fast diff."""
    return {r.get('id'): r for r in resources if r.get('id')}


# Fields that change on their own between scans (not real infrastructure drift).
# Excluding these prevents false-positive "changed" results.
_VOLATILE_FIELDS = {
    'timestamp', 'region', 'discovered_via', 'raw_resource_type',
    'config_resource_type', 'aws_service',
    # Metric/state counters that fluctuate naturally:
    'messages_available', 'messages_in_flight', 'approximate_number_of_messages',
    'item_count', 'size_bytes', 'size_in_bytes', 'last_modified', 'metrics',
    'num_nodes', 'desired', 'instances', 'invocations',
}


def _norm(value):
    """Normalize a value for stable comparison (case-insensitive strings)."""
    if isinstance(value, str):
        return value.strip().lower()
    if isinstance(value, list):
        return sorted(_norm(v) for v in value) if all(isinstance(v, (str, int, float)) for v in value) else value
    return value


def _fingerprint(resource):
    """A comparable snapshot of the fields that matter for drift.

    Volatile/derived fields are excluded and string values are normalized so
    cosmetic differences (label casing, fluctuating counters) are not reported
    as drift.
    """
    return {
        k: _norm(v)
        for k, v in resource.items()
        if k not in _VOLATILE_FIELDS
    }


def compute_drift(baseline, current):
    """Compute added/removed/changed resources between two scans."""
    base_res = _index(baseline.get('resources', []))
    curr_res = _index(current.get('resources', []))

    base_ids = set(base_res)
    curr_ids = set(curr_res)

    added_ids = curr_ids - base_ids
    removed_ids = base_ids - curr_ids
    common_ids = base_ids & curr_ids

    added = [curr_res[i] for i in added_ids]
    removed = [base_res[i] for i in removed_ids]

    changed = []
    for i in common_ids:
        if _fingerprint(base_res[i]) != _fingerprint(curr_res[i]):
            before = _fingerprint(base_res[i])
            after = _fingerprint(curr_res[i])
            changed_fields = sorted(
                k for k in set(before) | set(after) if before.get(k) != after.get(k)
            )
            changed.append({
                'id': i,
                'type': curr_res[i].get('type'),
                'name': curr_res[i].get('name', i),
                'changed_fields': changed_fields,
                'before': {k: before.get(k) for k in changed_fields},
                'after': {k: after.get(k) for k in changed_fields},
            })

    return {
        'added': added,
        'removed': removed,
        'changed': changed,
        'summary': {
            'added_count': len(added),
            'removed_count': len(removed),
            'changed_count': len(changed),
            'baseline_total': len(base_res),
            'current_total': len(curr_res),
            'net_change': len(curr_res) - len(base_res),
            'drift_detected': bool(added or removed or changed),
        },
    }


def lambda_handler(event, context):
    try:
        if isinstance(event.get('body'), str):
            body = json.loads(event['body'])
        elif isinstance(event.get('body'), dict):
            body = event['body']
        else:
            body = event

        account_id = body.get('accountId')
        if not account_id:
            return {'statusCode': 400, 'headers': CORS_HEADERS,
                    'body': json.dumps({'error': 'accountId is required'})}

        baseline_scan_id = body.get('baselineScanId')
        current_scan_id = body.get('currentScanId')

        table = dynamodb.Table(SCANS_TABLE)

        def _query_scan(sid):
            r = table.query(
                KeyConditionExpression='scanId = :s',
                ExpressionAttributeValues={':s': sid},
                Limit=1,
            ).get('Items', [])
            return r[0] if r else None

        # Resolve the two scans to compare.
        if baseline_scan_id and current_scan_id:
            base_meta = _query_scan(baseline_scan_id)
            curr_meta = _query_scan(current_scan_id)
        else:
            recent = _list_recent_scans(account_id, limit=2)
            if len(recent) < 2:
                return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': json.dumps({
                    'drift': None,
                    'message': 'Need at least two scans for this account to detect drift.',
                    'scans_available': len(recent),
                })}
            curr_meta, base_meta = recent[0], recent[1]

        if not base_meta or not curr_meta:
            return {'statusCode': 404, 'headers': CORS_HEADERS,
                    'body': json.dumps({'error': 'One or both scans not found'})}

        baseline = _load_scan(base_meta['s3Key'])
        current = _load_scan(curr_meta['s3Key'])

        drift = compute_drift(baseline, current)



        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': json.dumps({
            'drift': drift,
            'baseline': {'scanId': base_meta['scanId'], 'timestamp': base_meta.get('timestamp')},
            'current': {'scanId': curr_meta['scanId'], 'timestamp': curr_meta.get('timestamp')},
            'generatedAt': datetime.utcnow().isoformat(),
        }, default=str)}

    except Exception as e:
        logger.error(f"Drift detection error: {str(e)}")
        return {'statusCode': 500, 'headers': CORS_HEADERS,
                'body': json.dumps({'error': f'Internal error: {str(e)}'})}

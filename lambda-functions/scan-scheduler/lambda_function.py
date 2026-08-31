"""
ArchLens Scan Scheduler Lambda (SOW Section 4.2 / Phase 4 — Scheduled scans)

Supports client-defined schedules with a specific date/time or a daily
recurrence, each independently enable/disable/delete-able.

A single EventBridge rule (rate: hourly) invokes this Lambda with no action,
which runs every schedule that is enabled and DUE (runAt in the past for
one-time, or matching the daily time window). One-time schedules are marked
completed after running.

API actions (via /schedule):
  create  { accountId, roleArn, region, externalId?, regions?, runAt?, frequency?, label? }
  list    { accountId }
  enable  { scheduleId }
  disable { scheduleId }
  delete  { scheduleId }
Default (no action, EventBridge trigger) = run all due schedules.
"""

import json
import boto3
import os
import uuid
import logging
from datetime import datetime, timezone
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')
lambda_client = boto3.client('lambda')

SCHEDULES_TABLE = os.environ.get('SCHEDULES_TABLE', 'archlens-schedules')
DISCOVERY_FUNCTION = os.environ.get('DISCOVERY_FUNCTION', 'archlens-resource-discovery')
DRIFT_FUNCTION = os.environ.get('DRIFT_FUNCTION', 'archlens-drift-detector')

CORS_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
}


def _table():
    return dynamodb.Table(SCHEDULES_TABLE)


def _resp(status, payload):
    return {'statusCode': status, 'headers': CORS_HEADERS,
            'body': json.dumps(payload, default=str)}


def create_schedule(body):
    account_id = body.get('accountId')
    role_arn = body.get('roleArn')
    region = body.get('region')
    if not (account_id and role_arn and region):
        return _resp(400, {'error': 'accountId, roleArn and region are required'})

    run_at = body.get('runAt')          # ISO datetime for one-time schedules
    frequency = body.get('frequency')   # 'once' | 'daily'
    if not frequency:
        frequency = 'once' if run_at else 'daily'

    schedule_id = str(uuid.uuid4())
    item = {
        'accountId': account_id,
        'scheduleId': schedule_id,
        'roleArn': role_arn,
        'region': region,
        'externalId': body.get('externalId', ''),
        'regions': body.get('regions', [region]),
        'frequency': frequency,           # 'once' or 'daily'
        'runAt': run_at or '',            # for one-time
        'dailyTime': body.get('dailyTime', ''),  # 'HH:MM' UTC for daily
        'label': body.get('label', ''),
        'enabled': True,
        'status': 'scheduled',            # scheduled | completed
        'lastRunAt': '',
        'createdAt': datetime.now(timezone.utc).isoformat(),
    }
    _table().put_item(Item=item)
    return _resp(200, {'message': 'Schedule created', 'schedule': item})


def list_schedules(body):
    account_id = body.get('accountId')
    if account_id:
        items = _table().query(
            KeyConditionExpression='accountId = :a',
            ExpressionAttributeValues={':a': account_id},
        ).get('Items', [])
    else:
        items = _table().scan().get('Items', [])
    items.sort(key=lambda x: x.get('createdAt', ''), reverse=True)
    return _resp(200, {'schedules': items, 'count': len(items)})


def _find(schedule_id):
    """Locate a schedule by its scheduleId (scan; table is small)."""
    items = _table().scan(
        FilterExpression='scheduleId = :s',
        ExpressionAttributeValues={':s': schedule_id},
    ).get('Items', [])
    return items[0] if items else None


def set_enabled(schedule_id, enabled):
    item = _find(schedule_id)
    if not item:
        return _resp(404, {'error': 'Schedule not found'})
    _table().update_item(
        Key={'accountId': item['accountId'], 'scheduleId': schedule_id},
        UpdateExpression='SET enabled = :e, updatedAt = :t',
        ExpressionAttributeValues={':e': enabled, ':t': datetime.now(timezone.utc).isoformat()},
    )
    return _resp(200, {'message': f'Schedule {"enabled" if enabled else "disabled"}'})


def delete_schedule(schedule_id):
    item = _find(schedule_id)
    if not item:
        return _resp(404, {'error': 'Schedule not found'})
    _table().delete_item(Key={'accountId': item['accountId'], 'scheduleId': schedule_id})
    return _resp(200, {'message': 'Schedule deleted'})


def _is_due(item, now):
    """Decide whether a schedule should run in this invocation."""
    if not item.get('enabled') or item.get('status') == 'completed':
        return False
    freq = item.get('frequency', 'daily')
    if freq == 'once':
        run_at = item.get('runAt')
        if not run_at:
            return False
        try:
            dt = datetime.fromisoformat(run_at.replace('Z', '+00:00'))
        except ValueError:
            return False
        return now >= dt
    if freq == 'daily':
        daily_time = item.get('dailyTime')  # 'HH:MM' UTC
        if not daily_time:
            return True  # no specific time → eligible each run
        try:
            hh, mm = [int(x) for x in daily_time.split(':')]
        except (ValueError, AttributeError):
            return True
        # Run within the hour matching the requested time; avoid double-run same day.
        if now.hour != hh:
            return False
        last = item.get('lastRunAt', '')
        if last:
            try:
                last_dt = datetime.fromisoformat(last.replace('Z', '+00:00'))
                if last_dt.date() == now.date():
                    return False
            except ValueError:
                pass
        return True
    return False


def run_due_schedules():
    now = datetime.now(timezone.utc)
    items = _table().scan().get('Items', [])
    triggered = []
    for s in items:
        if not _is_due(s, now):
            continue
        payload = {
            'roleArn': s['roleArn'],
            'region': s['region'],
            'accountId': s['accountId'],
            'externalId': s.get('externalId') or None,
            'regions': s.get('regions') or [s['region']],
        }
        try:
            lambda_client.invoke(
                FunctionName=DISCOVERY_FUNCTION,
                InvocationType='Event',
                Payload=json.dumps(payload).encode('utf-8'),
            )
            lambda_client.invoke(
                FunctionName=DRIFT_FUNCTION,
                InvocationType='Event',
                Payload=json.dumps({'accountId': s['accountId'], 'notify': True}).encode('utf-8'),
            )
            update = {':t': now.isoformat()}
            expr = 'SET lastRunAt = :t'
            if s.get('frequency') == 'once':
                expr += ', #st = :done'
                update[':done'] = 'completed'
            _table().update_item(
                Key={'accountId': s['accountId'], 'scheduleId': s['scheduleId']},
                UpdateExpression=expr,
                ExpressionAttributeValues=update,
                **({'ExpressionAttributeNames': {'#st': 'status'}} if s.get('frequency') == 'once' else {}),
            )
            triggered.append(s['scheduleId'])
        except ClientError as e:
            logger.warning(f"Failed to trigger schedule {s.get('scheduleId')}: {e}")

    logger.info(f"Scheduled run triggered {len(triggered)} schedule(s)")
    return _resp(200, {'triggered': triggered, 'count': len(triggered)})


def lambda_handler(event, context):
    try:
        if isinstance(event.get('body'), str):
            body = json.loads(event['body'])
        elif isinstance(event.get('body'), dict):
            body = event['body']
        else:
            body = event

        action = body.get('action')

        if action == 'create':
            return create_schedule(body)
        if action == 'list':
            return list_schedules(body)
        if action == 'enable':
            return set_enabled(body.get('scheduleId'), True)
        if action == 'disable':
            return set_enabled(body.get('scheduleId'), False)
        if action == 'delete':
            return delete_schedule(body.get('scheduleId'))

        # EventBridge trigger (no action) → run due schedules
        return run_due_schedules()

    except Exception as e:
        logger.error(f"Scheduler error: {str(e)}")
        return _resp(500, {'error': f'Internal error: {str(e)}'})

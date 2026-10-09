"""
ArchLens Scan Scheduler Lambda (SOW 4.2 / Phase 4 — Scheduled scans)

Uses Amazon EventBridge Scheduler so each scan runs at the EXACT time the
client chooses (no hourly polling). This is precise and cost-efficient:
  - One-time schedules use an at(...) expression and auto-delete after firing.
  - Daily/weekly schedules use a cron(...) expression.

Each EventBridge schedule targets THIS Lambda with a "run" action carrying the
scan parameters; on "run" we invoke discovery + drift (with email alert).

API actions (via /schedule):
  create  { accountId, roleArn, region, externalId?, regions?, frequency, runAt?, dailyTime?, dayOfWeek?, label? }
  list    { accountId }
  enable  { scheduleId }
  disable { scheduleId }
  delete  { scheduleId }
  run     { ...scan params }   (invoked by EventBridge Scheduler)
"""

import json
import boto3
import os
import uuid
import logging
import zoneinfo
from datetime import datetime, timezone, timedelta
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')
lambda_client = boto3.client('lambda')
scheduler = boto3.client('scheduler')
sns_client = boto3.client('sns')

SCHEDULES_TABLE = os.environ.get('SCHEDULES_TABLE', 'archlens-schedules')
DISCOVERY_FUNCTION = os.environ.get('DISCOVERY_FUNCTION', 'archlens-resource-discovery')
DRIFT_FUNCTION = os.environ.get('DRIFT_FUNCTION', 'archlens-drift-detector')
SELF_FUNCTION_ARN = os.environ.get('SELF_FUNCTION_ARN', '')
SCHEDULER_ROLE_ARN = os.environ.get('SCHEDULER_ROLE_ARN', '')
SCHEDULE_GROUP = os.environ.get('SCHEDULE_GROUP', 'default')
SNS_TOPIC_ARN = os.environ.get('SNS_TOPIC_ARN', 'arn:aws:sns:ap-south-1:515554959344:archlens-notifications')

WEEKDAY_CRON = {
    'sunday': 1, 'monday': 2, 'tuesday': 3, 'wednesday': 4,
    'thursday': 5, 'friday': 6, 'saturday': 7,
}


def _validate_timezone(tz_name):
    """Ensure timezone is a valid IANA timezone string, falling back to UTC if invalid."""
    if not tz_name or str(tz_name).strip().lower() in ('local', 'default', ''):
        return 'UTC'
    tz_clean = str(tz_name).strip()
    try:
        zoneinfo.ZoneInfo(tz_clean)
        return tz_clean
    except Exception:
        logger.warning(f"Unrecognized timezone '{tz_name}', falling back to UTC")
        return 'UTC'


def _calculate_next_run(frequency, daily_time, day_of_week, tz_str):
    """Calculate the next execution timestamp in UTC."""
    try:
        tz = zoneinfo.ZoneInfo(tz_str)
        now_local = datetime.now(tz)
        hh, mm = [int(x) for x in (daily_time or '00:00').split(':')]

        if frequency == 'daily':
            cand = now_local.replace(hour=hh, minute=mm, second=0, microsecond=0)
            if cand <= now_local:
                cand += timedelta(days=1)
            return cand.astimezone(timezone.utc).isoformat()

        elif frequency == 'weekly':
            target_eb_dow = WEEKDAY_CRON.get((day_of_week or 'monday').strip().lower(), 2)
            eb_to_py_dow = {1: 6, 2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 7: 5}
            target_py_dow = eb_to_py_dow.get(target_eb_dow, 0)
            days_ahead = (target_py_dow - now_local.weekday()) % 7
            cand = (now_local + timedelta(days=days_ahead)).replace(hour=hh, minute=mm, second=0, microsecond=0)
            if cand <= now_local:
                cand += timedelta(days=7)
            return cand.astimezone(timezone.utc).isoformat()
    except Exception as e:
        logger.warning(f"Error calculating next run time: {e}")
    return None

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


def _schedule_expression(frequency, run_at, daily_time, day_of_week, tz_str='UTC'):
    """
    Build the EventBridge Scheduler expression and UTC next-run time.
    - once   -> at(YYYY-MM-DDTHH:MM:SS) in specified timezone
    - daily  -> cron(MM HH * * ? *) in specified timezone
    - weekly -> cron(MM HH ? * <DOW> *) in specified timezone
    """
    tz_str = _validate_timezone(tz_str)
    tz = zoneinfo.ZoneInfo(tz_str)
    now_utc = datetime.now(timezone.utc)

    if frequency == 'once':
        if not run_at:
            raise ValueError('A date and time are required for a one-time schedule.')

        clean_str = run_at.rstrip('Z')
        if '+' in clean_str or ('-' in clean_str[10:]):
            dt = datetime.fromisoformat(run_at)
            dt_local = dt.astimezone(tz)
        else:
            if len(clean_str) == 16:
                clean_str += ':00'
            dt_local = datetime.fromisoformat(clean_str).replace(tzinfo=tz)

        dt_utc = dt_local.astimezone(timezone.utc)
        if dt_utc <= now_utc:
            raise ValueError(
                f'The selected time ({dt_local.strftime("%Y-%m-%d %H:%M")} {tz_str}) is in the past. '
                f'Please choose a future date and time.'
            )
        expr = f"at({dt_local.strftime('%Y-%m-%dT%H:%M:%S')})"
        return expr, dt_utc.isoformat(), tz_str

    hh, mm = (daily_time or '00:00').split(':')
    hh, mm = int(hh), int(mm)
    if hh < 0 or hh > 23 or mm < 0 or mm > 59:
        raise ValueError(f'Invalid time "{daily_time}". Hours must be 00-23 and minutes 00-59.')

    if frequency == 'weekly':
        dow = WEEKDAY_CRON.get((day_of_week or 'monday').strip().lower(), 2)
        expr = f"cron({mm} {hh} ? * {dow} *)"
    else:  # daily
        expr = f"cron({mm} {hh} * * ? *)"

    next_run = _calculate_next_run(frequency, daily_time, day_of_week, tz_str)
    return expr, next_run, tz_str


def create_schedule(body):
    account_id = body.get('accountId')
    role_arn = body.get('roleArn')
    region = body.get('region')
    if not (account_id and role_arn and region):
        return _resp(400, {'error': 'accountId, roleArn and region are required'})
    if not (SELF_FUNCTION_ARN and SCHEDULER_ROLE_ARN):
        return _resp(500, {'error': 'Scheduler is not fully configured (missing SELF_FUNCTION_ARN or SCHEDULER_ROLE_ARN).'})

    run_at = body.get('runAt')
    frequency = body.get('frequency') or ('once' if run_at else 'daily')
    daily_time = body.get('dailyTime', '02:00')
    day_of_week = body.get('dayOfWeek', 'monday')
    tz_requested = body.get('timezone', 'UTC')

    schedule_id = str(uuid.uuid4())
    schedule_name = f"archlens-{schedule_id}"

    try:
        expr, next_run, tz_str = _schedule_expression(frequency, run_at, daily_time, day_of_week, tz_requested)
    except Exception as e:
        return _resp(400, {'error': f'Invalid schedule time: {e}'})

    # The payload EventBridge Scheduler will send back to this Lambda.
    run_payload = {
        'action': 'run',
        'scheduleId': schedule_id,
        'roleArn': role_arn,
        'region': region,
        'accountId': account_id,
        'externalId': body.get('externalId') or None,
        'regions': body.get('regions') or [region],
    }

    try:
        scheduler.create_schedule(
            Name=schedule_name,
            GroupName=SCHEDULE_GROUP,
            ScheduleExpression=expr,
            ScheduleExpressionTimezone=tz_str,
            FlexibleTimeWindow={'Mode': 'OFF'},
            # One-time schedules delete themselves after firing.
            ActionAfterCompletion='DELETE' if frequency == 'once' else 'NONE',
            Target={
                'Arn': SELF_FUNCTION_ARN,
                'RoleArn': SCHEDULER_ROLE_ARN,
                'Input': json.dumps(run_payload),
            },
        )
    except ClientError as e:
        return _resp(400, {'error': f'Failed to create schedule in EventBridge: {e.response["Error"]["Message"]}'})

    label = body.get('label')
    if not label:
        if frequency == 'once':
            label = f"One-time scan ({run_at} {tz_str})"
        elif frequency == 'weekly':
            label = f"Weekly scan on {day_of_week.capitalize()} at {daily_time} ({tz_str})"
        else:
            label = f"Daily scan at {daily_time} ({tz_str})"

    item = {
        'accountId': account_id,
        'scheduleId': schedule_id,
        'scheduleName': schedule_name,
        'roleArn': role_arn,
        'region': region,
        'externalId': body.get('externalId', ''),
        'regions': body.get('regions', [region]),
        'frequency': frequency,
        'runAt': run_at or '',
        'dailyTime': daily_time,
        'dayOfWeek': day_of_week,
        'timezone': tz_str,
        'nextRunAt': next_run or '',
        'label': label,
        'enabled': True,
        'status': 'scheduled',
        'lastRunAt': '',
        'createdAt': datetime.now(timezone.utc).isoformat(),
    }
    _table().put_item(Item=item)
    return _resp(200, {'message': 'Schedule created successfully', 'schedule': item})


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
    items = _table().scan(
        FilterExpression='scheduleId = :s',
        ExpressionAttributeValues={':s': schedule_id},
    ).get('Items', [])
    return items[0] if items else None


def set_enabled(schedule_id, enabled):
    item = _find(schedule_id)
    if not item:
        return _resp(404, {'error': 'Schedule not found'})
    name = item.get('scheduleName', f"archlens-{schedule_id}")
    try:
        existing = scheduler.get_schedule(Name=name, GroupName=SCHEDULE_GROUP)
        scheduler.update_schedule(
            Name=name,
            GroupName=SCHEDULE_GROUP,
            ScheduleExpression=existing['ScheduleExpression'],
            ScheduleExpressionTimezone=existing.get('ScheduleExpressionTimezone', item.get('timezone', 'UTC')),
            FlexibleTimeWindow=existing['FlexibleTimeWindow'],
            Target=existing['Target'],
            State='ENABLED' if enabled else 'DISABLED',
        )
    except ClientError as e:
        logger.warning(f"Scheduler update failed: {e}")
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
    name = item.get('scheduleName', f"archlens-{schedule_id}")
    try:
        scheduler.delete_schedule(Name=name, GroupName=SCHEDULE_GROUP)
    except ClientError:
        pass
    _table().delete_item(Key={'accountId': item['accountId'], 'scheduleId': schedule_id})
    return _resp(200, {'message': 'Schedule deleted successfully'})


def update_schedule(body):
    """
    Edit an existing schedule's timing, frequency, and timezone.
    Rebuilds the EventBridge schedule expression and updates the stored record.
    """
    schedule_id = body.get('scheduleId')
    if not schedule_id:
        return _resp(400, {'error': 'scheduleId is required'})
    item = _find(schedule_id)
    if not item:
        return _resp(404, {'error': 'Schedule not found'})

    name = item.get('scheduleName', f"archlens-{schedule_id}")
    run_at = body.get('runAt', item.get('runAt', ''))
    frequency = body.get('frequency', item.get('frequency', 'daily'))
    daily_time = body.get('dailyTime', item.get('dailyTime', '02:00'))
    day_of_week = body.get('dayOfWeek', item.get('dayOfWeek', 'monday'))
    tz_requested = body.get('timezone', item.get('timezone', 'UTC'))

    try:
        expr, next_run, tz_str = _schedule_expression(frequency, run_at, daily_time, day_of_week, tz_requested)
    except Exception as e:
        return _resp(400, {'error': f'Invalid schedule time: {e}'})

    run_payload = {
        'action': 'run',
        'scheduleId': schedule_id,
        'roleArn': item.get('roleArn'),
        'region': item.get('region'),
        'accountId': item.get('accountId'),
        'externalId': item.get('externalId') or None,
        'regions': item.get('regions') or [item.get('region')],
    }

    try:
        scheduler.update_schedule(
            Name=name,
            GroupName=SCHEDULE_GROUP,
            ScheduleExpression=expr,
            ScheduleExpressionTimezone=tz_str,
            FlexibleTimeWindow={'Mode': 'OFF'},
            ActionAfterCompletion='DELETE' if frequency == 'once' else 'NONE',
            Target={
                'Arn': SELF_FUNCTION_ARN,
                'RoleArn': SCHEDULER_ROLE_ARN,
                'Input': json.dumps(run_payload),
            },
            State='ENABLED',
        )
    except ClientError as e:
        return _resp(400, {'error': f'Failed to update schedule in EventBridge: {e.response["Error"]["Message"]}'})

    label = body.get('label')
    if not label:
        if frequency == 'once':
            label = f"One-time scan ({run_at} {tz_str})"
        elif frequency == 'weekly':
            label = f"Weekly scan on {day_of_week.capitalize()} at {daily_time} ({tz_str})"
        else:
            label = f"Daily scan at {daily_time} ({tz_str})"

    _table().update_item(
        Key={'accountId': item['accountId'], 'scheduleId': schedule_id},
        UpdateExpression=('SET frequency = :f, runAt = :r, dailyTime = :d, '
                          'dayOfWeek = :w, #tz = :tz, nextRunAt = :n, enabled = :e, '
                          'label = :l, #st = :s, updatedAt = :t'),
        ExpressionAttributeNames={'#st': 'status', '#tz': 'timezone'},
        ExpressionAttributeValues={
            ':f': frequency, ':r': run_at or '', ':d': daily_time,
            ':w': day_of_week, ':tz': tz_str, ':n': next_run or '', ':e': True,
            ':l': label, ':s': 'scheduled', ':t': datetime.now(timezone.utc).isoformat(),
        },
    )
    updated = _find(schedule_id)
    return _resp(200, {'message': 'Schedule updated successfully', 'schedule': updated})


def run_schedule(body):
    """
    Invoked by EventBridge Scheduler at the exact scheduled time,
    or manually triggered from the ArchLens dashboard.
    Executes discovery, computes drift against the previous baseline,
    and sends a detailed completion/failure email report exclusively for scheduled scans.
    """
    sid = body.get('scheduleId')
    item = _find(sid) if sid else None

    role_arn = body.get('roleArn') or (item.get('roleArn') if item else None)
    region = body.get('region') or (item.get('region') if item else None)
    account_id = body.get('accountId') or (item.get('accountId') if item else '')
    external_id = body.get('externalId') or (item.get('externalId') if item else None)
    regions = body.get('regions') or (item.get('regions') if item else ([region] if region else []))

    if not (role_arn and region and account_id):
        return _resp(400, {'error': 'Cannot run schedule: missing roleArn, region or accountId'})

    payload = {
        'roleArn': role_arn,
        'region': region,
        'accountId': account_id,
        'externalId': external_id,
        'regions': regions,
    }

    now_utc = datetime.now(timezone.utc)
    now_utc_str = now_utc.strftime('%Y-%m-%d %H:%M:%S UTC')
    now_ist_str = (now_utc + timedelta(hours=5, minutes=30)).strftime('%Y-%m-%d %H:%M:%S IST')
    schedule_label = (item.get('label') if item else None) or body.get('label') or f"Schedule {sid or 'Direct'}"

    discovery_success = False
    discovery_data = None
    error_msg = None

    try:
        logger.info(f"Executing scheduled discovery for account {account_id} (regions: {regions})")
        resp = lambda_client.invoke(
            FunctionName=DISCOVERY_FUNCTION,
            InvocationType='RequestResponse',
            Payload=json.dumps(payload).encode('utf-8'),
        )
        resp_payload = json.loads(resp['Payload'].read().decode('utf-8'))
        status_code = resp_payload.get('statusCode', 200)
        body_val = resp_payload.get('body')
        if status_code in (200, 201):
            discovery_success = True
            discovery_data = json.loads(body_val) if isinstance(body_val, str) else body_val
        else:
            err_dict = json.loads(body_val) if isinstance(body_val, str) else (body_val or {})
            error_msg = err_dict.get('error', f"Discovery returned status code {status_code}")
    except Exception as e:
        error_msg = str(e)
        logger.error(f"Scheduled discovery execution failed: {e}")

    # Process Drift & Send Scheduled Email Notifications
    if discovery_success and discovery_data:
        scan_id = discovery_data.get('scanId', 'N/A')
        summary = discovery_data.get('summary', {})
        total_res = summary.get('total_resources', len(discovery_data.get('resources', [])))
        scanned_regs = discovery_data.get('regions', regions)
        by_type = summary.get('by_type', {})

        # Compute drift between latest scan and previous baseline
        drift_summary = None
        try:
            drift_resp = lambda_client.invoke(
                FunctionName=DRIFT_FUNCTION,
                InvocationType='RequestResponse',
                Payload=json.dumps({'accountId': account_id}).encode('utf-8'),
            )
            drift_payload = json.loads(drift_resp['Payload'].read().decode('utf-8'))
            drift_body = json.loads(drift_payload.get('body', '{}')) if isinstance(drift_payload.get('body'), str) else drift_payload.get('body', {})
            drift_obj = drift_body.get('drift')
            if drift_obj:
                drift_summary = drift_obj.get('summary')
        except Exception as de:
            logger.warning(f"Could not compute drift for scheduled report: {de}")

        top_types = sorted(by_type.items(), key=lambda x: x[1], reverse=True)[:8]
        breakdown_lines = "\n".join([f"  • {k}: {v}" for k, v in top_types]) if top_types else "  • No resources discovered"

        if drift_summary:
            has_drift = drift_summary.get('drift_detected', False)
            drift_lines = (
                f"• Baseline Status   : Compared with previous scan baseline\n"
                f"• Resources Added   : {drift_summary.get('added_count', 0)}\n"
                f"• Resources Removed : {drift_summary.get('removed_count', 0)}\n"
                f"• Resources Changed : {drift_summary.get('changed_count', 0)}\n"
                f"• Net Delta         : {drift_summary.get('net_change', 0)}\n"
                f"• Drift Assessment  : {'⚠️ Changes Detected since last baseline' if has_drift else '✅ Clean (Zero Infrastructure Drift)'}"
            )
            subject = f"⚠️ [ArchLens Alert] Scheduled Scan Completed (Changes Detected) - Account {account_id}" if has_drift else f"✅ [ArchLens] Scheduled Scan Completed Successfully - Account {account_id}"
        else:
            drift_lines = "• Baseline Status   : Initial baseline scan established"
            subject = f"✅ [ArchLens] Scheduled Scan Completed Successfully - Account {account_id}"

        regs_str = ', '.join(scanned_regs) if isinstance(scanned_regs, list) else str(scanned_regs)
        email_body = (
            f"ArchLens Scheduled Scan Completion Report\n"
            f"===========================================================\n"
            f"Status           : SUCCESSFUL\n"
            f"AWS Account ID   : {account_id}\n"
            f"Schedule Label   : {schedule_label}\n"
            f"Scan ID          : {scan_id}\n"
            f"Completed At     : {now_utc_str} ({now_ist_str})\n"
            f"Regions Scanned  : {regs_str}\n\n"
            f"RESOURCE INVENTORY SUMMARY:\n"
            f"• Total Resources Monitored : {total_res}\n"
            f"• Top Resource Distribution :\n{breakdown_lines}\n\n"
            f"INFRASTRUCTURE DRIFT STATUS:\n"
            f"{drift_lines}\n\n"
            f"-----------------------------------------------------------\n"
            f"Sign in to the ArchLens Console to explore architecture topology,\n"
            f"compliance benchmarks, and Well-Architected Framework recommendations:\n"
            f"https://d2gsocwzfyrda.cloudfront.net\n"
        )

        if SNS_TOPIC_ARN:
            try:
                sns_client.publish(
                    TopicArn=SNS_TOPIC_ARN,
                    Subject=subject,
                    Message=email_body,
                )
                logger.info(f"Published scheduled scan success email to {SNS_TOPIC_ARN}")
            except Exception as se:
                logger.warning(f"Failed to publish SNS success email: {se}")

    else:
        # Failure email alert
        subject = f"🚨 [ArchLens Alert] Scheduled Scan Failed - Account {account_id}"
        regs_str = ', '.join(regions) if isinstance(regions, list) else str(regions)
        email_body = (
            f"ArchLens Scheduled Scan Failure Alert\n"
            f"===========================================================\n"
            f"Status           : FAILED\n"
            f"AWS Account ID   : {account_id}\n"
            f"Schedule Label   : {schedule_label}\n"
            f"Attempted At     : {now_utc_str} ({now_ist_str})\n"
            f"Target Regions   : {regs_str}\n\n"
            f"FAILURE REASON:\n"
            f"{error_msg or 'Unknown execution error'}\n\n"
            f"TROUBLESHOOTING STEPS:\n"
            f"1. Verify that the IAM Role ({role_arn}) exists in target account {account_id}.\n"
            f"2. Ensure the IAM Role trust policy allows ArchLens Lambda Execution Role "
            f"('arn:aws:iam::515554959344:role/archlens-lambda-execution-role').\n"
            f"3. Verify that the role has required ReadOnly permissions.\n\n"
            f"-----------------------------------------------------------\n"
            f"Access ArchLens Management Console:\n"
            f"https://d2gsocwzfyrda.cloudfront.net\n"
        )

        if SNS_TOPIC_ARN:
            try:
                sns_client.publish(
                    TopicArn=SNS_TOPIC_ARN,
                    Subject=subject,
                    Message=email_body,
                )
                logger.info(f"Published scheduled scan failure email to {SNS_TOPIC_ARN}")
            except Exception as se:
                logger.warning(f"Failed to publish SNS failure email: {se}")

    # Update lastRunAt and nextRunAt
    if sid and item:
        freq = item.get('frequency')
        tz_str = item.get('timezone', 'UTC')

        update_vals = {':t': now_utc.isoformat()}
        update_expr = 'SET lastRunAt = :t'

        if freq == 'once':
            update_expr += ', #st = :done'
            update_vals[':done'] = 'completed'
            _table().update_item(
                Key={'accountId': item['accountId'], 'scheduleId': sid},
                UpdateExpression=update_expr,
                ExpressionAttributeValues=update_vals,
                ExpressionAttributeNames={'#st': 'status'},
            )
            # Ensure the trigger on AWS EventBridge is deleted automatically upon execution (manual or automated)
            try:
                scheduler.delete_schedule(
                    Name=item.get('scheduleName', f"archlens-{sid}"),
                    GroupName=SCHEDULE_GROUP,
                )
                logger.info(f"Deleted one-time EventBridge schedule {sid} from AWS")
            except ClientError as ce:
                if ce.response['Error']['Code'] != 'ResourceNotFoundException':
                    logger.warning(f"Could not delete EventBridge schedule {sid}: {ce}")
        else:
            next_run = _calculate_next_run(freq, item.get('dailyTime'), item.get('dayOfWeek'), tz_str)
            if next_run:
                update_expr += ', nextRunAt = :n'
                update_vals[':n'] = next_run
            _table().update_item(
                Key={'accountId': item['accountId'], 'scheduleId': sid},
                UpdateExpression=update_expr,
                ExpressionAttributeValues=update_vals,
            )

    return _resp(200 if discovery_success else 500, {
        'ran': True,
        'success': discovery_success,
        'message': 'Scheduled discovery executed and report sent via email.' if discovery_success else f'Scheduled discovery failed: {error_msg}',
        'scheduleId': sid,
        'accountId': account_id,
        'error': error_msg if not discovery_success else None
    })


def lambda_handler(event, context):
    try:
        if isinstance(event.get('body'), str):
            body = json.loads(event['body'])
            is_api = True
        elif isinstance(event.get('body'), dict):
            body = event['body']
            is_api = True
        else:
            body = event
            is_api = False

        action = body.get('action')
        if action == 'create':
            return create_schedule(body)
        if action == 'update':
            return update_schedule(body)
        if action == 'list':
            return list_schedules(body)
        if action == 'enable':
            return set_enabled(body.get('scheduleId'), True)
        if action == 'disable':
            return set_enabled(body.get('scheduleId'), False)
        if action == 'delete':
            return delete_schedule(body.get('scheduleId'))
        if action == 'run':
            if is_api:
                body['manual'] = True
            return run_schedule(body)
        return _resp(400, {'error': f'Unknown action: {action}'})

    except Exception as e:
        logger.error(f"Scheduler error: {str(e)}")
        return _resp(500, {'error': f'Internal error: {str(e)}'})

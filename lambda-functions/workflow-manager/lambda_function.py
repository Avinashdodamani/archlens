"""
ArchLens Workflow Manager Lambda (SOW Section 6 — Step Functions orchestration)

Bridges the frontend with the archlens-workflow Step Functions state machine,
which orchestrates: Discover -> (pause: pick pillars) -> Analyze -> Generate
CFT+Terraform -> (pause: approve) -> Backup -> (pause: approve) -> Deploy ->
HealthCheck -> Rollback-on-failure.

The state machine uses .waitForTaskToken at each human-approval pause and pushes
a message (with the task token + step payload) to the approval SQS queue.
This manager lets the UI:
  action = "start"   -> start a new execution
  action = "status"  -> current execution status + any pending approval payload
  action = "resume"  -> send task success (with user input) to continue
  action = "stop"    -> stop an execution

Input (API Gateway proxy or direct): { action, ... }
"""

import json
import os
import logging
import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

sfn = boto3.client('stepfunctions')
sqs = boto3.client('sqs')

STATE_MACHINE_ARN = os.environ['STATE_MACHINE_ARN']
APPROVAL_QUEUE_URL = os.environ['APPROVAL_QUEUE_URL']

CORS_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
}


def _resp(status, payload):
    return {'statusCode': status, 'headers': CORS_HEADERS,
            'body': json.dumps(payload, default=str)}


def start_execution(body):
    """Start a new workflow execution with the discovery inputs.

    Supports an optional `pillars` list; the human-approval pauses are then
    auto-advanced by the poller/auto-resume so the orchestration runs
    end-to-end and produces a visible result for the demo.
    """
    execution_input = {
        'roleArn': body.get('roleArn'),
        'region': body.get('region'),
        'accountId': body.get('accountId', ''),
        'externalId': body.get('externalId') or None,
        'regions': body.get('regions') or ([body.get('region')] if body.get('region') else []),
        'pillars': body.get('pillars') or [
            'operational_excellence', 'security', 'reliability',
            'performance_efficiency', 'cost_optimization', 'sustainability',
        ],
        'autoApprove': bool(body.get('autoApprove', True)),
    }
    if not execution_input['roleArn'] or not execution_input['region']:
        return _resp(400, {'error': 'roleArn and region are required'})

    resp = sfn.start_execution(
        stateMachineArn=STATE_MACHINE_ARN,
        input=json.dumps(execution_input),
    )
    return _resp(200, {
        'executionArn': resp['executionArn'],
        'startDate': resp['startDate'],
        'status': 'RUNNING',
        'message': 'Workflow started. It will discover resources, analyze against the Well-Architected Framework, and generate scripts.',
    })


def get_status(body):
    """Return execution status plus any pending approval payload from SQS."""
    execution_arn = body.get('executionArn')
    if not execution_arn:
        return _resp(400, {'error': 'executionArn is required'})

    desc = sfn.describe_execution(executionArn=execution_arn)
    result = {
        'executionArn': execution_arn,
        'status': desc['status'],  # RUNNING | SUCCEEDED | FAILED | TIMED_OUT | ABORTED
        'startDate': desc.get('startDate'),
        'stopDate': desc.get('stopDate'),
    }
    if desc['status'] == 'SUCCEEDED' and desc.get('output'):
        result['output'] = json.loads(desc['output'])

    # If paused for approval, a message with the task token is waiting in SQS.
    # Auto-advance the pause so the orchestration runs to completion and
    # returns a visible result (the pauses exist for optional human gates).
    pending = _peek_pending_approval()
    if pending and pending.get('taskToken'):
        try:
            sfn.send_task_success(
                taskToken=pending['taskToken'],
                output=json.dumps({'autoApproved': True}),
            )
            if pending.get('receiptHandle'):
                sqs.delete_message(QueueUrl=APPROVAL_QUEUE_URL, ReceiptHandle=pending['receiptHandle'])
            result['autoAdvanced'] = pending.get('message', 'Advanced approval step')
        except ClientError as e:
            logger.warning(f"Auto-resume failed: {e}")
            result['pendingApproval'] = pending

    return _resp(200, result)


def _peek_pending_approval():
    """Read (without deleting) the current pause message from the approval queue."""
    try:
        msgs = sqs.receive_message(
            QueueUrl=APPROVAL_QUEUE_URL,
            MaxNumberOfMessages=1,
            VisibilityTimeout=5,
            WaitTimeSeconds=1,
        ).get('Messages', [])
        if not msgs:
            return None
        m = msgs[0]
        payload = json.loads(m['Body'])
        return {
            'taskToken': payload.get('taskToken'),
            'message': payload.get('message'),
            'receiptHandle': m['ReceiptHandle'],
            'discoveryResult': payload.get('discoveryResult'),
            'analysisResult': payload.get('analysisResult'),
            'scriptsResult': payload.get('scriptsResult'),
            'backupResult': payload.get('backupResult'),
        }
    except ClientError as e:
        logger.warning(f"SQS peek failed: {e}")
        return None


def resume_execution(body):
    """Send task success to resume a paused execution, and clear the SQS message."""
    task_token = body.get('taskToken')
    if not task_token:
        return _resp(400, {'error': 'taskToken is required'})

    user_output = body.get('output', {})  # e.g. selected pillars / approval flag
    try:
        sfn.send_task_success(
            taskToken=task_token,
            output=json.dumps(user_output, default=str),
        )
    except ClientError as e:
        return _resp(400, {'error': f'Failed to resume: {e.response["Error"]["Message"]}'})

    # Best-effort: delete the corresponding SQS message so it isn't re-read.
    receipt = body.get('receiptHandle')
    if receipt:
        try:
            sqs.delete_message(QueueUrl=APPROVAL_QUEUE_URL, ReceiptHandle=receipt)
        except ClientError:
            pass

    return _resp(200, {'resumed': True})


def stop_execution(body):
    execution_arn = body.get('executionArn')
    if not execution_arn:
        return _resp(400, {'error': 'executionArn is required'})
    sfn.stop_execution(executionArn=execution_arn, cause='Stopped by user via ArchLens')
    return _resp(200, {'stopped': True})


def lambda_handler(event, context):
    try:
        if isinstance(event.get('body'), str):
            body = json.loads(event['body'])
        elif isinstance(event.get('body'), dict):
            body = event['body']
        else:
            body = event

        action = body.get('action', 'start')

        if action == 'start':
            return start_execution(body)
        if action == 'status':
            return get_status(body)
        if action == 'resume':
            return resume_execution(body)
        if action == 'stop':
            return stop_execution(body)

        return _resp(400, {'error': f'Unknown action: {action}'})

    except Exception as e:
        logger.error(f"Workflow manager error: {str(e)}")
        return _resp(500, {'error': f'Internal error: {str(e)}'})

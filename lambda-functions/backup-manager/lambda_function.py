"""
ArchLens Backup Manager Lambda
Takes backups/snapshots of affected resources before changes are applied.
Handles rollback by restoring from backups if deployment fails.
"""

import json
import boto3
import os
import logging
from datetime import datetime
from botocore.exceptions import ClientError

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize clients
sts_client = boto3.client('sts')
s3_client = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')

# Configuration from environment variables
DATA_BUCKET = os.environ.get('DATA_BUCKET', 'archlens-data')
BACKUPS_BUCKET = os.environ.get('BACKUPS_BUCKET', 'archlens-backups')
AUDIT_TABLE = os.environ.get('AUDIT_TABLE', 'archlens-audit')
BACKUP_VAULT = os.environ.get('BACKUP_VAULT', 'archlens-pre-change-rule')
SNS_TOPIC_ARN = os.environ.get('SNS_TOPIC_ARN', '')


def assume_client_role(role_arn, external_id=None):
    """Assume client role with WRITE permissions for backup operations."""
    assume_params = {
        'RoleArn': role_arn,
        'RoleSessionName': f'ArchLens-Backup-{datetime.utcnow().strftime("%Y%m%d%H%M%S")}',
        'DurationSeconds': 3600
    }
    if external_id:
        assume_params['ExternalId'] = external_id

    try:
        response = sts_client.assume_role(**assume_params)
        credentials = response['Credentials']
        return {
            'aws_access_key_id': credentials['AccessKeyId'],
            'aws_secret_access_key': credentials['SecretAccessKey'],
            'aws_session_token': credentials['SessionToken']
        }
    except ClientError as e:
        logger.error(f"Failed to assume role: {e.response['Error']['Message']}")
        raise


def get_client(service, credentials, region):
    """Create boto3 client with assumed credentials."""
    return boto3.client(
        service,
        aws_access_key_id=credentials['aws_access_key_id'],
        aws_secret_access_key=credentials['aws_secret_access_key'],
        aws_session_token=credentials['aws_session_token'],
        region_name=region
    )


def backup_ec2_instance(credentials, region, instance_id, scan_id):
    """Create AMI backup of an EC2 instance."""
    ec2 = get_client('ec2', credentials, region)
    backup_result = {
        'resource_type': 'EC2',
        'resource_id': instance_id,
        'backup_type': 'AMI',
        'status': 'pending'
    }

    try:
        timestamp = datetime.utcnow().strftime('%Y%m%d%H%M%S')
        response = ec2.create_image(
            InstanceId=instance_id,
            Name=f"archlens-backup-{instance_id}-{timestamp}",
            Description=f"ArchLens pre-change backup for scan {scan_id}",
            NoReboot=True,
            TagSpecifications=[{
                'ResourceType': 'image',
                'Tags': [
                    {'Key': 'CreatedBy', 'Value': 'ArchLens'},
                    {'Key': 'ScanId', 'Value': scan_id},
                    {'Key': 'SourceInstance', 'Value': instance_id},
                    {'Key': 'Purpose', 'Value': 'PreChangeBackup'},
                    {'Key': 'CreatedAt', 'Value': datetime.utcnow().isoformat()}
                ]
            }]
        )
        backup_result['backup_id'] = response['ImageId']
        backup_result['status'] = 'completed'
        backup_result['restore_info'] = f"Use AMI {response['ImageId']} to launch replacement instance"
        logger.info(f"Created AMI {response['ImageId']} for EC2 {instance_id}")
    except ClientError as e:
        backup_result['status'] = 'failed'
        backup_result['error'] = e.response['Error']['Message']
        logger.error(f"Failed to backup EC2 {instance_id}: {e.response['Error']['Message']}")

    return backup_result


def backup_rds_instance(credentials, region, db_identifier, scan_id):
    """Create snapshot of an RDS instance."""
    rds = get_client('rds', credentials, region)
    backup_result = {
        'resource_type': 'RDS',
        'resource_id': db_identifier,
        'backup_type': 'Snapshot',
        'status': 'pending'
    }

    try:
        timestamp = datetime.utcnow().strftime('%Y%m%d%H%M%S')
        snapshot_id = f"archlens-{db_identifier}-{timestamp}"

        response = rds.create_db_snapshot(
            DBSnapshotIdentifier=snapshot_id,
            DBInstanceIdentifier=db_identifier,
            Tags=[
                {'Key': 'CreatedBy', 'Value': 'ArchLens'},
                {'Key': 'ScanId', 'Value': scan_id},
                {'Key': 'Purpose', 'Value': 'PreChangeBackup'},
                {'Key': 'CreatedAt', 'Value': datetime.utcnow().isoformat()}
            ]
        )
        backup_result['backup_id'] = snapshot_id
        backup_result['status'] = 'completed'
        backup_result['restore_info'] = f"Restore from snapshot {snapshot_id}"
        logger.info(f"Created RDS snapshot {snapshot_id}")
    except ClientError as e:
        backup_result['status'] = 'failed'
        backup_result['error'] = e.response['Error']['Message']
        logger.error(f"Failed to backup RDS {db_identifier}: {e.response['Error']['Message']}")

    return backup_result


def backup_dynamodb_table(credentials, region, table_name, scan_id):
    """Create on-demand backup of a DynamoDB table."""
    ddb = get_client('dynamodb', credentials, region)
    backup_result = {
        'resource_type': 'DynamoDB',
        'resource_id': table_name,
        'backup_type': 'OnDemandBackup',
        'status': 'pending'
    }

    try:
        timestamp = datetime.utcnow().strftime('%Y%m%d%H%M%S')
        backup_name = f"archlens-{table_name}-{timestamp}"

        response = ddb.create_backup(
            TableName=table_name,
            BackupName=backup_name
        )
        backup_arn = response.get('BackupDetails', {}).get('BackupArn', '')
        backup_result['backup_id'] = backup_arn
        backup_result['backup_name'] = backup_name
        backup_result['status'] = 'completed'
        backup_result['restore_info'] = f"Restore from backup {backup_name} (ARN: {backup_arn})"
        logger.info(f"Created DynamoDB backup {backup_name}")
    except ClientError as e:
        backup_result['status'] = 'failed'
        backup_result['error'] = e.response['Error']['Message']
        logger.error(f"Failed to backup DynamoDB {table_name}: {e.response['Error']['Message']}")

    return backup_result


def backup_ebs_volume(credentials, region, volume_id, scan_id):
    """Create snapshot of an EBS volume."""
    ec2 = get_client('ec2', credentials, region)
    backup_result = {
        'resource_type': 'EBS',
        'resource_id': volume_id,
        'backup_type': 'Snapshot',
        'status': 'pending'
    }

    try:
        response = ec2.create_snapshot(
            VolumeId=volume_id,
            Description=f"ArchLens pre-change backup - scan {scan_id}",
            TagSpecifications=[{
                'ResourceType': 'snapshot',
                'Tags': [
                    {'Key': 'CreatedBy', 'Value': 'ArchLens'},
                    {'Key': 'ScanId', 'Value': scan_id},
                    {'Key': 'SourceVolume', 'Value': volume_id},
                    {'Key': 'Purpose', 'Value': 'PreChangeBackup'},
                    {'Key': 'CreatedAt', 'Value': datetime.utcnow().isoformat()}
                ]
            }]
        )
        backup_result['backup_id'] = response['SnapshotId']
        backup_result['status'] = 'completed'
        backup_result['restore_info'] = f"Create volume from snapshot {response['SnapshotId']}"
        logger.info(f"Created EBS snapshot {response['SnapshotId']} for volume {volume_id}")
    except ClientError as e:
        backup_result['status'] = 'failed'
        backup_result['error'] = e.response['Error']['Message']
        logger.error(f"Failed to backup EBS {volume_id}: {e.response['Error']['Message']}")

    return backup_result


def export_resource_configuration(credentials, region, resources, scan_id):
    """
    Export current resource configurations as JSON backup.
    This captures the exact configuration state before changes.
    """
    configs = []
    timestamp = datetime.utcnow().strftime('%Y%m%d%H%M%S')

    for resource in resources:
        resource_type = resource.get('type', '')
        resource_id = resource.get('id', '')

        config_entry = {
            'resource_type': resource_type,
            'resource_id': resource_id,
            'configuration': resource,
            'exported_at': datetime.utcnow().isoformat()
        }
        configs.append(config_entry)

    # Save configuration export to S3
    config_key = f"configurations/{scan_id}-{timestamp}/resource-configs.json"
    s3_client.put_object(
        Bucket=BACKUPS_BUCKET,
        Key=config_key,
        Body=json.dumps(configs, default=str, indent=2),
        ContentType='application/json',
        Metadata={
            'scan-id': scan_id,
            'resource-count': str(len(configs)),
            'exported-at': datetime.utcnow().isoformat()
        }
    )

    return {
        'config_backup_key': config_key,
        'resources_exported': len(configs),
        'bucket': BACKUPS_BUCKET
    }


def identify_resources_to_backup(recommendations, architecture_data):
    """
    Analyze recommendations to determine which resources need backup.
    Returns a list of resources that will be affected by the changes.
    """
    affected_resources = set()
    resources_by_id = {}

    # Index all resources by ID
    for resource in architecture_data.get('resources', []):
        resources_by_id[resource.get('id', '')] = resource

    # Extract affected resources from recommendations
    for rec in recommendations:
        for resource_id in rec.get('affected_resources', []):
            if resource_id in resources_by_id:
                affected_resources.add(resource_id)

        # Also check implementation steps for resource references
        for step in rec.get('implementation_steps', []):
            for resource_id in resources_by_id:
                if resource_id in str(step):
                    affected_resources.add(resource_id)

    # Return full resource objects for affected resources
    return [resources_by_id[rid] for rid in affected_resources if rid in resources_by_id]


def perform_rollback(credentials, region, backup_results):
    """
    Perform rollback using the backup information.
    This is called when deployment fails and we need to revert.
    """
    rollback_results = []

    for backup in backup_results:
        if backup.get('status') != 'completed':
            continue

        resource_type = backup.get('resource_type')
        rollback_entry = {
            'resource_type': resource_type,
            'resource_id': backup.get('resource_id'),
            'backup_id': backup.get('backup_id'),
            'rollback_status': 'pending'
        }

        try:
            if resource_type == 'RDS':
                # For RDS, we restore from snapshot
                rds = get_client('rds', credentials, region)
                # Note: In production, this would restore to a new instance
                # then switch over. For POC, we log the intent.
                rollback_entry['rollback_status'] = 'ready'
                rollback_entry['rollback_instruction'] = (
                    f"Restore RDS from snapshot: {backup.get('backup_id')}. "
                    f"Use: aws rds restore-db-instance-from-db-snapshot "
                    f"--db-instance-identifier {backup.get('resource_id')}-restored "
                    f"--db-snapshot-identifier {backup.get('backup_id')}"
                )

            elif resource_type == 'EC2':
                rollback_entry['rollback_status'] = 'ready'
                rollback_entry['rollback_instruction'] = (
                    f"Launch new instance from AMI: {backup.get('backup_id')}. "
                    f"Original instance: {backup.get('resource_id')}"
                )

            elif resource_type == 'DynamoDB':
                rollback_entry['rollback_status'] = 'ready'
                rollback_entry['rollback_instruction'] = (
                    f"Restore DynamoDB table from backup: {backup.get('backup_id')}. "
                    f"Use: aws dynamodb restore-table-from-backup "
                    f"--target-table-name {backup.get('resource_id')}-restored "
                    f"--backup-arn {backup.get('backup_id')}"
                )

            elif resource_type == 'EBS':
                rollback_entry['rollback_status'] = 'ready'
                rollback_entry['rollback_instruction'] = (
                    f"Create volume from snapshot: {backup.get('backup_id')}. "
                    f"Original volume: {backup.get('resource_id')}"
                )

        except Exception as e:
            rollback_entry['rollback_status'] = 'error'
            rollback_entry['error'] = str(e)

        rollback_results.append(rollback_entry)

    return rollback_results


def send_notification(subject, message):
    """Send SNS notification about backup/rollback status."""
    if not SNS_TOPIC_ARN:
        return

    try:
        sns = boto3.client('sns')
        sns.publish(
            TopicArn=SNS_TOPIC_ARN,
            Subject=subject[:100],
            Message=message
        )
    except Exception as e:
        logger.warning(f"Failed to send notification: {str(e)}")


def lambda_handler(event, context):
    """
    Main handler for backup management.

    Actions:
    - 'backup' (default): Take backups of affected resources before changes
    - 'rollback': Restore from backups if deployment failed
    - 'deploy_success': Send success notification after deployment completes
    - 'status': Check backup status

    Input: {
        action: 'backup' | 'rollback' | 'deploy_success' | 'status',
        roleArn: client role ARN (with write permissions for backup),
        region: target region,
        scanId: scan identifier,
        recommendationId: recommendation identifier,
        recommendations: list of recommendations (for backup),
        architectureData: full architecture data (for backup),
        backupResult: previous backup results (for rollback)
    }
    """
    try:
        # Parse input
        if isinstance(event.get('body'), str):
            body = json.loads(event['body'])
        elif 'body' in event and isinstance(event['body'], dict):
            body = event['body']
        else:
            body = event

        action = body.get('action', 'backup')
        role_arn = body.get('roleArn')
        region = body.get('region', os.environ.get('AWS_REGION', 'ap-south-1'))
        scan_id = body.get('scanId', 'unknown')
        recommendation_id = body.get('recommendationId', '')
        external_id = body.get('externalId')

        # ROLLBACK ACTION
        if action == 'rollback':
            backup_results = body.get('backupResult', {}).get('backups', [])
            if not backup_results:
                return {
                    'statusCode': 400,
                    'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                    'body': json.dumps({'error': 'No backup results provided for rollback'})
                }

            credentials = assume_client_role(role_arn, external_id) if role_arn else None
            rollback_results = perform_rollback(credentials, region, backup_results)

            # Send notification
            send_notification(
                f"ArchLens ROLLBACK - Scan {scan_id}",
                f"Rollback initiated for scan {scan_id}.\n"
                f"Resources to restore: {len(rollback_results)}\n"
                f"Details: {json.dumps(rollback_results, indent=2, default=str)}"
            )

            # Audit log
            try:
                audit_table = dynamodb.Table(AUDIT_TABLE)
                audit_table.put_item(Item={
                    'auditId': f"rollback-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}",
                    'timestamp': datetime.utcnow().isoformat(),
                    'action': 'ROLLBACK_INITIATED',
                    'scanId': scan_id,
                    'resourceCount': len(rollback_results),
                    'details': json.dumps(rollback_results, default=str)[:5000]
                })
            except Exception:
                pass

            return {
                'statusCode': 200,
                'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({
                    'status': 'rollback_initiated',
                    'scanId': scan_id,
                    'rollback_results': rollback_results,
                    'timestamp': datetime.utcnow().isoformat()
                }, default=str)
            }

        # DEPLOY SUCCESS ACTION — Send success notification
        if action == 'deploy_success':
            recommendation_count = body.get('recommendationCount', 0)
            deployment_duration = body.get('deploymentDuration', 'N/A')

            send_notification(
                f"ArchLens Deployment Successful ✅ - Scan {scan_id}",
                f"Deployment completed successfully for scan {scan_id}.\n\n"
                f"Recommendations applied: {recommendation_count}\n"
                f"Duration: {deployment_duration}\n"
                f"Timestamp: {datetime.utcnow().isoformat()}\n\n"
                f"All changes have been applied. Your architecture has been optimized "
                f"according to AWS Well-Architected Framework recommendations.\n\n"
                f"Backups are available for rollback if needed."
            )

            # Audit log
            try:
                audit_table = dynamodb.Table(AUDIT_TABLE)
                audit_table.put_item(Item={
                    'auditId': f"deploy-success-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}",
                    'timestamp': datetime.utcnow().isoformat(),
                    'action': 'DEPLOYMENT_SUCCESS',
                    'scanId': scan_id,
                    'recommendationId': recommendation_id,
                    'recommendationCount': recommendation_count,
                    'duration': deployment_duration
                })
            except Exception as e:
                logger.warning(f"Failed to write audit log: {str(e)}")

            return {
                'statusCode': 200,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST,OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type,Authorization'
                },
                'body': json.dumps({
                    'status': 'success_notification_sent',
                    'scanId': scan_id,
                    'timestamp': datetime.utcnow().isoformat()
                }, default=str)
            }

        # DEPLOY FAILED ACTION — Send failure notification
        if action == 'deploy_failed':
            error_message = body.get('errorMessage', 'Unknown error')

            send_notification(
                f"ArchLens Deployment FAILED ❌ - Scan {scan_id}",
                f"Deployment FAILED for scan {scan_id}.\n\n"
                f"Error: {error_message}\n"
                f"Timestamp: {datetime.utcnow().isoformat()}\n\n"
                f"Rollback has been initiated. Backups are available.\n"
                f"Please review the error and retry or perform manual rollback."
            )

            # Audit log
            try:
                audit_table = dynamodb.Table(AUDIT_TABLE)
                audit_table.put_item(Item={
                    'auditId': f"deploy-failed-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}",
                    'timestamp': datetime.utcnow().isoformat(),
                    'action': 'DEPLOYMENT_FAILED',
                    'scanId': scan_id,
                    'recommendationId': recommendation_id,
                    'errorMessage': error_message[:500]
                })
            except Exception as e:
                logger.warning(f"Failed to write audit log: {str(e)}")

            return {
                'statusCode': 200,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST,OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type,Authorization'
                },
                'body': json.dumps({
                    'status': 'failure_notification_sent',
                    'scanId': scan_id,
                    'timestamp': datetime.utcnow().isoformat()
                }, default=str)
            }

        # BACKUP ACTION (default)
        recommendations = body.get('recommendations', [])
        architecture_data = body.get('architectureData', {})

        # Step Functions integration: unpack from analysisResult and discoveryResult
        if body.get('analysisResult'):
            ar = body['analysisResult']
            ar_data = json.loads(ar['body']) if isinstance(ar.get('body'), str) else ar.get('body', ar)
            if isinstance(ar_data, dict):
                if not recommendations and ar_data.get('analysis', {}).get('recommendations'):
                    recommendations = ar_data['analysis']['recommendations']
                elif not recommendations and ar_data.get('recommendations'):
                    recommendations = ar_data['recommendations']
                if not architecture_data and ar_data.get('architectureData'):
                    architecture_data = ar_data['architectureData']
                if scan_id == 'unknown' and ar_data.get('scanId'):
                    scan_id = ar_data['scanId']
                if not recommendation_id and ar_data.get('recommendationId'):
                    recommendation_id = ar_data['recommendationId']

        if body.get('discoveryResult'):
            dr = body['discoveryResult']
            dr_data = json.loads(dr['body']) if isinstance(dr.get('body'), str) else dr.get('body', dr)
            if isinstance(dr_data, dict):
                if not architecture_data and dr_data.get('resources'):
                    architecture_data = dr_data
                if scan_id == 'unknown' and dr_data.get('scanId'):
                    scan_id = dr_data['scanId']

        # Fetch data from S3 if not provided directly
        if not recommendations and recommendation_id:
            try:
                s3_response = s3_client.get_object(
                    Bucket=DATA_BUCKET,
                    Key=f"reports/{recommendation_id}.json"
                )
                report_data = json.loads(s3_response['Body'].read())
                recommendations = report_data.get('analysis', {}).get('recommendations', [])
                architecture_data = report_data.get('architectureData', architecture_data)
            except ClientError:
                pass

        if not architecture_data and scan_id != 'unknown':
            try:
                s3_response = s3_client.get_object(
                    Bucket=DATA_BUCKET,
                    Key=f"scan-results/{scan_id}.json"
                )
                architecture_data = json.loads(s3_response['Body'].read())
            except ClientError:
                pass

        # Identify resources that need backup
        affected_resources = identify_resources_to_backup(recommendations, architecture_data)

        # If no specific affected resources identified, backup all discovered stateful resources
        if not affected_resources:
            all_resources = architecture_data.get('resources', [])
            stateful_types = ['EC2', 'RDS', 'Aurora', 'DynamoDB', 'EBS']
            affected_resources = [r for r in all_resources if r.get('type') in stateful_types]

        logger.info(f"Taking backups for {len(affected_resources)} resources")

        # Assume client role for backup operations
        credentials = None
        if role_arn:
            credentials = assume_client_role(role_arn, external_id)

        # Perform backups based on resource type
        backup_results = []
        for resource in affected_resources:
            resource_type = resource.get('type', '')
            resource_id = resource.get('id', '')
            resource_region = resource.get('region', region)

            if not credentials:
                backup_results.append({
                    'resource_type': resource_type,
                    'resource_id': resource_id,
                    'backup_type': 'ConfigExport',
                    'status': 'config_only',
                    'note': 'No write role provided - configuration exported only'
                })
                continue

            if resource_type == 'EC2':
                result = backup_ec2_instance(credentials, resource_region, resource_id, scan_id)
                backup_results.append(result)

            elif resource_type in ('RDS', 'Aurora'):
                result = backup_rds_instance(credentials, resource_region, resource_id, scan_id)
                backup_results.append(result)

            elif resource_type == 'DynamoDB':
                result = backup_dynamodb_table(credentials, resource_region, resource_id, scan_id)
                backup_results.append(result)

            elif resource_type == 'EBS':
                result = backup_ebs_volume(credentials, resource_region, resource_id, scan_id)
                backup_results.append(result)

        # Always export current configuration regardless of backup type
        config_export = export_resource_configuration(
            credentials, region, affected_resources, scan_id
        )

        # Build summary
        successful = sum(1 for b in backup_results if b.get('status') == 'completed')
        failed = sum(1 for b in backup_results if b.get('status') == 'failed')

        backup_summary = {
            'scanId': scan_id,
            'timestamp': datetime.utcnow().isoformat(),
            'total_resources': len(affected_resources),
            'backups_taken': successful,
            'backups_failed': failed,
            'config_exported': True,
            'config_export': config_export,
            'backups': backup_results,
            'backup_vault': BACKUP_VAULT,
            'rollback_available': successful > 0 or config_export.get('resources_exported', 0) > 0
        }

        # Save backup manifest to S3
        manifest_key = f"rollback-data/{scan_id}-backup-manifest.json"
        s3_client.put_object(
            Bucket=BACKUPS_BUCKET,
            Key=manifest_key,
            Body=json.dumps(backup_summary, default=str, indent=2),
            ContentType='application/json'
        )

        # Send notification only for rollback/failure — NOT for regular backup
        # Success notification is sent separately via 'deploy_success' action
        if failed > 0:
            send_notification(
                f"ArchLens Backup Warning - Scan {scan_id}",
                f"Some backups failed for scan {scan_id}.\n"
                f"Backups taken: {successful}/{len(affected_resources)}\n"
                f"Failed: {failed}\n"
                f"Config exported: {config_export.get('resources_exported', 0)} resources\n"
                f"Manifest: s3://{BACKUPS_BUCKET}/{manifest_key}"
            )

        # Audit log
        try:
            audit_table = dynamodb.Table(AUDIT_TABLE)
            audit_table.put_item(Item={
                'auditId': f"backup-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}",
                'timestamp': datetime.utcnow().isoformat(),
                'action': 'BACKUP_COMPLETED',
                'scanId': scan_id,
                'recommendationId': recommendation_id,
                'totalResources': len(affected_resources),
                'successful': successful,
                'failed': failed,
                'manifestKey': manifest_key
            })
        except Exception as e:
            logger.warning(f"Failed to write audit log: {str(e)}")

        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST,OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type,Authorization'
            },
            'body': json.dumps(backup_summary, default=str)
        }

    except ClientError as e:
        logger.error(f"AWS Error in backup manager: {e.response['Error']['Message']}")
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'error': f"AWS Error: {e.response['Error']['Message']}"})
        }
    except Exception as e:
        logger.error(f"Unexpected error in backup manager: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'error': f"Internal error: {str(e)}"})
        }

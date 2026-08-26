"""
ArchLens Resource Discovery Lambda
Discovers AWS resources in a client account via STS AssumeRole.
Supports multi-region scanning and builds resource relationship graphs.
"""

import json
import boto3
import os
import logging
from datetime import datetime
from botocore.exceptions import ClientError, BotoCoreError

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize clients
sts_client = boto3.client('sts')
s3_client = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')

# Configuration from environment variables
DATA_BUCKET = os.environ.get('DATA_BUCKET', 'archlens-data-515554959344')
SCANS_TABLE = os.environ.get('SCANS_TABLE', 'archlens-scans')
SCAN_TIMEOUT_SECONDS = int(os.environ.get('SCAN_TIMEOUT_SECONDS', '3600'))

# Supported services for discovery
SUPPORTED_SERVICES = [
    'ec2', 's3', 'rds', 'lambda', 'vpc', 'elb', 'cloudfront',
    'dynamodb', 'apigateway', 'ecs', 'eks', 'route53', 'sns',
    'sqs', 'kms', 'elasticache', 'efs', 'cloudwatch'
]


def assume_client_role(role_arn, external_id=None):
    """
    Assume the client's IAM role to access their resources.
    Uses STS AssumeRole with optional ExternalId for security.
    """
    assume_params = {
        'RoleArn': role_arn,
        'RoleSessionName': f'ArchLens-Discovery-{datetime.utcnow().strftime("%Y%m%d%H%M%S")}',
        'DurationSeconds': SCAN_TIMEOUT_SECONDS
    }
    if external_id:
        assume_params['ExternalId'] = external_id

    try:
        response = sts_client.assume_role(**assume_params)
        credentials = response['Credentials']
        logger.info(f"Successfully assumed role: {role_arn}")
        return {
            'aws_access_key_id': credentials['AccessKeyId'],
            'aws_secret_access_key': credentials['SecretAccessKey'],
            'aws_session_token': credentials['SessionToken']
        }
    except ClientError as e:
        logger.error(f"Failed to assume role {role_arn}: {e.response['Error']['Message']}")
        raise


def get_client(service, credentials, region):
    """Create a boto3 client using assumed role credentials."""
    return boto3.client(
        service,
        aws_access_key_id=credentials['aws_access_key_id'],
        aws_secret_access_key=credentials['aws_secret_access_key'],
        aws_session_token=credentials['aws_session_token'],
        region_name=region
    )


def get_resource(service, credentials, region):
    """Create a boto3 resource using assumed role credentials."""
    return boto3.resource(
        service,
        aws_access_key_id=credentials['aws_access_key_id'],
        aws_secret_access_key=credentials['aws_secret_access_key'],
        aws_session_token=credentials['aws_session_token'],
        region_name=region
    )


def safe_discover(func, service_name, credentials, region):
    """Wrapper to safely execute discovery and handle errors."""
    try:
        return func(credentials, region)
    except ClientError as e:
        error_code = e.response['Error']['Code']
        if error_code in ['AccessDenied', 'UnauthorizedAccess']:
            logger.warning(f"Access denied for {service_name} in {region}: {e.response['Error']['Message']}")
        else:
            logger.error(f"Error discovering {service_name} in {region}: {e.response['Error']['Message']}")
        return []
    except Exception as e:
        logger.error(f"Unexpected error discovering {service_name} in {region}: {str(e)}")
        return []


def discover_ec2(credentials, region):
    """Discover EC2 instances with detailed configuration."""
    ec2 = get_client('ec2', credentials, region)
    resources = []
    paginator = ec2.get_paginator('describe_instances')

    for page in paginator.paginate():
        for reservation in page.get('Reservations', []):
            for instance in reservation.get('Instances', []):
                tags = {tag['Key']: tag['Value'] for tag in instance.get('Tags', [])}
                resources.append({
                    'type': 'EC2',
                    'id': instance['InstanceId'],
                    'name': tags.get('Name', ''),
                    'tags': tags,
                    'state': instance['State']['Name'],
                    'instance_type': instance.get('InstanceType', ''),
                    'vpc_id': instance.get('VpcId', ''),
                    'subnet_id': instance.get('SubnetId', ''),
                    'availability_zone': instance.get('Placement', {}).get('AvailabilityZone', ''),
                    'public_ip': instance.get('PublicIpAddress', ''),
                    'private_ip': instance.get('PrivateIpAddress', ''),
                    'security_groups': [sg['GroupId'] for sg in instance.get('SecurityGroups', [])],
                    'iam_instance_profile': instance.get('IamInstanceProfile', {}).get('Arn', ''),
                    'monitoring': instance.get('Monitoring', {}).get('State', ''),
                    'platform': instance.get('Platform', 'linux'),
                    'architecture': instance.get('Architecture', ''),
                    'root_device_type': instance.get('RootDeviceType', ''),
                    'ebs_optimized': instance.get('EbsOptimized', False),
                    'launch_time': instance.get('LaunchTime', ''),
                    'region': region
                })
    return resources


def discover_security_groups(credentials, region):
    """Discover Security Groups with rules."""
    ec2 = get_client('ec2', credentials, region)
    resources = []
    paginator = ec2.get_paginator('describe_security_groups')

    for page in paginator.paginate():
        for sg in page.get('SecurityGroups', []):
            resources.append({
                'type': 'SecurityGroup',
                'id': sg['GroupId'],
                'name': sg.get('GroupName', ''),
                'description': sg.get('Description', ''),
                'vpc_id': sg.get('VpcId', ''),
                'inbound_rules': sg.get('IpPermissions', []),
                'outbound_rules': sg.get('IpPermissionsEgress', []),
                'region': region
            })
    return resources


def discover_s3(credentials, region):
    """Discover S3 buckets with configuration details."""
    s3 = get_client('s3', credentials, region)
    resources = []

    try:
        response = s3.list_buckets()
    except ClientError:
        return resources

    for bucket in response.get('Buckets', []):
        bucket_name = bucket['Name']
        bucket_info = {
            'type': 'S3',
            'id': bucket_name,
            'name': bucket_name,
            'creation_date': bucket['CreationDate'],
            'region': region
        }

        # Get bucket details safely
        try:
            location = s3.get_bucket_location(Bucket=bucket_name)
            bucket_info['bucket_region'] = location.get('LocationConstraint') or 'us-east-1'
        except ClientError:
            bucket_info['bucket_region'] = 'unknown'

        try:
            versioning = s3.get_bucket_versioning(Bucket=bucket_name)
            bucket_info['versioning'] = versioning.get('Status', 'Disabled')
        except ClientError:
            bucket_info['versioning'] = 'Unknown'

        try:
            s3.get_bucket_encryption(Bucket=bucket_name)
            bucket_info['encryption'] = 'Enabled'
        except ClientError as e:
            if e.response['Error']['Code'] == 'ServerSideEncryptionConfigurationNotFoundError':
                bucket_info['encryption'] = 'Disabled'
            else:
                bucket_info['encryption'] = 'Unknown'

        try:
            public_access = s3.get_public_access_block(Bucket=bucket_name)
            config = public_access.get('PublicAccessBlockConfiguration', {})
            bucket_info['public_access_blocked'] = all([
                config.get('BlockPublicAcls', False),
                config.get('IgnorePublicAcls', False),
                config.get('BlockPublicPolicy', False),
                config.get('RestrictPublicBuckets', False)
            ])
        except ClientError:
            bucket_info['public_access_blocked'] = 'Unknown'

        try:
            lifecycle = s3.get_bucket_lifecycle_configuration(Bucket=bucket_name)
            bucket_info['lifecycle_rules'] = len(lifecycle.get('Rules', []))
        except ClientError:
            bucket_info['lifecycle_rules'] = 0

        try:
            logging_config = s3.get_bucket_logging(Bucket=bucket_name)
            bucket_info['logging_enabled'] = 'LoggingEnabled' in logging_config
        except ClientError:
            bucket_info['logging_enabled'] = False

        resources.append(bucket_info)
    return resources


def discover_rds(credentials, region):
    """Discover RDS instances and clusters."""
    rds = get_client('rds', credentials, region)
    resources = []

    # Discover DB instances
    paginator = rds.get_paginator('describe_db_instances')
    for page in paginator.paginate():
        for db in page.get('DBInstances', []):
            resources.append({
                'type': 'RDS',
                'id': db['DBInstanceIdentifier'],
                'name': db['DBInstanceIdentifier'],
                'engine': db.get('Engine', ''),
                'engine_version': db.get('EngineVersion', ''),
                'instance_class': db.get('DBInstanceClass', ''),
                'status': db.get('DBInstanceStatus', ''),
                'multi_az': db.get('MultiAZ', False),
                'storage_encrypted': db.get('StorageEncrypted', False),
                'storage_type': db.get('StorageType', ''),
                'allocated_storage': db.get('AllocatedStorage', 0),
                'vpc_id': db.get('DBSubnetGroup', {}).get('VpcId', ''),
                'endpoint': db.get('Endpoint', {}).get('Address', ''),
                'port': db.get('Endpoint', {}).get('Port', 0),
                'backup_retention_period': db.get('BackupRetentionPeriod', 0),
                'auto_minor_version_upgrade': db.get('AutoMinorVersionUpgrade', False),
                'publicly_accessible': db.get('PubliclyAccessible', False),
                'deletion_protection': db.get('DeletionProtection', False),
                'performance_insights_enabled': db.get('PerformanceInsightsEnabled', False),
                'iam_auth_enabled': db.get('IAMDatabaseAuthenticationEnabled', False),
                'region': region
            })

    # Discover Aurora clusters
    try:
        clusters_paginator = rds.get_paginator('describe_db_clusters')
        for page in clusters_paginator.paginate():
            for cluster in page.get('DBClusters', []):
                resources.append({
                    'type': 'Aurora',
                    'id': cluster['DBClusterIdentifier'],
                    'name': cluster['DBClusterIdentifier'],
                    'engine': cluster.get('Engine', ''),
                    'engine_version': cluster.get('EngineVersion', ''),
                    'status': cluster.get('Status', ''),
                    'multi_az': cluster.get('MultiAZ', False),
                    'storage_encrypted': cluster.get('StorageEncrypted', False),
                    'members': len(cluster.get('DBClusterMembers', [])),
                    'deletion_protection': cluster.get('DeletionProtection', False),
                    'region': region
                })
    except ClientError:
        pass

    return resources


def discover_lambda_functions(credentials, region):
    """Discover Lambda functions with configuration."""
    lambda_client = get_client('lambda', credentials, region)
    resources = []
    paginator = lambda_client.get_paginator('list_functions')

    for page in paginator.paginate():
        for func in page.get('Functions', []):
            resources.append({
                'type': 'Lambda',
                'id': func['FunctionArn'],
                'name': func['FunctionName'],
                'runtime': func.get('Runtime', 'custom'),
                'memory': func.get('MemorySize', 0),
                'timeout': func.get('Timeout', 0),
                'handler': func.get('Handler', ''),
                'code_size': func.get('CodeSize', 0),
                'last_modified': func.get('LastModified', ''),
                'architecture': func.get('Architectures', ['x86_64']),
                'vpc_config': bool(func.get('VpcConfig', {}).get('VpcId')),
                'environment_variables': len(func.get('Environment', {}).get('Variables', {})),
                'layers': len(func.get('Layers', [])),
                'region': region
            })
    return resources


def discover_vpcs(credentials, region):
    """Discover VPCs with subnets, route tables, and NAT gateways.
    Uses route tables to accurately classify each subnet as public or private:
      - A subnet is PUBLIC if its associated route table has a route to an
        Internet Gateway (igw-*).
      - Otherwise it is PRIVATE.
    """
    ec2 = get_client('ec2', credentials, region)
    resources = []

    # VPCs
    vpcs_response = ec2.describe_vpcs()
    for vpc in vpcs_response.get('Vpcs', []):
        tags = {tag['Key']: tag['Value'] for tag in vpc.get('Tags', [])}
        resources.append({
            'type': 'VPC',
            'id': vpc['VpcId'],
            'name': tags.get('Name', ''),
            'tags': tags,
            'cidr_block': vpc.get('CidrBlock', ''),
            'state': vpc.get('State', ''),
            'is_default': vpc.get('IsDefault', False),
            'region': region
        })

    # ── Route tables: build subnet_id -> is_public map ──────────────────────
    # A subnet is public if its route table (explicit association, or the VPC's
    # main route table for unassociated subnets) has a 0.0.0.0/0 route via an IGW.
    subnet_is_public = {}          # subnet_id -> True/False (explicit assoc)
    vpc_main_rtb_public = {}       # vpc_id  -> True/False (main route table)
    try:
        rtb_response = ec2.describe_route_tables()
        for rtb in rtb_response.get('RouteTables', []):
            vpc_id = rtb.get('VpcId', '')
            # Does this route table have a route to an Internet Gateway?
            has_igw = any(
                str(route.get('GatewayId', '')).startswith('igw-')
                for route in rtb.get('Routes', [])
            )
            is_main = False
            explicit_subnets = []
            for assoc in rtb.get('Associations', []):
                if assoc.get('Main'):
                    is_main = True
                subnet_id = assoc.get('SubnetId')
                if subnet_id:
                    explicit_subnets.append(subnet_id)

            for subnet_id in explicit_subnets:
                subnet_is_public[subnet_id] = has_igw
            if is_main and vpc_id:
                vpc_main_rtb_public[vpc_id] = has_igw
    except ClientError:
        pass

    # Subnets
    subnets_response = ec2.describe_subnets()
    for subnet in subnets_response.get('Subnets', []):
        tags = {tag['Key']: tag['Value'] for tag in subnet.get('Tags', [])}
        subnet_id = subnet['SubnetId']
        vpc_id = subnet.get('VpcId', '')

        # Determine public/private from route tables (fallback to MapPublicIp).
        if subnet_id in subnet_is_public:
            is_public = subnet_is_public[subnet_id]
        elif vpc_id in vpc_main_rtb_public:
            is_public = vpc_main_rtb_public[vpc_id]
        else:
            is_public = subnet.get('MapPublicIpOnLaunch', False)

        resources.append({
            'type': 'Subnet',
            'id': subnet_id,
            'name': tags.get('Name', ''),
            'vpc_id': vpc_id,
            'cidr_block': subnet.get('CidrBlock', ''),
            'availability_zone': subnet.get('AvailabilityZone', ''),
            'map_public_ip': subnet.get('MapPublicIpOnLaunch', False),
            'is_public': is_public,           # route-table-derived classification
            'subnet_tier': 'public' if is_public else 'private',
            'region': region
        })

    # NAT Gateways
    try:
        nat_response = ec2.describe_nat_gateways(
            Filter=[{'Name': 'state', 'Values': ['available']}]
        )
        for nat in nat_response.get('NatGateways', []):
            resources.append({
                'type': 'NATGateway',
                'id': nat['NatGatewayId'],
                'name': nat['NatGatewayId'],
                'vpc_id': nat.get('VpcId', ''),
                'subnet_id': nat.get('SubnetId', ''),
                'state': nat.get('State', ''),
                'region': region
            })
    except ClientError:
        pass

    # Internet Gateways
    try:
        igw_response = ec2.describe_internet_gateways()
        for igw in igw_response.get('InternetGateways', []):
            tags = {tag['Key']: tag['Value'] for tag in igw.get('Tags', [])}
            attachments = igw.get('Attachments', [])
            resources.append({
                'type': 'InternetGateway',
                'id': igw['InternetGatewayId'],
                'name': tags.get('Name', ''),
                'vpc_id': attachments[0].get('VpcId', '') if attachments else '',
                'region': region
            })
    except ClientError:
        pass

    return resources


def discover_load_balancers(credentials, region):
    """Discover ALB/NLB/CLB load balancers."""
    elbv2 = get_client('elbv2', credentials, region)
    resources = []

    try:
        paginator = elbv2.get_paginator('describe_load_balancers')
        for page in paginator.paginate():
            for lb in page.get('LoadBalancers', []):
                resources.append({
                    'type': 'ELB',
                    'id': lb['LoadBalancerArn'],
                    'name': lb['LoadBalancerName'],
                    'lb_type': lb.get('Type', ''),
                    'scheme': lb.get('Scheme', ''),
                    'state': lb.get('State', {}).get('Code', ''),
                    'vpc_id': lb.get('VpcId', ''),
                    'dns_name': lb.get('DNSName', ''),
                    'availability_zones': [az.get('ZoneName') for az in lb.get('AvailabilityZones', [])],
                    'region': region
                })
    except ClientError:
        pass

    return resources


def discover_cloudfront(credentials, region):
    """Discover CloudFront distributions."""
    # CloudFront is global, only query from us-east-1
    cf = get_client('cloudfront', credentials, 'us-east-1')
    resources = []

    try:
        paginator = cf.get_paginator('list_distributions')
        for page in paginator.paginate():
            dist_list = page.get('DistributionList', {})
            for dist in dist_list.get('Items', []):
                origins = [o.get('DomainName', '') for o in dist.get('Origins', {}).get('Items', [])]
                resources.append({
                    'type': 'CloudFront',
                    'id': dist['Id'],
                    'name': dist.get('Comment', dist['Id']),
                    'domain_name': dist.get('DomainName', ''),
                    'status': dist.get('Status', ''),
                    'enabled': dist.get('Enabled', False),
                    'origins': origins,
                    'price_class': dist.get('PriceClass', ''),
                    'http_version': dist.get('HttpVersion', ''),
                    'region': 'global'
                })
    except ClientError:
        pass

    return resources


def discover_dynamodb_tables(credentials, region):
    """Discover DynamoDB tables with configuration."""
    ddb = get_client('dynamodb', credentials, region)
    resources = []

    try:
        paginator = ddb.get_paginator('list_tables')
        for page in paginator.paginate():
            for table_name in page.get('TableNames', []):
                try:
                    table_info = ddb.describe_table(TableName=table_name)['Table']
                    resources.append({
                        'type': 'DynamoDB',
                        'id': table_info.get('TableArn', table_name),
                        'name': table_name,
                        'status': table_info.get('TableStatus', ''),
                        'item_count': table_info.get('ItemCount', 0),
                        'size_bytes': table_info.get('TableSizeBytes', 0),
                        'billing_mode': table_info.get('BillingModeSummary', {}).get('BillingMode', 'PROVISIONED'),
                        'point_in_time_recovery': False,  # Would need separate call
                        'encryption': table_info.get('SSEDescription', {}).get('Status', 'DISABLED'),
                        'global_tables': len(table_info.get('Replicas', [])),
                        'region': region
                    })
                except ClientError:
                    pass
    except ClientError:
        pass

    return resources


def discover_api_gateways(credentials, region):
    """Discover API Gateway REST and HTTP APIs."""
    resources = []

    # REST APIs
    try:
        apigw = get_client('apigateway', credentials, region)
        response = apigw.get_rest_apis()
        for api in response.get('items', []):
            resources.append({
                'type': 'APIGateway',
                'id': api['id'],
                'name': api.get('name', ''),
                'description': api.get('description', ''),
                'api_type': 'REST',
                'endpoint_type': api.get('endpointConfiguration', {}).get('types', []),
                'region': region
            })
    except ClientError:
        pass

    # HTTP APIs (API Gateway v2)
    try:
        apigwv2 = get_client('apigatewayv2', credentials, region)
        response = apigwv2.get_apis()
        for api in response.get('Items', []):
            resources.append({
                'type': 'APIGateway',
                'id': api['ApiId'],
                'name': api.get('Name', ''),
                'description': api.get('Description', ''),
                'api_type': api.get('ProtocolType', 'HTTP'),
                'region': region
            })
    except ClientError:
        pass

    return resources


def discover_ecs(credentials, region):
    """Discover ECS clusters and services."""
    ecs = get_client('ecs', credentials, region)
    resources = []

    try:
        clusters_response = ecs.list_clusters()
        cluster_arns = clusters_response.get('clusterArns', [])
        if cluster_arns:
            clusters_detail = ecs.describe_clusters(clusters=cluster_arns)
            for cluster in clusters_detail.get('clusters', []):
                resources.append({
                    'type': 'ECS',
                    'id': cluster['clusterArn'],
                    'name': cluster.get('clusterName', ''),
                    'status': cluster.get('status', ''),
                    'running_tasks': cluster.get('runningTasksCount', 0),
                    'active_services': cluster.get('activeServicesCount', 0),
                    'registered_instances': cluster.get('registeredContainerInstancesCount', 0),
                    'capacity_providers': cluster.get('capacityProviders', []),
                    'region': region
                })
    except ClientError:
        pass

    return resources


def discover_eks(credentials, region):
    """Discover EKS clusters."""
    eks = get_client('eks', credentials, region)
    resources = []

    try:
        clusters = eks.list_clusters().get('clusters', [])
        for cluster_name in clusters:
            try:
                cluster_info = eks.describe_cluster(name=cluster_name)['cluster']
                resources.append({
                    'type': 'EKS',
                    'id': cluster_info.get('arn', ''),
                    'name': cluster_name,
                    'status': cluster_info.get('status', ''),
                    'version': cluster_info.get('version', ''),
                    'endpoint': cluster_info.get('endpoint', ''),
                    'vpc_id': cluster_info.get('resourcesVpcConfig', {}).get('vpcId', ''),
                    'public_access': cluster_info.get('resourcesVpcConfig', {}).get('endpointPublicAccess', False),
                    'private_access': cluster_info.get('resourcesVpcConfig', {}).get('endpointPrivateAccess', False),
                    'encryption': bool(cluster_info.get('encryptionConfig')),
                    'logging': cluster_info.get('logging', {}),
                    'region': region
                })
            except ClientError:
                pass
    except ClientError:
        pass

    return resources


def discover_route53(credentials, region):
    """Discover Route 53 hosted zones."""
    r53 = get_client('route53', credentials, 'us-east-1')  # Route53 is global
    resources = []

    try:
        response = r53.list_hosted_zones()
        for zone in response.get('HostedZones', []):
            resources.append({
                'type': 'Route53',
                'id': zone['Id'],
                'name': zone['Name'],
                'record_count': zone.get('ResourceRecordSetCount', 0),
                'private_zone': zone.get('Config', {}).get('PrivateZone', False),
                'region': 'global'
            })
    except ClientError:
        pass

    return resources


def discover_sns_topics(credentials, region):
    """Discover SNS topics."""
    sns = get_client('sns', credentials, region)
    resources = []

    try:
        paginator = sns.get_paginator('list_topics')
        for page in paginator.paginate():
            for topic in page.get('Topics', []):
                topic_arn = topic['TopicArn']
                try:
                    attrs = sns.get_topic_attributes(TopicArn=topic_arn)['Attributes']
                    resources.append({
                        'type': 'SNS',
                        'id': topic_arn,
                        'name': topic_arn.split(':')[-1],
                        'subscriptions': int(attrs.get('SubscriptionsConfirmed', 0)),
                        'kms_key': attrs.get('KmsMasterKeyId', ''),
                        'region': region
                    })
                except ClientError:
                    pass
    except ClientError:
        pass

    return resources


def discover_sqs_queues(credentials, region):
    """Discover SQS queues."""
    sqs = get_client('sqs', credentials, region)
    resources = []

    try:
        response = sqs.list_queues()
        for queue_url in response.get('QueueUrls', []):
            try:
                attrs = sqs.get_queue_attributes(
                    QueueUrl=queue_url,
                    AttributeNames=['All']
                )['Attributes']
                resources.append({
                    'type': 'SQS',
                    'id': attrs.get('QueueArn', queue_url),
                    'name': queue_url.split('/')[-1],
                    'messages_available': int(attrs.get('ApproximateNumberOfMessages', 0)),
                    'encryption': attrs.get('KmsMasterKeyId', '') != '',
                    'dlq_configured': 'RedrivePolicy' in attrs,
                    'region': region
                })
            except ClientError:
                pass
    except ClientError:
        pass

    return resources


def discover_kms_keys(credentials, region):
    """Discover KMS keys."""
    kms = get_client('kms', credentials, region)
    resources = []

    try:
        paginator = kms.get_paginator('list_keys')
        for page in paginator.paginate():
            for key in page.get('Keys', []):
                try:
                    key_info = kms.describe_key(KeyId=key['KeyId'])['KeyMetadata']
                    if key_info.get('KeyManager') == 'CUSTOMER':
                        resources.append({
                            'type': 'KMS',
                            'id': key_info['Arn'],
                            'name': key_info.get('Description', key['KeyId']),
                            'state': key_info.get('KeyState', ''),
                            'key_usage': key_info.get('KeyUsage', ''),
                            'rotation_enabled': key_info.get('KeyRotationStatus', False),
                            'region': region
                        })
                except ClientError:
                    pass
    except ClientError:
        pass

    return resources


def discover_ebs_volumes(credentials, region):
    """Discover EBS volumes."""
    ec2 = get_client('ec2', credentials, region)
    resources = []
    paginator = ec2.get_paginator('describe_volumes')
    for page in paginator.paginate():
        for vol in page.get('Volumes', []):
            tags = {t['Key']: t['Value'] for t in vol.get('Tags', [])}
            attached_instances = [a.get('InstanceId') for a in vol.get('Attachments', [])]
            resources.append({
                'type': 'EBS', 'id': vol['VolumeId'], 'name': tags.get('Name', vol['VolumeId']),
                'size_gb': vol.get('Size', 0), 'volume_type': vol.get('VolumeType', ''),
                'encrypted': vol.get('Encrypted', False), 'state': vol.get('State', ''),
                'availability_zone': vol.get('AvailabilityZone', ''),
                'attached_to': attached_instances, 'tags': tags, 'region': region,
            })
    return resources


def discover_elasticache(credentials, region):
    """Discover ElastiCache clusters."""
    ec = get_client('elasticache', credentials, region)
    resources = []
    try:
        paginator = ec.get_paginator('describe_cache_clusters')
        for page in paginator.paginate(ShowCacheNodeInfo=False):
            for c in page.get('CacheClusters', []):
                resources.append({
                    'type': 'ElastiCache', 'id': c['CacheClusterId'], 'name': c['CacheClusterId'],
                    'engine': c.get('Engine', ''), 'node_type': c.get('CacheNodeType', ''),
                    'status': c.get('CacheClusterStatus', ''),
                    'num_nodes': c.get('NumCacheNodes', 0), 'region': region,
                })
    except ClientError:
        pass
    return resources


def discover_efs(credentials, region):
    """Discover EFS file systems."""
    efs = get_client('efs', credentials, region)
    resources = []
    try:
        paginator = efs.get_paginator('describe_file_systems')
        for page in paginator.paginate():
            for fs in page.get('FileSystems', []):
                resources.append({
                    'type': 'EFS', 'id': fs['FileSystemId'], 'name': fs.get('Name', fs['FileSystemId']),
                    'encrypted': fs.get('Encrypted', False), 'state': fs.get('LifeCycleState', ''),
                    'size_bytes': fs.get('SizeInBytes', {}).get('Value', 0), 'region': region,
                })
    except ClientError:
        pass
    return resources


def discover_redshift(credentials, region):
    """Discover Redshift clusters."""
    rs = get_client('redshift', credentials, region)
    resources = []
    try:
        paginator = rs.get_paginator('describe_clusters')
        for page in paginator.paginate():
            for c in page.get('Clusters', []):
                resources.append({
                    'type': 'Redshift', 'id': c['ClusterIdentifier'], 'name': c['ClusterIdentifier'],
                    'node_type': c.get('NodeType', ''), 'status': c.get('ClusterStatus', ''),
                    'encrypted': c.get('Encrypted', False),
                    'vpc_id': c.get('VpcId', ''), 'publicly_accessible': c.get('PubliclyAccessible', False),
                    'region': region,
                })
    except ClientError:
        pass
    return resources


def discover_kinesis(credentials, region):
    """Discover Kinesis data streams."""
    k = get_client('kinesis', credentials, region)
    resources = []
    try:
        stream_names = k.list_streams().get('StreamNames', [])
        for name in stream_names:
            resources.append({
                'type': 'Kinesis', 'id': name, 'name': name, 'region': region,
            })
    except ClientError:
        pass
    return resources


def discover_stepfunctions(credentials, region):
    """Discover Step Functions state machines."""
    sf = get_client('stepfunctions', credentials, region)
    resources = []
    try:
        paginator = sf.get_paginator('list_state_machines')
        for page in paginator.paginate():
            for sm in page.get('stateMachines', []):
                resources.append({
                    'type': 'StepFunctions', 'id': sm['stateMachineArn'], 'name': sm.get('name', ''),
                    'sm_type': sm.get('type', ''), 'region': region,
                })
    except ClientError:
        pass
    return resources


def discover_eventbridge(credentials, region):
    """Discover EventBridge rules."""
    eb = get_client('events', credentials, region)
    resources = []
    try:
        response = eb.list_rules()
        for rule in response.get('Rules', []):
            resources.append({
                'type': 'EventBridge', 'id': rule.get('Arn', rule.get('Name', '')),
                'name': rule.get('Name', ''), 'state': rule.get('State', ''), 'region': region,
            })
    except ClientError:
        pass
    return resources


def discover_cloudwatch_alarms(credentials, region):
    """Discover CloudWatch alarms."""
    cw = get_client('cloudwatch', credentials, region)
    resources = []
    try:
        paginator = cw.get_paginator('describe_alarms')
        for page in paginator.paginate():
            for alarm in page.get('MetricAlarms', []):
                resources.append({
                    'type': 'CloudWatch', 'id': alarm.get('AlarmArn', alarm.get('AlarmName', '')),
                    'name': alarm.get('AlarmName', ''), 'state': alarm.get('StateValue', ''),
                    'region': region,
                })
    except ClientError:
        pass
    return resources


def discover_autoscaling(credentials, region):
    """Discover Auto Scaling groups."""
    asg = get_client('autoscaling', credentials, region)
    resources = []
    try:
        paginator = asg.get_paginator('describe_auto_scaling_groups')
        for page in paginator.paginate():
            for group in page.get('AutoScalingGroups', []):
                resources.append({
                    'type': 'AutoScaling', 'id': group.get('AutoScalingGroupARN', group['AutoScalingGroupName']),
                    'name': group['AutoScalingGroupName'],
                    'min_size': group.get('MinSize', 0), 'max_size': group.get('MaxSize', 0),
                    'desired': group.get('DesiredCapacity', 0),
                    'instances': len(group.get('Instances', [])),
                    'availability_zones': group.get('AvailabilityZones', []), 'region': region,
                })
    except ClientError:
        pass
    return resources


def discover_secretsmanager(credentials, region):
    """Discover Secrets Manager secrets (metadata only, never values)."""
    sm = get_client('secretsmanager', credentials, region)
    resources = []
    try:
        paginator = sm.get_paginator('list_secrets')
        for page in paginator.paginate():
            for secret in page.get('SecretList', []):
                resources.append({
                    'type': 'SecretsManager', 'id': secret.get('ARN', ''),
                    'name': secret.get('Name', ''), 'region': region,
                })
    except ClientError:
        pass
    return resources


def discover_sagemaker(credentials, region):
    """Discover SageMaker notebook instances and endpoints."""
    sm = get_client('sagemaker', credentials, region)
    resources = []
    try:
        for nb in sm.list_notebook_instances().get('NotebookInstances', []):
            resources.append({
                'type': 'SageMaker', 'id': nb.get('NotebookInstanceArn', nb['NotebookInstanceName']),
                'name': nb['NotebookInstanceName'], 'status': nb.get('NotebookInstanceStatus', ''),
                'subtype': 'NotebookInstance', 'region': region,
            })
    except ClientError:
        pass
    try:
        for ep in sm.list_endpoints().get('Endpoints', []):
            resources.append({
                'type': 'SageMaker', 'id': ep.get('EndpointArn', ep['EndpointName']),
                'name': ep['EndpointName'], 'status': ep.get('EndpointStatus', ''),
                'subtype': 'Endpoint', 'region': region,
            })
    except ClientError:
        pass
    return resources


def discover_glue(credentials, region):
    """Discover Glue jobs."""
    glue = get_client('glue', credentials, region)
    resources = []
    try:
        paginator = glue.get_paginator('get_jobs')
        for page in paginator.paginate():
            for job in page.get('Jobs', []):
                resources.append({
                    'type': 'Glue', 'id': job.get('Name', ''), 'name': job.get('Name', ''),
                    'region': region,
                })
    except ClientError:
        pass
    return resources


def discover_athena(credentials, region):
    """Discover Athena workgroups."""
    athena = get_client('athena', credentials, region)
    resources = []
    try:
        for wg in athena.list_work_groups().get('WorkGroups', []):
            resources.append({
                'type': 'Athena', 'id': wg.get('Name', ''), 'name': wg.get('Name', ''),
                'state': wg.get('State', ''), 'region': region,
            })
    except ClientError:
        pass
    return resources


def discover_cloudtrail(credentials, region):
    """Discover CloudTrail trails."""
    ct = get_client('cloudtrail', credentials, region)
    resources = []
    try:
        for trail in ct.describe_trails().get('trailList', []):
            resources.append({
                'type': 'CloudTrail', 'id': trail.get('TrailARN', trail.get('Name', '')),
                'name': trail.get('Name', ''),
                'multi_region': trail.get('IsMultiRegionTrail', False), 'region': region,
            })
    except ClientError:
        pass
    return resources


def discover_elasticbeanstalk(credentials, region):
    """Discover Elastic Beanstalk environments."""
    eb = get_client('elasticbeanstalk', credentials, region)
    resources = []
    try:
        for env in eb.describe_environments().get('Environments', []):
            resources.append({
                'type': 'ElasticBeanstalk', 'id': env.get('EnvironmentArn', env.get('EnvironmentId', '')),
                'name': env.get('EnvironmentName', ''), 'status': env.get('Status', ''),
                'region': region,
            })
    except ClientError:
        pass
    return resources


def discover_apigatewayv2(credentials, region):
    """Discover API Gateway v2 (HTTP/WebSocket) APIs."""
    resources = []
    try:
        apigw = get_client('apigatewayv2', credentials, region)
        for api in apigw.get_apis().get('Items', []):
            resources.append({
                'type': 'APIGateway', 'id': api.get('ApiId', ''), 'name': api.get('Name', ''),
                'protocol': api.get('ProtocolType', ''), 'region': region,
            })
    except ClientError:
        pass
    return resources


def discover_all_resources_via_config(credentials, region, already_found_ids):
    """
    Catch-all discovery using AWS Config's list_discovered_resources.
    Unlike the Tagging API, AWS Config finds resources whether or not they are
    TAGGED — so this guarantees untagged resources of any recorded service
    still appear on the diagram. Degrades gracefully if Config isn't enabled.
    """
    resources = []
    try:
        config = get_client('config', credentials, region)
        for res_type in _config_resource_types():
            try:
                paginator = config.get_paginator('list_discovered_resources')
                for page in paginator.paginate(resourceType=res_type):
                    for item in page.get('resourceIdentifiers', []):
                        rid = item.get('resourceId', '')
                        rname = item.get('resourceName', '') or rid
                        if not rid or rid in already_found_ids:
                            continue

                        parts = res_type.split('::')  # AWS::EC2::Instance
                        service = parts[1].lower() if len(parts) > 1 else 'unknown'
                        raw_type = parts[2] if len(parts) > 2 else res_type
                        display_type = _friendly_service_type(service, raw_type)

                        resources.append({
                            'type': display_type,
                            'id': rid,
                            'name': rname,
                            'aws_service': service,
                            'raw_resource_type': raw_type,
                            'config_resource_type': res_type,
                            'region': region,
                            'discovered_via': 'aws_config',
                        })
                        already_found_ids.add(rid)
            except ClientError:
                continue  # this resource type not recorded — skip quietly
    except ClientError as e:
        logger.info(f"AWS Config not accessible in {region}: {e.response['Error']['Code']}")
    except Exception as e:
        logger.info(f"AWS Config discovery skipped in {region}: {str(e)}")

    return resources


def _config_resource_types():
    """Widely-used AWS Config resource types to enumerate for untagged coverage."""
    return [
        'AWS::EC2::Instance', 'AWS::EC2::Volume', 'AWS::EC2::SecurityGroup',
        'AWS::EC2::VPC', 'AWS::EC2::Subnet', 'AWS::EC2::NatGateway',
        'AWS::EC2::InternetGateway', 'AWS::EC2::RouteTable', 'AWS::EC2::NetworkInterface',
        'AWS::EC2::EIP', 'AWS::S3::Bucket', 'AWS::RDS::DBInstance', 'AWS::RDS::DBCluster',
        'AWS::Lambda::Function', 'AWS::DynamoDB::Table',
        'AWS::ElasticLoadBalancingV2::LoadBalancer', 'AWS::ElasticLoadBalancing::LoadBalancer',
        'AWS::CloudFront::Distribution', 'AWS::ApiGateway::RestApi', 'AWS::ApiGatewayV2::Api',
        'AWS::ECS::Cluster', 'AWS::ECS::Service', 'AWS::EKS::Cluster',
        'AWS::SNS::Topic', 'AWS::SQS::Queue', 'AWS::KMS::Key',
        'AWS::ElastiCache::CacheCluster', 'AWS::EFS::FileSystem',
        'AWS::Redshift::Cluster', 'AWS::Kinesis::Stream', 'AWS::SageMaker::NotebookInstance',
        'AWS::CloudWatch::Alarm', 'AWS::StepFunctions::StateMachine',
        'AWS::Route53::HostedZone', 'AWS::AutoScaling::AutoScalingGroup',
        'AWS::SecretsManager::Secret', 'AWS::CloudTrail::Trail',
        'AWS::ElasticBeanstalk::Environment', 'AWS::Glue::Job',
        'AWS::WAFv2::WebACL', 'AWS::GuardDuty::Detector', 'AWS::Redshift::ClusterSnapshot',
    ]


def discover_all_resources_via_tagging(credentials, region, already_found_arns):
    """
    Catch-all discovery using the Resource Groups Tagging API.
    Returns EVERY resource in the region across ALL services (that supports
    the tagging API), so we don't miss service types we don't have a
    dedicated scanner for. Resources already found by detailed scanners
    (matched by ARN/id) are skipped to avoid duplicates.

    Any resource type without a dedicated scanner still appears on the diagram
    with a generic icon and its raw AWS service/type label — never dropped.
    """
    resources = []
    try:
        tagging = get_client('resourcegroupstaggingapi', credentials, region)
        paginator = tagging.get_paginator('get_resources')
        for page in paginator.paginate(ResourcesPerPage=100):
            for item in page.get('ResourceTagMappingList', []):
                arn = item.get('ResourceARN', '')
                if not arn or arn in already_found_arns:
                    continue

                # Parse the ARN to derive service + resource type + name.
                # ARN format: arn:aws:<service>:<region>:<account>:<resourcetype>/<id>
                parts = arn.split(':')
                service = parts[2] if len(parts) > 2 else 'unknown'
                resource_part = parts[5] if len(parts) > 5 else arn
                if '/' in resource_part:
                    res_type, res_name = resource_part.split('/', 1)
                else:
                    res_type = resource_part
                    res_name = resource_part

                tags = {t['Key']: t['Value'] for t in item.get('Tags', [])}
                display_type = _friendly_service_type(service, res_type)

                resources.append({
                    'type': display_type,
                    'id': arn,
                    'name': tags.get('Name', res_name),
                    'aws_service': service,
                    'raw_resource_type': res_type,
                    'tags': tags,
                    'region': region,
                    'discovered_via': 'tagging_api',
                })
    except ClientError as e:
        logger.info(f"Tagging API not accessible in {region}: {e.response['Error']['Code']}")
    except Exception as e:
        logger.info(f"Tagging API discovery skipped in {region}: {str(e)}")

    return resources


def _service_code_for_type(diagram_type):
    """Reverse map: diagram type key → AWS service code (best-effort)."""
    reverse = {
        'EC2': 'ec2', 'S3': 's3', 'RDS': 'rds', 'Aurora': 'rds', 'Lambda': 'lambda',
        'DynamoDB': 'dynamodb', 'ELB': 'elasticloadbalancing', 'CloudFront': 'cloudfront',
        'APIGateway': 'apigateway', 'ECS': 'ecs', 'EKS': 'eks', 'Route53': 'route53',
        'SNS': 'sns', 'SQS': 'sqs', 'KMS': 'kms', 'ElastiCache': 'elasticache',
        'EFS': 'elasticfilesystem', 'EBS': 'ec2', 'Redshift': 'redshift',
        'Kinesis': 'kinesis', 'SageMaker': 'sagemaker', 'Glue': 'glue',
        'Athena': 'athena', 'CloudTrail': 'cloudtrail', 'CloudWatch': 'cloudwatch',
        'StepFunctions': 'states', 'EventBridge': 'events', 'AutoScaling': 'autoscaling',
        'SecretsManager': 'secretsmanager', 'ElasticBeanstalk': 'elasticbeanstalk',
        'VPC': 'ec2', 'Subnet': 'ec2', 'SecurityGroup': 'ec2',
        'InternetGateway': 'ec2', 'NATGateway': 'ec2', 'IAM': 'iam', 'Cognito': 'cognito-idp',
        'Bedrock': 'bedrock', 'CodeBuild': 'codebuild',
    }
    return reverse.get(diagram_type, diagram_type.lower())


def _cost_explorer_name_to_code(ce_name):
    """
    Map a Cost Explorer service display name to an AWS service code.
    Cost Explorer names look like 'Amazon Elastic Compute Cloud - Compute',
    'Amazon Simple Storage Service', 'AWS Lambda', etc.
    """
    if not ce_name:
        return ''
    name = ce_name.lower()
    mapping = [
        ('elastic compute cloud', 'ec2'),
        ('simple storage service', 's3'),
        ('relational database', 'rds'),
        ('aurora', 'rds'),
        ('lambda', 'lambda'),
        ('dynamodb', 'dynamodb'),
        ('elastic load balancing', 'elasticloadbalancing'),
        ('cloudfront', 'cloudfront'),
        ('api gateway', 'apigateway'),
        ('elastic container service', 'ecs'),
        ('elastic kubernetes', 'eks'),
        ('route 53', 'route53'),
        ('simple notification', 'sns'),
        ('simple queue', 'sqs'),
        ('key management', 'kms'),
        ('elasticache', 'elasticache'),
        ('elastic file system', 'elasticfilesystem'),
        ('redshift', 'redshift'),
        ('kinesis', 'kinesis'),
        ('sagemaker', 'sagemaker'),
        ('glue', 'glue'),
        ('athena', 'athena'),
        ('cloudtrail', 'cloudtrail'),
        ('cloudwatch', 'cloudwatch'),
        ('step functions', 'states'),
        ('eventbridge', 'events'),
        ('secrets manager', 'secretsmanager'),
        ('elastic beanstalk', 'elasticbeanstalk'),
        ('bedrock', 'bedrock'),
        ('cognito', 'cognito-idp'),
        ('waf', 'waf'),
        ('shield', 'shield'),
        ('guardduty', 'guardduty'),
        ('sagemaker', 'sagemaker'),
        ('virtual private cloud', 'ec2'),
        ('vpc', 'ec2'),
    ]
    for keyword, code in mapping:
        if keyword in name:
            return code
    # Fallback: strip 'amazon '/'aws ' and collapse to a code-ish token.
    cleaned = name.replace('amazon ', '').replace('aws ', '').strip()
    return cleaned.split(' ')[0] if cleaned else ''


def _friendly_service_type(service, res_type):
    """
    Map an AWS service code (from an ARN) to the type label used by the
    diagram's icon map. Falls back to a Title-cased service name so unknown
    services still render with a readable label + generic icon.
    """
    # Map common ARN service codes to our diagram type keys (which have icons).
    service_map = {
        'ec2': 'EC2',
        's3': 'S3',
        'rds': 'RDS',
        'lambda': 'Lambda',
        'dynamodb': 'DynamoDB',
        'elasticloadbalancing': 'ELB',
        'cloudfront': 'CloudFront',
        'apigateway': 'APIGateway',
        'ecs': 'ECS',
        'eks': 'EKS',
        'route53': 'Route53',
        'sns': 'SNS',
        'sqs': 'SQS',
        'kms': 'KMS',
        'elasticache': 'ElastiCache',
        'elasticfilesystem': 'EFS',
        'cloudwatch': 'CloudWatch',
        'states': 'StepFunctions',
        'events': 'EventBridge',
        'bedrock': 'Bedrock',
        'codebuild': 'CodeBuild',
        'cognito-idp': 'Cognito',
        'iam': 'IAM',
    }
    if service in service_map:
        return service_map[service]
    # Unknown service → readable label (e.g. 'redshift' -> 'Redshift')
    return service.replace('-', ' ').title().replace(' ', '')


def discover_services_from_cost_explorer(credentials):
    """
    Query Cost Explorer to find WHICH services the client actually uses
    (matches their billing exactly — catches services even if untagged).
    Cost Explorer is global; returns a set of AWS service names with cost.
    Used only to report the full service footprint — detailed/tagging scans
    still fetch the actual resources.
    """
    services = []
    try:
        from datetime import timedelta
        ce = get_client('ce', credentials, 'us-east-1')
        end = datetime.utcnow().date()
        start = end - timedelta(days=30)
        response = ce.get_cost_and_usage(
            TimePeriod={'Start': start.isoformat(), 'End': end.isoformat()},
            Granularity='MONTHLY',
            Metrics=['UnblendedCost'],
            GroupBy=[{'Type': 'DIMENSION', 'Key': 'SERVICE'}],
        )
        for result in response.get('ResultsByTime', []):
            for group in result.get('Groups', []):
                svc_name = group.get('Keys', ['Unknown'])[0]
                amount = float(group.get('Metrics', {}).get('UnblendedCost', {}).get('Amount', 0))
                if amount > 0:
                    services.append({'service': svc_name, 'monthly_cost_usd': round(amount, 2)})
    except ClientError as e:
        logger.info(f"Cost Explorer not accessible: {e.response['Error']['Code']}")
    except Exception as e:
        logger.info(f"Cost Explorer query skipped: {str(e)}")

    return services


def build_relationships(resources):
    """Build relationships between discovered resources based on actual configurations."""
    relationships = []
    resource_map = {}

    # Index resources by type and ID
    for r in resources:
        resource_map.setdefault(r['type'], {})[r['id']] = r

    # EC2/ECS/EKS/ELB/RDS → VPC relationships
    for resource in resources:
        vpc_id = resource.get('vpc_id')
        if vpc_id and resource['type'] != 'VPC':
            relationships.append({
                'source': resource['id'],
                'source_type': resource['type'],
                'target': vpc_id,
                'target_type': 'VPC',
                'relationship': 'deployed_in'
            })

        # Subnet relationships
        subnet_id = resource.get('subnet_id')
        if subnet_id:
            relationships.append({
                'source': resource['id'],
                'source_type': resource['type'],
                'target': subnet_id,
                'target_type': 'Subnet',
                'relationship': 'placed_in'
            })

        # Security group relationships
        for sg_id in resource.get('security_groups', []):
            relationships.append({
                'source': resource['id'],
                'source_type': resource['type'],
                'target': sg_id,
                'target_type': 'SecurityGroup',
                'relationship': 'protected_by'
            })

    # Subnet → VPC relationships
    for subnet in resources:
        if subnet['type'] == 'Subnet' and subnet.get('vpc_id'):
            relationships.append({
                'source': subnet['id'],
                'source_type': 'Subnet',
                'target': subnet['vpc_id'],
                'target_type': 'VPC',
                'relationship': 'part_of'
            })

    # NAT/IGW → VPC relationships
    for resource in resources:
        if resource['type'] in ('NATGateway', 'InternetGateway') and resource.get('vpc_id'):
            relationships.append({
                'source': resource['id'],
                'source_type': resource['type'],
                'target': resource['vpc_id'],
                'target_type': 'VPC',
                'relationship': 'attached_to'
            })

    return relationships


def lambda_handler(event, context):
    """
    Main handler for resource discovery.
    Input: { roleArn, region, accountId, externalId (optional), regions (optional list) }
    Output: Complete resource inventory with relationships.
    """
    try:
        # Parse input - handle both API Gateway and Step Functions invocations
        if isinstance(event.get('body'), str):
            body = json.loads(event['body'])
        elif 'body' in event:
            body = event['body'] if isinstance(event['body'], dict) else {}
        else:
            body = event

        role_arn = body.get('roleArn')
        # Region MUST come from the client's selection — no hardcoded test-region fallback.
        primary_region = body.get('region')
        account_id = body.get('accountId', '')
        external_id = body.get('externalId')
        # scan_regions: use explicit list if provided, else the single selected region.
        scan_regions = body.get('regions') or ([primary_region] if primary_region else [])

        # Validation
        if not role_arn:
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({'error': 'roleArn is required'})
            }

        if not scan_regions:
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({'error': 'region is required — please select a region when connecting the account'})
            }

        # Extract account ID from role ARN if not provided
        if not account_id:
            try:
                account_id = role_arn.split(':')[4]
            except IndexError:
                account_id = 'unknown'

        # Assume client role
        credentials = assume_client_role(role_arn, external_id)

        # Discover resources across all specified regions
        all_resources = []
        discovery_errors = []

        for region in scan_regions:
            logger.info(f"Scanning region: {region}")

            all_resources.extend(safe_discover(discover_ec2, 'EC2', credentials, region))
            all_resources.extend(safe_discover(discover_security_groups, 'SecurityGroups', credentials, region))
            all_resources.extend(safe_discover(discover_s3, 'S3', credentials, region))
            all_resources.extend(safe_discover(discover_rds, 'RDS', credentials, region))
            all_resources.extend(safe_discover(discover_lambda_functions, 'Lambda', credentials, region))
            all_resources.extend(safe_discover(discover_vpcs, 'VPC', credentials, region))
            all_resources.extend(safe_discover(discover_load_balancers, 'ELB', credentials, region))
            all_resources.extend(safe_discover(discover_dynamodb_tables, 'DynamoDB', credentials, region))
            all_resources.extend(safe_discover(discover_api_gateways, 'APIGateway', credentials, region))
            all_resources.extend(safe_discover(discover_ecs, 'ECS', credentials, region))
            all_resources.extend(safe_discover(discover_eks, 'EKS', credentials, region))
            all_resources.extend(safe_discover(discover_sns_topics, 'SNS', credentials, region))
            all_resources.extend(safe_discover(discover_sqs_queues, 'SQS', credentials, region))
            all_resources.extend(safe_discover(discover_kms_keys, 'KMS', credentials, region))

        # Global services - only scan once
        all_resources.extend(safe_discover(discover_cloudfront, 'CloudFront', credentials, 'us-east-1'))
        all_resources.extend(safe_discover(discover_route53, 'Route53', credentials, 'us-east-1'))

        # ── Extended describe/list scanners (SOW: 50+ services) ──────────────
        # These use describe/list APIs (catch tagged AND untagged resources).
        for region in scan_regions:
            all_resources.extend(safe_discover(discover_ebs_volumes, 'EBS', credentials, region))
            all_resources.extend(safe_discover(discover_elasticache, 'ElastiCache', credentials, region))
            all_resources.extend(safe_discover(discover_efs, 'EFS', credentials, region))
            all_resources.extend(safe_discover(discover_redshift, 'Redshift', credentials, region))
            all_resources.extend(safe_discover(discover_kinesis, 'Kinesis', credentials, region))
            all_resources.extend(safe_discover(discover_stepfunctions, 'StepFunctions', credentials, region))
            all_resources.extend(safe_discover(discover_eventbridge, 'EventBridge', credentials, region))
            all_resources.extend(safe_discover(discover_cloudwatch_alarms, 'CloudWatch', credentials, region))
            all_resources.extend(safe_discover(discover_autoscaling, 'AutoScaling', credentials, region))
            all_resources.extend(safe_discover(discover_secretsmanager, 'SecretsManager', credentials, region))
            all_resources.extend(safe_discover(discover_sagemaker, 'SageMaker', credentials, region))
            all_resources.extend(safe_discover(discover_glue, 'Glue', credentials, region))
            all_resources.extend(safe_discover(discover_athena, 'Athena', credentials, region))
            all_resources.extend(safe_discover(discover_cloudtrail, 'CloudTrail', credentials, region))
            all_resources.extend(safe_discover(discover_elasticbeanstalk, 'ElasticBeanstalk', credentials, region))
            all_resources.extend(safe_discover(discover_apigatewayv2, 'APIGatewayV2', credentials, region))

        # ── Safety-net catch-alls so NOTHING is missed (tagged or untagged) ──
        already_found_arns = {r.get('id', '') for r in all_resources}
        for region in scan_regions:
            # 1. Tagging API → any TAGGED resource of a service without a scanner.
            tagged = safe_discover(
                lambda creds, reg: discover_all_resources_via_tagging(creds, reg, already_found_arns),
                'TaggingAPI', credentials, region
            )
            for r in tagged:
                if r.get('id') not in already_found_arns:
                    all_resources.append(r)
                    already_found_arns.add(r.get('id'))

            # 2. AWS Config → UNTAGGED resources too (any recorded service),
            #    when the client has Config enabled. Guarantees full coverage.
            config_found = safe_discover(
                lambda creds, reg: discover_all_resources_via_config(creds, reg, already_found_arns),
                'AWSConfig', credentials, region
            )
            for r in config_found:
                if r.get('id') not in already_found_arns:
                    all_resources.append(r)
                    already_found_arns.add(r.get('id'))

        # ── Cost Explorer: full service footprint (matches billing) ──────────
        services_footprint = discover_services_from_cost_explorer(credentials)

        # ── Add billed-but-not-discovered services as diagram nodes ──────────
        # Any service the client is billed for (Cost Explorer) that we did NOT
        # find via detailed/tagging scanners is added as a node so NOTHING the
        # client uses is missing from the diagram. Shown with a generic icon
        # and the service name (no individual resource detail available).
        discovered_services = {
            (r.get('aws_service') or _service_code_for_type(r.get('type', ''))).lower()
            for r in all_resources
        }
        # Billing line items that are NOT actual services — never show as nodes.
        NON_SERVICE_BILLING = {'tax', 'refund', 'credit', 'support', 'savings plans',
                               'aws support', 'aws premium support'}
        for svc in services_footprint:
            svc_name = svc.get('service', '')
            if svc_name.strip().lower() in NON_SERVICE_BILLING:
                continue  # skip Tax/Refund/Credit/Support billing entries
            svc_code = _cost_explorer_name_to_code(svc_name)
            if not svc_code or svc_code.lower() in discovered_services:
                continue  # already visualized via a real resource
            display_type = _friendly_service_type(svc_code, svc_code)
            all_resources.append({
                'type': display_type,
                'id': f"billing::{svc_code}",
                'name': svc_name,
                'aws_service': svc_code,
                'discovered_via': 'cost_explorer',
                'monthly_cost_usd': svc.get('monthly_cost_usd', 0),
                'note': 'Detected in billing — no individual resource details available',
                'region': primary_region or (scan_regions[0] if scan_regions else 'global'),
            })
            discovered_services.add(svc_code.lower())

        # Build relationships
        relationships = build_relationships(all_resources)

        # Generate scan ID
        scan_id = f"scan-{account_id}-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"

        # Build summary
        summary_by_type = {}
        for resource in all_resources:
            rtype = resource['type']
            summary_by_type[rtype] = summary_by_type.get(rtype, 0) + 1

        # Prepare result
        # NOTE: Cost estimation during discovery has been removed.
        # Cost analysis is provided later by Bedrock during WAF analysis.
        discovery_result = {
            'scanId': scan_id,
            'accountId': account_id,
            'regions': scan_regions,
            'timestamp': datetime.utcnow().isoformat(),
            'resources': all_resources,
            'relationships': relationships,
            'servicesFootprint': services_footprint,
            'summary': {
                'total_resources': len(all_resources),
                'total_relationships': len(relationships),
                'by_type': summary_by_type,
                'regions_scanned': scan_regions,
                'services_in_billing': len(services_footprint),
            }
        }

        # Save to S3
        s3_client.put_object(
            Bucket=DATA_BUCKET,
            Key=f"scan-results/{scan_id}.json",
            Body=json.dumps(discovery_result, default=str),
            ContentType='application/json'
        )

        # Save metadata to DynamoDB
        table = dynamodb.Table(SCANS_TABLE)
        table.put_item(Item={
            'scanId': scan_id,
            'accountId': account_id,
            'regions': scan_regions,
            'timestamp': datetime.utcnow().isoformat(),
            'resourceCount': len(all_resources),
            'relationshipCount': len(relationships),
            'status': 'completed',
            's3Key': f"scan-results/{scan_id}.json",
            'summary': json.dumps(summary_by_type)
        })

        logger.info(f"Discovery complete: {len(all_resources)} resources, {len(relationships)} relationships")

        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST,OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type,Authorization'
            },
            'body': json.dumps(discovery_result, default=str)
        }

    except ClientError as e:
        logger.error(f"AWS Error in resource discovery: {e.response['Error']['Message']}")
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'error': f"AWS Error: {e.response['Error']['Message']}"})
        }
    except Exception as e:
        logger.error(f"Unexpected error in resource discovery: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'error': f"Internal error: {str(e)}"})
        }

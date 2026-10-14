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
from concurrent.futures import ThreadPoolExecutor, as_completed
from botocore.exceptions import ClientError, BotoCoreError

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize clients
sts_client = boto3.client('sts')
s3_client = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')

# Configuration from environment variables
DATA_BUCKET = os.environ.get('DATA_BUCKET', 'archlens-data')
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
    }
    if external_id:
        assume_params['ExternalId'] = external_id
    if SCAN_TIMEOUT_SECONDS and SCAN_TIMEOUT_SECONDS <= 3600:
        assume_params['DurationSeconds'] = SCAN_TIMEOUT_SECONDS

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
        err_msg = e.response.get('Error', {}).get('Message', '')
        if 'DurationSeconds' in err_msg and 'DurationSeconds' in assume_params:
            logger.warning(f"Retrying assume_role without explicit DurationSeconds: {err_msg}")
            del assume_params['DurationSeconds']
            try:
                response = sts_client.assume_role(**assume_params)
                credentials = response['Credentials']
                logger.info(f"Successfully assumed role: {role_arn}")
                return {
                    'aws_access_key_id': credentials['AccessKeyId'],
                    'aws_secret_access_key': credentials['SecretAccessKey'],
                    'aws_session_token': credentials['SessionToken']
                }
            except ClientError as e2:
                logger.error(f"Failed to assume role {role_arn}: {e2.response['Error']['Message']}")
                raise
        logger.error(f"Failed to assume role {role_arn}: {err_msg}")
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
        
        # Get bucket details and true geographic location constraint safely
        bucket_region = 'us-east-1'
        try:
            location = s3.get_bucket_location(Bucket=bucket_name)
            loc = location.get('LocationConstraint')
            if not loc:
                bucket_region = 'us-east-1'
            elif loc == 'EU':
                bucket_region = 'eu-west-1'
            else:
                bucket_region = str(loc)
        except ClientError:
            bucket_region = 'unknown'

        bucket_info = {
            'type': 'S3',
            'id': bucket_name,
            'name': bucket_name,
            'creation_date': bucket['CreationDate'],
            'bucket_region': bucket_region,
            'region': bucket_region
        }

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
            db_subnets = [s.get('SubnetIdentifier') for s in db.get('DBSubnetGroup', {}).get('Subnets', []) if s.get('SubnetIdentifier')]
            db_az = db.get('AvailabilityZone', '')
            primary_subnet = db_subnets[0] if db_subnets else ''
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
                'subnet_id': primary_subnet,
                'availability_zone': db_az,
                'subnets': db_subnets,
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
                lb_subnets = [az.get('SubnetId') for az in lb.get('AvailabilityZones', []) if az.get('SubnetId')]
                primary_subnet = lb_subnets[0] if lb_subnets else ''
                resources.append({
                    'type': 'ELB',
                    'id': lb['LoadBalancerArn'],
                    'name': lb['LoadBalancerName'],
                    'lb_type': lb.get('Type', ''),
                    'scheme': lb.get('Scheme', ''),
                    'state': lb.get('State', {}).get('Code', ''),
                    'vpc_id': lb.get('VpcId', ''),
                    'subnet_id': primary_subnet,
                    'subnets': lb_subnets,
                    'dns_name': lb.get('DNSName', ''),
                    'availability_zones': [az.get('ZoneName') for az in lb.get('AvailabilityZones', []) if az.get('ZoneName')],
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


def discover_iam(credentials, region):
    """
    Discover IAM users and roles (global service — scanned once).
    These appear in the INVENTORY list (with real counts that match the AWS
    console) but are intentionally kept OUT of the architecture flow diagram.
    Customer-managed roles only for roles (AWS service-linked roles under
    /aws-service-role/ are excluded so the count reflects real, user-created
    identities like the console's "Roles" view minus service-linked ones).
    """
    iam = get_client('iam', credentials, 'us-east-1')
    resources = []
    try:
        paginator = iam.get_paginator('list_users')
        for page in paginator.paginate():
            for u in page.get('Users', []):
                resources.append({
                    'type': 'IAMUser',
                    'id': u.get('Arn', u.get('UserName')),
                    'name': u.get('UserName', ''),
                    'created': u.get('CreateDate', ''),
                    'region': 'global',
                    'discovered_via': 'iam',
                })
    except ClientError:
        pass
    try:
        paginator = iam.get_paginator('list_roles')
        for page in paginator.paginate():
            for r in page.get('Roles', []):
                resources.append({
                    'type': 'IAMRole',
                    'id': r.get('Arn', r.get('RoleName')),
                    'name': r.get('RoleName', ''),
                    'created': r.get('CreateDate', ''),
                    'region': 'global',
                    'discovered_via': 'iam',
                })
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


# ─── Additional SOW Appendix A service scanners ──────────────────────────────

def discover_neptune(credentials, region):
    """Discover Amazon Neptune graph database clusters."""
    resources = []
    try:
        nep = get_client('neptune', credentials, region)
        paginator = nep.get_paginator('describe_db_clusters')
        for page in paginator.paginate():
            for c in page.get('DBClusters', []):
                # Neptune shares the RDS API; filter to neptune engine only
                if 'neptune' in (c.get('Engine', '') or '').lower():
                    resources.append({
                        'type': 'Neptune', 'id': c.get('DBClusterArn', c['DBClusterIdentifier']),
                        'name': c['DBClusterIdentifier'], 'engine': c.get('Engine', ''),
                        'status': c.get('Status', ''), 'encrypted': c.get('StorageEncrypted', False),
                        'region': region,
                    })
    except ClientError:
        pass
    return resources


def discover_documentdb(credentials, region):
    """Discover Amazon DocumentDB clusters."""
    resources = []
    try:
        doc = get_client('docdb', credentials, region)
        paginator = doc.get_paginator('describe_db_clusters')
        for page in paginator.paginate():
            for c in page.get('DBClusters', []):
                if 'docdb' in (c.get('Engine', '') or '').lower():
                    resources.append({
                        'type': 'DocumentDB', 'id': c.get('DBClusterArn', c['DBClusterIdentifier']),
                        'name': c['DBClusterIdentifier'], 'engine': c.get('Engine', ''),
                        'status': c.get('Status', ''), 'encrypted': c.get('StorageEncrypted', False),
                        'region': region,
                    })
    except ClientError:
        pass
    return resources


def discover_opensearch(credentials, region):
    """Discover Amazon OpenSearch domains."""
    resources = []
    try:
        os_client = get_client('opensearch', credentials, region)
        for d in os_client.list_domain_names().get('DomainNames', []):
            name = d.get('DomainName', '')
            resources.append({
                'type': 'OpenSearch', 'id': name, 'name': name,
                'engine_type': d.get('EngineType', ''), 'region': region,
            })
    except ClientError:
        pass
    return resources


def discover_guardduty(credentials, region):
    """Discover GuardDuty detectors."""
    resources = []
    try:
        gd = get_client('guardduty', credentials, region)
        for det_id in gd.list_detectors().get('DetectorIds', []):
            resources.append({
                'type': 'GuardDuty', 'id': det_id, 'name': f'detector-{det_id[:8]}',
                'region': region,
            })
    except ClientError:
        pass
    return resources


def discover_wafv2(credentials, region):
    """Discover WAFv2 Web ACLs (regional scope)."""
    resources = []
    try:
        waf = get_client('wafv2', credentials, region)
        resp = waf.list_web_acls(Scope='REGIONAL', Limit=100)
        for acl in resp.get('WebACLs', []):
            resources.append({
                'type': 'WAF', 'id': acl.get('ARN', acl.get('Id', '')),
                'name': acl.get('Name', ''), 'region': region,
            })
    except ClientError:
        pass
    return resources


def discover_transit_gateway(credentials, region):
    """Discover Transit Gateways."""
    resources = []
    try:
        ec2 = get_client('ec2', credentials, region)
        for tgw in ec2.describe_transit_gateways().get('TransitGateways', []):
            resources.append({
                'type': 'TransitGateway', 'id': tgw.get('TransitGatewayId', ''),
                'name': tgw.get('TransitGatewayId', ''), 'state': tgw.get('State', ''),
                'region': region,
            })
    except ClientError:
        pass
    return resources


def discover_security_hub(credentials, region):
    """Discover Security Hub (enabled state as a resource node)."""
    resources = []
    try:
        sh = get_client('securityhub', credentials, region)
        hub = sh.describe_hub()
        resources.append({
            'type': 'SecurityHub', 'id': hub.get('HubArn', 'security-hub'),
            'name': 'Security Hub', 'region': region,
        })
    except ClientError:
        pass
    return resources


def discover_config(credentials, region):
    """Discover AWS Config recorders (as a resource node)."""
    resources = []
    try:
        cfg = get_client('config', credentials, region)
        for rec in cfg.describe_configuration_recorders().get('ConfigurationRecorders', []):
            resources.append({
                'type': 'Config', 'id': rec.get('name', 'config-recorder'),
                'name': rec.get('name', 'Config Recorder'), 'region': region,
            })
    except ClientError:
        pass
    return resources


def discover_fsx(credentials, region):
    """Discover FSx file systems."""
    resources = []
    try:
        fsx = get_client('fsx', credentials, region)
        paginator = fsx.get_paginator('describe_file_systems')
        for page in paginator.paginate():
            for fs in page.get('FileSystems', []):
                resources.append({
                    'type': 'FSx', 'id': fs.get('ResourceARN', fs.get('FileSystemId', '')),
                    'name': fs.get('FileSystemId', ''), 'fs_type': fs.get('FileSystemType', ''),
                    'region': region,
                })
    except ClientError:
        pass
    return resources


def discover_batch(credentials, region):
    """Discover AWS Batch compute environments."""
    resources = []
    try:
        batch = get_client('batch', credentials, region)
        for ce in batch.describe_compute_environments().get('computeEnvironments', []):
            resources.append({
                'type': 'Batch', 'id': ce.get('computeEnvironmentArn', ''),
                'name': ce.get('computeEnvironmentName', ''), 'state': ce.get('state', ''),
                'region': region,
            })
    except ClientError:
        pass
    return resources


def discover_apprunner(credentials, region):
    """Discover App Runner services."""
    resources = []
    try:
        ar = get_client('apprunner', credentials, region)
        for svc in ar.list_services().get('ServiceSummaryList', []):
            resources.append({
                'type': 'AppRunner', 'id': svc.get('ServiceArn', ''),
                'name': svc.get('ServiceName', ''), 'status': svc.get('Status', ''),
                'region': region,
            })
    except ClientError:
        pass
    return resources


def discover_emr(credentials, region):
    """Discover EMR clusters."""
    resources = []
    try:
        emr = get_client('emr', credentials, region)
        for c in emr.list_clusters(ClusterStates=['STARTING', 'BOOTSTRAPPING', 'RUNNING', 'WAITING']).get('Clusters', []):
            resources.append({
                'type': 'EMR', 'id': c.get('ClusterArn', c.get('Id', '')),
                'name': c.get('Name', ''), 'region': region,
            })
    except ClientError:
        pass
    return resources


def discover_appsync(credentials, region):
    """Discover AppSync GraphQL APIs."""
    resources = []
    try:
        ap = get_client('appsync', credentials, region)
        for api in ap.list_graphql_apis().get('graphqlApis', []):
            resources.append({
                'type': 'AppSync', 'id': api.get('apiId', ''), 'name': api.get('name', ''),
                'region': region,
            })
    except ClientError:
        pass
    return resources


def discover_ssm(credentials, region):
    """Discover Systems Manager managed instances (count as one node group)."""
    resources = []
    try:
        ssm = get_client('ssm', credentials, region)
        info = ssm.describe_instance_information(MaxResults=50).get('InstanceInformationList', [])
        for inst in info:
            resources.append({
                'type': 'SystemsManager', 'id': inst.get('InstanceId', ''),
                'name': inst.get('Name', inst.get('InstanceId', '')),
                'platform': inst.get('PlatformName', ''), 'region': region,
            })
    except ClientError:
        pass
    return resources


def discover_codedeploy(credentials, region):
    """Discover CodeDeploy applications."""
    resources = []
    try:
        deploy = get_client('codedeploy', credentials, region)
        paginator = deploy.get_paginator('list_applications')
        for page in paginator.paginate():
            for app_name in page.get('applications', []):
                resources.append({
                    'type': 'CodeDeploy',
                    'id': f"arn:aws:codedeploy:{region}:{credentials.get('account_id', '')}:application:{app_name}",
                    'name': app_name,
                    'region': region
                })
    except Exception:
        pass
    return resources


def discover_cognito(credentials, region):
    """Discover Cognito user pools."""
    resources = []
    try:
        cognito = get_client('cognito-idp', credentials, region)
        paginator = cognito.get_paginator('list_user_pools')
        for page in paginator.paginate(MaxResults=60):
            for pool in page.get('UserPools', []):
                resources.append({
                    'type': 'Cognito',
                    'id': pool['Id'],
                    'name': pool.get('Name', ''),
                    'region': region
                })
    except Exception:
        pass
    return resources


def discover_backup_plans(credentials, region):
    """Discover AWS Backup plans."""
    resources = []
    try:
        backup = get_client('backup', credentials, region)
        paginator = backup.get_paginator('list_backup_plans')
        for page in paginator.paginate():
            for plan in page.get('BackupPlansList', []):
                resources.append({
                    'type': 'BackupPlan',
                    'id': plan.get('BackupPlanArn', plan.get('BackupPlanId')),
                    'name': plan.get('BackupPlanName', ''),
                    'region': region
                })
    except Exception:
        pass
    return resources


def discover_backup_vaults(credentials, region):
    """Discover AWS Backup vaults."""
    resources = []
    try:
        backup = get_client('backup', credentials, region)
        paginator = backup.get_paginator('list_backup_vaults')
        for page in paginator.paginate():
            for vault in page.get('BackupVaultList', []):
                resources.append({
                    'type': 'BackupVault',
                    'id': vault.get('BackupVaultArn', vault.get('BackupVaultName')),
                    'name': vault.get('BackupVaultName', ''),
                    'region': region
                })
    except Exception:
        pass
    return resources


def discover_all_resources_via_config(credentials, region, already_found_ids):
    """
    Catch-all discovery using AWS Config's advanced query + list APIs.
    Unlike the Tagging API, AWS Config finds resources whether or not they are
    TAGGED — so this guarantees untagged resources of ANY recorded service
    still appear on the diagram. It ALSO returns AWS's native relationship
    graph (what each resource connects to), giving real connections.

    Returns (resources, relationships). Degrades gracefully if Config
    isn't enabled in the client account.
    """
    resources = []
    relationships = []

    def _norm_id(rid):
        """Normalize an id to match the caller's dedup keys (bare, lowercased)."""
        if not rid:
            return ''
        s = str(rid)
        if s.startswith('arn:'):
            tail = s.split(':')[-1]
            s = tail.split('/')[-1] if '/' in tail else tail
        elif '/' in s:
            s = s.split('/')[-1]
        return s.lower()

    try:
        config = get_client('config', credentials, region)

        # ── Strategy 1: SelectResourceConfig — a SQL-like query that returns
        #    EVERY resource Config records, across ALL types, in one query.
        #    This is the true "list everything" call (tagged or untagged).
        try:
            next_token = None
            query = ("SELECT resourceId, resourceName, resourceType, "
                     "availabilityZone, configuration, relationships")
            while True:
                params = {'Expression': query, 'Limit': 100}
                if next_token:
                    params['NextToken'] = next_token
                resp = config.select_resource_config(**params)

                for raw in resp.get('Results', []):
                    try:
                        item = json.loads(raw)
                    except (json.JSONDecodeError, TypeError):
                        continue

                    rid = item.get('resourceId', '')
                    if not rid or _norm_id(rid) in already_found_ids:
                        continue

                    res_type = item.get('resourceType', '')  # AWS::EC2::Instance
                    parts = res_type.split('::')
                    service = parts[1].lower() if len(parts) > 1 else 'unknown'
                    raw_type = parts[2] if len(parts) > 2 else res_type
                    display_type = _friendly_service_type(service, raw_type)

                    # Skip services a dedicated scanner already covers, and
                    # drop TIER-1 NOISE. Config counts sub-resources too, so
                    # this prevents inflating parent-service counts.
                    if _already_scanned_service(service, 'config'):
                        continue
                    if _is_noise_resource(service, raw_type, display_type, rid, item.get('resourceName')):
                        continue

                    resources.append({
                        'type': display_type,
                        'id': rid,
                        'name': item.get('resourceName') or rid,
                        'aws_service': service,
                        'raw_resource_type': raw_type,
                        'config_resource_type': res_type,
                        'availability_zone': item.get('availabilityZone', ''),
                        'region': region,
                        'discovered_via': 'aws_config',
                    })
                    already_found_ids.add(_norm_id(rid))

                    # Config's native relationship graph → real connections.
                    for rel in item.get('relationships', []) or []:
                        target_id = rel.get('resourceId', '')
                        rel_name = rel.get('relationshipName', 'related_to')
                        if target_id:
                            relationships.append({
                                'source': rid,
                                'source_type': display_type,
                                'target': target_id,
                                'target_type': _friendly_service_type(
                                    (rel.get('resourceType', '') or '').split('::')[1].lower()
                                    if '::' in (rel.get('resourceType', '') or '') else 'unknown',
                                    rel.get('resourceType', '')
                                ),
                                'relationship': rel_name.replace(' ', '_').lower(),
                                'discovered_via': 'aws_config',
                            })

                next_token = resp.get('NextToken')
                if not next_token:
                    break
            # If the advanced query worked, we have everything — return early.
            if resources:
                return resources, relationships
        except ClientError:
            pass  # advanced query not available — fall back to list per type

        # ── Strategy 2 (fallback): list_discovered_resources per known type ──
        for res_type in _config_resource_types():
            try:
                paginator = config.get_paginator('list_discovered_resources')
                for page in paginator.paginate(resourceType=res_type):
                    for item in page.get('resourceIdentifiers', []):
                        rid = item.get('resourceId', '')
                        rname = item.get('resourceName', '') or rid
                        if not rid or _norm_id(rid) in already_found_ids:
                            continue

                        parts = res_type.split('::')
                        service = parts[1].lower() if len(parts) > 1 else 'unknown'
                        raw_type = parts[2] if len(parts) > 2 else res_type
                        display_type = _friendly_service_type(service, raw_type)

                        # Skip already-scanned services + TIER-1 NOISE.
                        if _already_scanned_service(service, 'config'):
                            continue
                        if _is_noise_resource(service, raw_type, display_type, rid, rname):
                            continue

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
                        already_found_ids.add(_norm_id(rid))
            except ClientError:
                continue
    except ClientError as e:
        logger.info(f"AWS Config not accessible in {region}: {e.response['Error']['Code']}")
    except Exception as e:
        logger.info(f"AWS Config discovery skipped in {region}: {str(e)}")

    return resources, relationships


def _config_resource_types():
    """Widely-used AWS Config resource types to enumerate for untagged coverage."""
    return [
        'AWS::EC2::Instance', 'AWS::EC2::Volume', 'AWS::EC2::SecurityGroup',
        'AWS::EC2::VPC', 'AWS::EC2::Subnet', 'AWS::EC2::NatGateway',
        'AWS::EC2::InternetGateway',
        'AWS::S3::Bucket', 'AWS::RDS::DBInstance', 'AWS::RDS::DBCluster',
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
        'AWS::WAFv2::WebACL', 'AWS::GuardDuty::Detector',
    ]


# ── Two-tier filtering ──────────────────────────────────────────────────────
# TIER 1 — NOISE: auto-generated plumbing / ops artifacts that a client does
# NOT think of as "resources" and that inflate the count so it no longer
# matches the AWS Console. These are dropped from BOTH the inventory list and
# the diagram (e.g. ENIs, AMIs, snapshots, key-pairs, log groups, CFN stacks).
NOISE_ARN_SERVICES = {
    'cloudformation',      # deployment tooling, not a resource
    'logs',                # CloudWatch Logs log groups
    'ssm',                 # parameters / documents / associations
    'access-analyzer',
    'organizations',
    'sts',
    'health',
    'support',
    'resource-groups', 'resource-explorer-2', 'resourceexplorer2', 'tag',
    'servicecatalog',
    'cost-explorer', 'ce', 'billing', 'budgets',
    'servicediscovery',
    'route53resolver',
    'scheduler',
    'appconfig',
}
NOISE_EC2_SUBTYPES = {
    'network-interface', 'elastic-ip', 'eip', 'dhcp-options', 'key-pair',
    'network-acl', 'image', 'snapshot', 'volume-attachment',
    'prefix-list', 'spot-instance-request',
}
NOISE_DIAGRAM_TYPES = {
    'NetworkInterface', 'AMI', 'Snapshot', 'KeyPair', 'ElasticIP',
    'DHCPOptions', 'NetworkACL', 'CloudFormation', 'CloudWatchLogs',
    'LogGroup', 'SSMParameter', 'SSMDocument',
    # Unrecognized EC2-namespace sub-resources (launch templates, capacity
    # reservations, spot/fleet requests, etc.) — not real compute instances,
    # so they must never be counted as EC2 or shown as nodes.
    'EC2Other', 'ResourceExplorer2', 'Route53Resolver', 'Scheduler', 'AppConfig', 'Cassandra',
}

# TIER 2 — INVENTORY-ONLY: real resources the client WANTS counted (so the
# list matches the console) but that do NOT belong in a traffic-flow diagram
# (identity, certificates, config recorders, etc.). Kept in the inventory,
# hidden from the diagram by the frontend's NON_DIAGRAM_TYPES set.
# (No backend action needed here — listed for documentation.)
INVENTORY_ONLY_TYPES = {
    'IAM', 'ACMCertificate', 'Config', 'RouteTable',
}


def _is_noise_resource(service, res_type, display_type, resource_id=None, resource_name=None):
    """
    True only for TIER-1 NOISE that should be dropped from the inventory AND
    the diagram. Filters AWS-managed templates, internal keyspaces, and plumbing.
    """
    svc = (service or '').lower()
    rt = (res_type or '').lower()
    rid = str(resource_id or '').lower()
    rname = str(resource_name or '').lower()

    # Drop AWS default / internal managed artifacts
    if 'codedeploydefault.' in rid or 'codedeploydefault.' in rname:
        return True
    if 'appconfig.' in rid or 'appconfig.' in rname:
        return True
    if svc in ('cassandra', 'keyspaces') and any(rid.startswith(s) for s in ('system', 'system_schema', 'system_schema_mcs', 'system_multiregion_info')):
        return True
    if 'rslvr-autodefined-' in rid or 'rslvr-autodefined-' in rname:
        return True
    if rid in ('fargate', 'fargate_spot') or rname in ('fargate', 'fargate_spot'):
        return True
    if rid.startswith('alias/aws/') or rname.startswith('alias/aws/'):
        return True
    if rid == 'default' and svc in ('scheduler', 'events', 'eventbridge'):
        return True
    if svc == 'athena' and rid == 'primary':
        return True

    if svc in NOISE_ARN_SERVICES:
        return True
    if svc == 'ec2' and rt in NOISE_EC2_SUBTYPES:
        return True
    if display_type in NOISE_DIAGRAM_TYPES:
        return True
    return False


# Services that already have a DEDICATED, accurate scanner above. The catch-all
# (Tagging API + AWS Config) must NOT re-add resources for these — otherwise
# sub-resources (e.g. API Gateway stages/methods/keys, CodeDeploy deployment
# groups, ELB listeners/target-groups) get counted as the parent service and
# massively inflate the numbers (1 API Gateway → 20). The dedicated scanner is
# the single source of truth for these service codes.
SCANNED_ARN_SERVICES = {
    'ec2',                     # EC2 + VPC + Subnet + SG + IGW + NAT (dedicated)
    's3', 'rds', 'lambda', 'dynamodb',
    'elasticloadbalancing', 'elasticloadbalancingv2',
    'cloudfront', 'apigateway', 'apigatewayv2',
    'ecs', 'eks', 'route53', 'sns', 'sqs', 'kms',
    'elasticache', 'elasticfilesystem', 'redshift', 'kinesis',
    'states', 'events', 'cloudwatch', 'autoscaling',
    'secretsmanager', 'sagemaker', 'glue', 'athena', 'cloudtrail',
    'elasticbeanstalk', 'neptune', 'rds-db', 'docdb', 'es', 'opensearch',
    'guardduty', 'wafv2', 'fsx', 'batch', 'apprunner', 'elasticmapreduce',
    'appsync', 'ssm', 'iam',   # iam has its own dedicated users/roles scanner
    'config', 'securityhub',
    'codedeploy', 'cognito', 'cognito-idp', 'cassandra', 'appconfig',
    'route53resolver', 'resource-explorer-2', 'resourceexplorer2', 'scheduler',
}
# AWS::<Service>:: prefixes (from AWS Config) that map to the same dedicated
# scanners — skip in the Config catch-all for the same reason.
SCANNED_CONFIG_SERVICES = {
    'ec2', 's3', 'rds', 'lambda', 'dynamodb', 'elasticloadbalancing',
    'elasticloadbalancingv2', 'cloudfront', 'apigateway', 'apigatewayv2',
    'ecs', 'eks', 'route53', 'sns', 'sqs', 'kms', 'elasticache', 'efs',
    'redshift', 'kinesis', 'stepfunctions', 'events', 'cloudwatch',
    'autoscaling', 'secretsmanager', 'sagemaker', 'glue', 'athena',
    'cloudtrail', 'elasticbeanstalk', 'wafv2', 'guardduty', 'iam',
    'config', 'securityhub',
    'codedeploy', 'cognito', 'cognito-idp', 'cassandra', 'appconfig',
    'route53resolver', 'resourceexplorer2', 'scheduler',
}


def _already_scanned_service(service, source):
    """
    True if a dedicated scanner already covers this service, so the catch-all
    should skip it to avoid double/over-counting sub-resources.
    `source` is 'tagging' (ARN service code) or 'config' (AWS::Service::).
    """
    svc = (service or '').lower()
    if source == 'config':
        return svc in SCANNED_CONFIG_SERVICES
    return svc in SCANNED_ARN_SERVICES


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
    def _norm_id(rid):
        """Normalize an id/ARN to a bare, lowercased key for dedup."""
        if not rid:
            return ''
        s = str(rid)
        if s.startswith('arn:'):
            tail = s.split(':')[-1]
            s = tail.split('/')[-1] if '/' in tail else tail
        elif '/' in s:
            s = s.split('/')[-1]
        return s.lower()

    resources = []
    try:
        tagging = get_client('resourcegroupstaggingapi', credentials, region)
        paginator = tagging.get_paginator('get_resources')
        for page in paginator.paginate(ResourcesPerPage=100):
            for item in page.get('ResourceTagMappingList', []):
                arn = item.get('ResourceARN', '')
                if not arn or _norm_id(arn) in already_found_arns:
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

                # Skip services that already have a dedicated scanner — the
                # Tagging API returns their sub-resources too (API Gateway
                # stages/methods/keys, ELB listeners, CodeDeploy groups, …),
                # which would inflate the parent-service count. The dedicated
                # scanner is the single source of truth for those.
                if _already_scanned_service(service, 'tagging'):
                    continue

                # Drop TIER-1 NOISE (ENIs, AMIs, snapshots, log groups…).
                if _is_noise_resource(service, res_type, display_type, arn, res_name):
                    continue

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
    rt = (res_type or '').lower()

    # FIRST: resolve EC2 sub-resource types by their resource_type, because the
    # 'ec2' service namespace covers VPC, Subnet, SecurityGroup, IGW, NAT, etc.
    # Without this, a VPC ARN (service=ec2, type=vpc) would wrongly show as EC2.
    ec2_subtype_map = {
        'vpc': 'VPC',
        'subnet': 'Subnet',
        'security-group': 'SecurityGroup',
        'internet-gateway': 'InternetGateway',
        'natgateway': 'NATGateway',
        'nat-gateway': 'NATGateway',
        'route-table': 'RouteTable',
        'network-interface': 'NetworkInterface',
        'volume': 'EBS',
        'elastic-ip': 'ElasticIP',
        'eip': 'ElasticIP',
        'instance': 'EC2',
        'image': 'AMI',
        'snapshot': 'Snapshot',
        'network-acl': 'NetworkACL',
        'vpc-endpoint': 'VPCEndpoint',
        'transit-gateway': 'TransitGateway',
        'dhcp-options': 'DHCPOptions',
        'key-pair': 'KeyPair',
    }
    if service == 'ec2':
        if rt in ec2_subtype_map:
            return ec2_subtype_map[rt]
        # An EC2-namespace ARN whose sub-type we don't recognize (launch
        # template, capacity reservation, spot request, fleet, etc.) must NOT
        # be counted as an EC2 instance — that inflates the EC2 count. Label it
        # generically so it doesn't masquerade as a compute instance.
        return 'EC2Other'

    # IAM sub-resources → split users vs roles so the inventory shows separate
    # counts (matching the console's Users / Roles views). Policies/groups/
    # instance-profiles roll up under a generic IAM label.
    if service == 'iam':
        if rt in ('user',):
            return 'IAMUser'
        if rt in ('role',):
            return 'IAMRole'
        return 'IAM'

    if service == 'backup':
        if 'vault' in rt:
            return 'BackupVault'
        return 'BackupPlan'

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
        'secretsmanager': 'SecretsManager',
        'redshift': 'Redshift',
        'kinesis': 'Kinesis',
        'sagemaker': 'SageMaker',
        'glue': 'Glue',
        'athena': 'Athena',
        'cloudtrail': 'CloudTrail',
        'elasticbeanstalk': 'ElasticBeanstalk',
        'autoscaling': 'AutoScaling',
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


def discover_cost_trend(credentials):
    """
    Query Cost Explorer for the last 3 monthly totals (SOW 4.1 — 30/60/90-day
    cost trend widget). Returns a list of {month, cost_usd} newest-last.
    Requires Cost Explorer access in the client account.
    """
    trend = []
    try:
        from datetime import timedelta
        ce = get_client('ce', credentials, 'us-east-1')
        end = datetime.utcnow().date().replace(day=1)
        # Go back ~3 full months
        start_month = end
        for _ in range(3):
            # move start back one month
            prev = (start_month - timedelta(days=1)).replace(day=1)
            start_month = prev
        response = ce.get_cost_and_usage(
            TimePeriod={'Start': start_month.isoformat(), 'End': end.isoformat()},
            Granularity='MONTHLY',
            Metrics=['UnblendedCost'],
        )
        for result in response.get('ResultsByTime', []):
            period = result.get('TimePeriod', {}).get('Start', '')
            amount = float(result.get('Total', {}).get('UnblendedCost', {}).get('Amount', 0))
            trend.append({'month': period, 'cost_usd': round(amount, 2)})
    except ClientError as e:
        logger.info(f"Cost trend not accessible: {e.response['Error']['Code']}")
    except Exception as e:
        logger.info(f"Cost trend query skipped: {str(e)}")
    return trend


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


def _run_discovery(body):
    """
    Execute the full multi-region discovery and return the discovery_result dict.
    Raises on unrecoverable errors so callers can mark the scan record failed.
    """
    if True:
        role_arn = body.get('roleArn')
        # Region MUST come from the client's selection — no hardcoded test-region fallback.
        primary_region = body.get('region')
        account_id = body.get('accountId', '')
        external_id = body.get('externalId')
        # scan_regions: use explicit list if provided, else the single selected region.
        scan_regions = body.get('regions') or ([primary_region] if primary_region else [])

        # Validation
        if not role_arn:
            raise ValueError('roleArn is required')

        if not scan_regions:
            raise ValueError('region is required — please select a region when connecting the account')

        # Extract account ID from role ARN if not provided
        if not account_id:
            try:
                account_id = role_arn.split(':')[4]
            except IndexError:
                account_id = 'unknown'

        # Assume client role
        credentials = assume_client_role(role_arn, external_id)

        # Multi-region scan optimization: query active/enabled regions in client account to avoid timeout
        if len(scan_regions) > 1:
            try:
                probe_reg = primary_region if primary_region and primary_region != 'all' else 'us-east-1'
                ec2_client = get_client('ec2', credentials, probe_reg)
                enabled_resp = ec2_client.describe_regions(AllRegions=False)
                enabled_set = {r['RegionName'] for r in enabled_resp.get('Regions', [])}
                original_count = len(scan_regions)
                filtered = [r for r in scan_regions if r in enabled_set]
                if filtered:
                    scan_regions = filtered
                    logger.info(f"Filtered scan_regions from {original_count} to {len(scan_regions)} enabled regions: {scan_regions}")
            except Exception as reg_err:
                logger.warning(f"Could not filter regions via describe_regions: {reg_err}")

        # Discover resources across all specified regions
        all_resources = []
        discovery_errors = []
        logger.info(f"Scanning {len(scan_regions)} region(s): {scan_regions}")

        # ── Parallel per-region scan ─────────────────────────────────────────
        # Each region runs ~40 describe/list calls. Doing regions sequentially
        # makes all-regions scans exceed the API Gateway 29s limit. We scan all
        # regions concurrently (I/O-bound → threads help a lot) so a full
        # all-regions scan has a chance to finish inside the sync window.
        def _scan_one_region(region):
            found = []
            # Core detailed scanners.
            found.extend(safe_discover(discover_ec2, 'EC2', credentials, region))
            found.extend(safe_discover(discover_security_groups, 'SecurityGroups', credentials, region))
            found.extend(safe_discover(discover_rds, 'RDS', credentials, region))
            found.extend(safe_discover(discover_lambda_functions, 'Lambda', credentials, region))
            found.extend(safe_discover(discover_vpcs, 'VPC', credentials, region))
            found.extend(safe_discover(discover_load_balancers, 'ELB', credentials, region))
            found.extend(safe_discover(discover_dynamodb_tables, 'DynamoDB', credentials, region))
            found.extend(safe_discover(discover_api_gateways, 'APIGateway', credentials, region))
            found.extend(safe_discover(discover_ecs, 'ECS', credentials, region))
            found.extend(safe_discover(discover_eks, 'EKS', credentials, region))
            found.extend(safe_discover(discover_sns_topics, 'SNS', credentials, region))
            found.extend(safe_discover(discover_sqs_queues, 'SQS', credentials, region))
            found.extend(safe_discover(discover_kms_keys, 'KMS', credentials, region))
            # Extended describe/list scanners (SOW: 50+ services).
            found.extend(safe_discover(discover_ebs_volumes, 'EBS', credentials, region))
            found.extend(safe_discover(discover_elasticache, 'ElastiCache', credentials, region))
            found.extend(safe_discover(discover_efs, 'EFS', credentials, region))
            found.extend(safe_discover(discover_redshift, 'Redshift', credentials, region))
            found.extend(safe_discover(discover_kinesis, 'Kinesis', credentials, region))
            found.extend(safe_discover(discover_stepfunctions, 'StepFunctions', credentials, region))
            found.extend(safe_discover(discover_eventbridge, 'EventBridge', credentials, region))
            found.extend(safe_discover(discover_cloudwatch_alarms, 'CloudWatch', credentials, region))
            found.extend(safe_discover(discover_autoscaling, 'AutoScaling', credentials, region))
            found.extend(safe_discover(discover_secretsmanager, 'SecretsManager', credentials, region))
            found.extend(safe_discover(discover_sagemaker, 'SageMaker', credentials, region))
            found.extend(safe_discover(discover_glue, 'Glue', credentials, region))
            found.extend(safe_discover(discover_athena, 'Athena', credentials, region))
            found.extend(safe_discover(discover_cloudtrail, 'CloudTrail', credentials, region))
            found.extend(safe_discover(discover_elasticbeanstalk, 'ElasticBeanstalk', credentials, region))
            found.extend(safe_discover(discover_apigatewayv2, 'APIGatewayV2', credentials, region))
            found.extend(safe_discover(discover_neptune, 'Neptune', credentials, region))
            found.extend(safe_discover(discover_documentdb, 'DocumentDB', credentials, region))
            found.extend(safe_discover(discover_opensearch, 'OpenSearch', credentials, region))
            found.extend(safe_discover(discover_guardduty, 'GuardDuty', credentials, region))
            found.extend(safe_discover(discover_wafv2, 'WAF', credentials, region))
            found.extend(safe_discover(discover_transit_gateway, 'TransitGateway', credentials, region))
            found.extend(safe_discover(discover_security_hub, 'SecurityHub', credentials, region))
            found.extend(safe_discover(discover_config, 'Config', credentials, region))
            found.extend(safe_discover(discover_fsx, 'FSx', credentials, region))
            found.extend(safe_discover(discover_batch, 'Batch', credentials, region))
            found.extend(safe_discover(discover_apprunner, 'AppRunner', credentials, region))
            found.extend(safe_discover(discover_emr, 'EMR', credentials, region))
            found.extend(safe_discover(discover_appsync, 'AppSync', credentials, region))
            found.extend(safe_discover(discover_ssm, 'SystemsManager', credentials, region))
            found.extend(safe_discover(discover_codedeploy, 'CodeDeploy', credentials, region))
            found.extend(safe_discover(discover_cognito, 'Cognito', credentials, region))
            found.extend(safe_discover(discover_backup_plans, 'BackupPlan', credentials, region))
            found.extend(safe_discover(discover_backup_vaults, 'BackupVault', credentials, region))
            return found

        max_workers = min(len(scan_regions), 12) or 1
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = {pool.submit(_scan_one_region, r): r for r in scan_regions}
            for fut in as_completed(futures):
                try:
                    all_resources.extend(fut.result())
                except Exception as e:
                    logger.error(f"Region scan failed for {futures[fut]}: {e}")

        # Global / Account-wide services - only scan once.
        all_resources.extend(safe_discover(discover_cloudfront, 'CloudFront', credentials, 'us-east-1'))
        all_resources.extend(safe_discover(discover_route53, 'Route53', credentials, 'us-east-1'))
        all_resources.extend(safe_discover(discover_iam, 'IAM', credentials, 'us-east-1'))
        all_resources.extend(safe_discover(discover_s3, 'S3', credentials, primary_region or 'us-east-1'))

        # ── Safety-net catch-alls so NOTHING is missed (tagged or untagged) ──
        # Dedup by a NORMALIZED key so the same resource discovered by different
        # sources (detailed scanner = bare id like "vpc-123", tagging API = full
        # ARN "...:vpc/vpc-123", Config = "vpc-123") is only counted ONCE.
        def _dedup_key(resource_id):
            if not resource_id:
                return ''
            rid = str(resource_id)
            # If it's an ARN, take the last path/colon segment (the bare id).
            if rid.startswith('arn:'):
                tail = rid.split(':')[-1]
                if '/' in tail:
                    tail = tail.split('/')[-1]
                return tail.lower()
            if '/' in rid:
                return rid.split('/')[-1].lower()
            return rid.lower()

        already_found_arns = {_dedup_key(r.get('id', '')) for r in all_resources}
        config_relationships = []  # real relationships from AWS Config (if enabled)

        # Catch-all discovery (Tagging API + AWS Config) runs per region and is
        # I/O-bound, so parallelize it too. Each worker returns its findings;
        # dedup happens sequentially afterwards to keep the shared set correct.
        def _catchall_one_region(region):
            snapshot = set(already_found_arns)
            tagged = safe_discover(
                lambda creds, reg: discover_all_resources_via_tagging(creds, reg, snapshot),
                'TaggingAPI', credentials, region
            ) or []
            cfg_found, cfg_rels = [], []
            try:
                cfg_found, cfg_rels = discover_all_resources_via_config(
                    credentials, region, snapshot
                )
            except Exception as e:
                logger.info(f"AWS Config discovery skipped in {region}: {str(e)}")
            return tagged, cfg_found, cfg_rels

        with ThreadPoolExecutor(max_workers=min(len(scan_regions), 12) or 1) as pool:
            futures = {pool.submit(_catchall_one_region, r): r for r in scan_regions}
            for fut in as_completed(futures):
                try:
                    tagged, cfg_found, cfg_rels = fut.result()
                except Exception as e:
                    logger.error(f"Catch-all scan failed for {futures[fut]}: {e}")
                    continue
                for r in tagged:
                    key = _dedup_key(r.get('id'))
                    if key and key not in already_found_arns:
                        all_resources.append(r)
                        already_found_arns.add(key)
                for r in cfg_found:
                    key = _dedup_key(r.get('id'))
                    if key and key not in already_found_arns:
                        all_resources.append(r)
                        already_found_arns.add(key)
                config_relationships.extend(cfg_rels)

        # ── Cost Explorer: full service footprint (matches billing) ──────────
        services_footprint = discover_services_from_cost_explorer(credentials)
        # ── Cost Explorer: 90-day monthly trend (SOW 4.1 cost trend widget) ──
        cost_trend = discover_cost_trend(credentials)

        # NOTE: We intentionally DO NOT add "billed-but-not-discovered" services
        # as resource nodes. The inventory must reflect ONLY resources that were
        # actually discovered in the account, so the counts match the AWS
        # Console exactly. Cost Explorer data is still used for the cost-trend
        # widget (costTrend) and the optional cost view — never as phantom
        # resources. (Previously, billing line items like EC2/VPC could appear
        # with counts even when no such resource existed — that is removed.)

        # ── FINAL DEDUP PASS ─────────────────────────────────────────────────
        # Guarantee each real resource appears ONCE, regardless of how many
        # scanners found it (detailed + tagging + Config). We key by
        # (normalized-id, type) so, e.g., the same VPC found as "vpc-123",
        # "arn:...:vpc/vpc-123", and Config "vpc-123" collapses to one — while
        # genuinely different resources (2 real VPCs) are still counted
        # separately. Prefer the richest record (detailed scanner over ARN-only
        # tagging/Config entries).
        def _canonical_key(r):
            rid = str(r.get('id', ''))
            if rid.startswith('arn:'):
                tail = rid.split(':')[-1]
                bare = tail.split('/')[-1] if '/' in tail else tail
            elif '/' in rid:
                bare = rid.split('/')[-1]
            else:
                bare = rid
            return (bare.lower(), r.get('type', ''))

        def _richness(r):
            # A detailed-scanner record (no 'discovered_via') is richest; then
            # Config; then tagging; then billing-only.
            via = r.get('discovered_via', '')
            return {'': 3, 'aws_config': 2, 'iam': 3, 'tagging_api': 1, 'cost_explorer': 0}.get(via, 1)

        _deduped = {}
        for r in all_resources:
            key = _canonical_key(r)
            existing = _deduped.get(key)
            if existing is None or _richness(r) > _richness(existing):
                _deduped[key] = r
        all_resources = list(_deduped.values())

        # Final safety filter: clean out any noise or system artifacts
        all_resources = [
            r for r in all_resources
            if not _is_noise_resource(
                r.get('aws_service', r.get('type', '')),
                r.get('raw_resource_type', r.get('type', '')),
                r.get('type', ''),
                r.get('id', ''),
                r.get('name', '')
            )
        ]

        # Ensure inherently global resources are consistently marked as 'global'
        for r in all_resources:
            if r.get('type') in ('CloudFront', 'Route53', 'IAM', 'IAMUser', 'IAMRole'):
                r['region'] = 'global'

        # Filter resources if a single region was explicitly requested
        is_all_regions = (primary_region == 'all') or (len(scan_regions) > 1)
        if not is_all_regions and primary_region:
            def _belongs_to_selected_region(r):
                # Inherently global services always belong
                if r.get('type') in ('CloudFront', 'Route53', 'IAM', 'IAMUser', 'IAMRole'):
                    return True
                # S3 bucket matching
                if r.get('type') == 'S3':
                    breg = r.get('bucket_region') or r.get('region')
                    return breg == primary_region or breg == 'unknown'
                # Other regional resources
                return r.get('region') == primary_region or not r.get('region')

            all_resources = [r for r in all_resources if _belongs_to_selected_region(r)]

        # Build relationships from resource configs, then merge AWS Config's
        # native relationship graph (deduped) — Config gives real connections
        # for resources our own logic might not link.
        relationships = build_relationships(all_resources)
        resource_ids = {r.get('id') for r in all_resources}
        seen_rel = {(r['source'], r['target']) for r in relationships}
        for rel in config_relationships:
            key = (rel.get('source'), rel.get('target'))
            # only keep relationships where both endpoints are known resources
            if (key not in seen_rel
                    and rel.get('source') in resource_ids
                    and rel.get('target') in resource_ids):
                relationships.append(rel)
                seen_rel.add(key)

        # Use a pre-assigned scan ID when running as a background job (so the
        # /status poller can find this exact scan); otherwise generate one.
        scan_id = body.get('scanId') or f"scan-{account_id}-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"

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
            'costTrend': cost_trend,
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

        return discovery_result


# ── Response helpers ────────────────────────────────────────────────────────


def _cors():
    return {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    }


def _err(status, message):
    return {'statusCode': status, 'headers': _cors(), 'body': json.dumps({'error': message})}


def lambda_handler(event, context):
    """
    Synchronous resource discovery.
    Input: { roleArn, region, accountId?, externalId?, regions? }
    Runs all requested regions and returns the full inventory. If it cannot
    finish within the API Gateway 29s limit it fails — there is no background job.
    """
    try:
        if isinstance(event.get('body'), str):
            body = json.loads(event['body'])
        elif isinstance(event.get('body'), dict):
            body = event['body']
        else:
            body = event

        action = body.get('action')
        if action == 'list_scans':
            account_id = body.get('accountId')
            table = dynamodb.Table(SCANS_TABLE)
            if account_id:
                resp = table.scan(
                    FilterExpression='accountId = :a',
                    ExpressionAttributeValues={':a': str(account_id)}
                )
            else:
                resp = table.scan()
            items = resp.get('Items', [])
            items.sort(key=lambda x: str(x.get('timestamp', '')), reverse=True)
            return {
                'statusCode': 200,
                'headers': _cors(),
                'body': json.dumps({'scans': items, 'count': len(items)}, default=str)
            }

        if action == 'get_scan':
            scan_id = body.get('scanId')
            if not scan_id:
                return _err(400, 'scanId is required')
            try:
                obj = s3_client.get_object(Bucket=DATA_BUCKET, Key=f"scan-results/{scan_id}.json")
                scan_data = json.loads(obj['Body'].read())
                return {
                    'statusCode': 200,
                    'headers': _cors(),
                    'body': json.dumps(scan_data, default=str)
                }
            except ClientError as e:
                return _err(404, f"Scan {scan_id} not found in S3: {e}")

        if action == 'delete_scan':
            scan_id = body.get('scanId')
            account_id = body.get('accountId')
            if not scan_id or not account_id:
                return _err(400, 'scanId and accountId are required')
            table = dynamodb.Table(SCANS_TABLE)
            table.delete_item(Key={'scanId': scan_id, 'accountId': str(account_id)})
            return {
                'statusCode': 200,
                'headers': _cors(),
                'body': json.dumps({'message': f'Scan {scan_id} deleted successfully'})
            }

        # Synchronous discovery only. If a scan (e.g. all-regions) cannot finish
        # within the API Gateway 29s hard limit, it fails cleanly and the UI
        # shows "Scan failed" — there is no background job.
        if not body.get('roleArn'):
            return _err(400, 'roleArn is required')
        regions = body.get('regions') or ([body.get('region')] if body.get('region') else [])
        if not regions:
            return _err(400, 'region is required — please select a region when connecting the account')

        try:
            result = _run_discovery(body)
        except ValueError as ve:
            return _err(400, str(ve))
        return {'statusCode': 200, 'headers': _cors(), 'body': json.dumps(result, default=str)}

    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code', '')
        error_msg = e.response.get('Error', {}).get('Message', '')
        logger.error(f"AWS Error in resource discovery [{error_code}]: {error_msg}")
        if error_code == 'AccessDenied' and 'AssumeRole' in error_msg:
            role_arn = body.get('roleArn', '') if isinstance(body, dict) else ''
            ext_id = body.get('externalId') if isinstance(body, dict) else None
            caller_acct = ''
            try:
                caller_acct = sts_client.get_caller_identity().get('Account', '')
            except Exception:
                pass
            acct_info = f" (AWS Account {caller_acct})" if caller_acct else ""
            role_hint = f"'arn:aws:iam::{caller_acct}:role/archlens-lambda-execution-role'" if caller_acct else "ArchLens Lambda execution role"
            diagnostic = (
                f"Cross-Account Trust Authorization Failed: ArchLens{acct_info} is not authorized "
                f"to assume role '{role_arn}'. Please ensure the target AWS account has added ArchLens "
                f"({role_hint}) to the role's Trust Relationship policy"
            )
            if ext_id:
                diagnostic += f" with ExternalId '{ext_id}'."
            else:
                diagnostic += ". If the role requires an External ID, please enter it in the connection form."
            return _err(403, diagnostic)
        return _err(500, f"AWS Error: {error_msg}")
    except Exception as e:
        logger.error(f"Unexpected error in resource discovery: {str(e)}")
        return _err(500, f"Internal error: {str(e)}")

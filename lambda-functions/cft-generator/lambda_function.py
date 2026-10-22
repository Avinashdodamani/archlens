"""
ArchLens CloudFormation Template Generator Lambda
Generates production-ready CloudFormation templates from approved recommendations.
Uses Amazon Bedrock to create templates with safety mechanisms built in.
"""

import json
import boto3
import os
import logging
from datetime import datetime
from botocore.exceptions import ClientError
from botocore.config import Config

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize clients
s3_client = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')
sqs_client = boto3.client('sqs')


def _normalize_sqs_url(url_or_arn, default_region='ap-south-1'):
    """Ensure the SQS queue target is a valid HTTPS SQS URL even if an ARN was configured."""
    if not url_or_arn:
        return ''
    raw = str(url_or_arn).strip()
    if raw.startswith('https://') or raw.startswith('http://'):
        return raw
    if raw.startswith('arn:aws:sqs:'):
        parts = raw.split(':')
        if len(parts) >= 6:
            region = parts[3] or default_region
            account = parts[4]
            qname = parts[5]
            return f"https://sqs.{region}.amazonaws.com/{account}/{qname}"
    return raw


# Configuration from environment variables
DATA_BUCKET = os.environ.get('DATA_BUCKET', 'archlens-data')
MODEL_ID = os.environ.get('BEDROCK_MODEL_ID') or os.environ.get('MODEL_ID', 'apac.anthropic.claude-3-5-sonnet-20241022-v2:0')
BEDROCK_REGION = os.environ.get('BEDROCK_REGION', 'ap-south-1')
MAX_TOKENS = int(os.environ['MAX_TOKENS'])
AUDIT_TABLE = os.environ.get('AUDIT_TABLE', 'archlens-audit')
BEDROCK_READ_TIMEOUT = int(os.environ.get('BEDROCK_READ_TIMEOUT', 60))
CFT_QUEUE_URL = _normalize_sqs_url(os.environ.get('CFT_QUEUE_URL', ''))
POLL_INTERVAL_SECONDS = int(os.environ.get('POLL_INTERVAL_SECONDS', 5))

# Initialize Bedrock client with configurable timeout
bedrock_config = Config(
    connect_timeout=60,
    read_timeout=BEDROCK_READ_TIMEOUT,
    retries={'max_attempts': 2}
)
bedrock = boto3.client('bedrock-runtime', region_name=BEDROCK_REGION, config=bedrock_config)


def generate_cft_prompt(recommendations, architecture_data, scan_id):
    """
    Build prompt for CloudFormation template generation.
    No hardcoded templates - Bedrock generates based on actual recommendations
    and current AWS CloudFormation best practices.
    """
    prompt = f"""You are an expert AWS CloudFormation engineer with deep knowledge of all AWS services, CloudFormation best practices, and infrastructure safety patterns.

## TASK:
Generate a production-ready AWS CloudFormation YAML template that implements the following approved architecture changes. The template must be safe to deploy with built-in protection mechanisms.

## CURRENT ARCHITECTURE CONTEXT:
{json.dumps(architecture_data.get('summary', architecture_data), indent=2, default=str)[:4000]}

## APPROVED RECOMMENDATIONS TO IMPLEMENT:
{json.dumps(recommendations, indent=2, default=str)}

## CLOUDFORMATION REQUIREMENTS:

### Structure:
- AWSTemplateFormatVersion: '2010-09-09'
- Description that includes scan reference: {scan_id}
- Parameters for all configurable values (region, environment, naming)
- Conditions for optional features
- Resources with proper ordering
- Outputs for all important endpoints, ARNs, and IDs

### Safety Requirements (MANDATORY):
- DeletionPolicy: Retain on ALL stateful resources (databases, S3, EFS, etc.)
- DeletionPolicy: Snapshot on all resources that support snapshots (RDS, EBS)
- UpdateReplacePolicy: Snapshot where applicable
- Use DependsOn for explicit resource ordering where implicit dependencies aren't clear
- Never use hardcoded account IDs - use AWS::AccountId pseudo parameter
- Never use hardcoded regions - use AWS::Region pseudo parameter
- Use Fn::Sub for string interpolation instead of Fn::Join where possible

### Best Practices (MANDATORY):
- Use the latest resource type specifications
- Include proper IAM policies with least privilege (no wildcards on actions)
- Add meaningful Tags on all taggable resources:
    - Project: ArchLens
    - Environment: !Ref Environment
    - ManagedBy: ArchLens-AutoRemediate
    - ScanId: {scan_id}
    - CreatedAt: !Ref AWS::StackName
- Enable encryption at rest for all supported resources
- Enable logging where applicable
- Use VPC endpoints instead of public endpoints where possible
- Include CloudWatch alarms for critical metrics
- Use Mappings for region-specific or environment-specific values if needed

### Parameters to Include:
- Environment (dev/staging/prod with default 'dev')
- ProjectName (default 'ArchLens')
- Any resource-specific parameters the recommendations require
- NotificationEmail (for SNS alerts)

### Template Validation:
- All !Ref and !GetAtt references must be valid
- Resource logical IDs must be PascalCase with no special characters
- Parameter names must be descriptive and PascalCase
- Include AllowedValues constraints where applicable
- Include MinLength/MaxLength constraints for string parameters

## OUTPUT FORMAT:
Provide ONLY the CloudFormation template in valid YAML format.
- Start directly with "AWSTemplateFormatVersion"
- Do NOT wrap in markdown code blocks
- Do NOT include any text before or after the template
- Ensure the YAML is properly indented and valid
"""
    return prompt


def invoke_bedrock(prompt):
    """Call Amazon Bedrock for CFT generation using the model ID configured in environment variables."""
    try:
        is_anthropic = 'anthropic' in MODEL_ID.lower() or 'claude' in MODEL_ID.lower()
        if is_anthropic:
            request_body = {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": MAX_TOKENS,
                "temperature": 0.1,  # Low temperature for deterministic code generation
                "messages": [
                    {
                        "role": "user",
                        "content": prompt
                    }
                ]
            }
        else:
            request_body = {
                "messages": [
                    {
                        "role": "user",
                        "content": [{"text": prompt}]
                    }
                ],
                "inferenceConfig": {
                    "max_new_tokens": MAX_TOKENS,
                    "temperature": 0.1
                }
            }

        response = bedrock.invoke_model(
            modelId=MODEL_ID,
            contentType='application/json',
            accept='application/json',
            body=json.dumps(request_body)
        )

        response_body = json.loads(response['body'].read())
        if 'content' in response_body and isinstance(response_body['content'], list) and len(response_body['content']) > 0:
            ai_text = response_body['content'][0].get('text', '')
        elif 'output' in response_body and 'message' in response_body['output']:
            ai_text = response_body['output']['message']['content'][0]['text']
        else:
            ai_text = str(response_body)

        # Log usage
        usage = response_body.get('usage', {})
        logger.info(f"CFT Generation Bedrock usage: {usage}")

        return ai_text

    except ClientError as e:
        logger.error(f"Bedrock error during CFT generation: {e.response['Error']['Message']}")
        raise
    except Exception as e:
        logger.error(f"Error calling Bedrock: {str(e)}")
        raise


def clean_template(raw_template):
    """
    Clean the generated template - remove markdown wrappers and validate basic structure.
    """
    template = raw_template.strip()

    # Remove markdown code block wrappers if present
    if template.startswith('```'):
        lines = template.split('\n')
        # Remove first line (```yaml or ```)
        if lines[0].strip().startswith('```'):
            lines = lines[1:]
        # Remove last line (```)
        if lines and lines[-1].strip() == '```':
            lines = lines[:-1]
        template = '\n'.join(lines)

    # Basic validation - check if it starts with AWSTemplateFormatVersion
    if not template.strip().startswith('AWSTemplateFormatVersion'):
        # Try to find it in the text
        idx = template.find('AWSTemplateFormatVersion')
        if idx >= 0:
            template = template[idx:]
        else:
            logger.warning("Generated template does not start with AWSTemplateFormatVersion")

    return template.strip()


def validate_template_structure(template):
    """
    Basic structural validation of the CloudFormation template.
    Returns (is_valid, issues_list).
    """
    issues = []

    if 'AWSTemplateFormatVersion' not in template:
        issues.append("Missing AWSTemplateFormatVersion")

    if 'Resources:' not in template and 'Resources :' not in template:
        issues.append("Missing Resources section")

    if 'DeletionPolicy' not in template:
        issues.append("Warning: No DeletionPolicy found - stateful resources may not be protected")

    # Check for common security issues
    if '* ' in template and 'Action:' in template:
        # This is a rough check - could be in resource ARNs which is OK
        action_lines = [l for l in template.split('\n') if 'Action:' in l and '*' in l]
        if action_lines:
            issues.append("Warning: Wildcard (*) found in IAM actions - review for least privilege")

    return len([i for i in issues if not i.startswith('Warning')]) == 0, issues


def save_cft_status(job_id, status, result=None, error=None):
    """Save CFT generation job status to S3 for asynchronous polling."""
    try:
        payload = {
            'status': status,
            'jobId': job_id,
            'updatedAt': datetime.utcnow().isoformat()
        }
        if result:
            payload['result'] = result
        if error:
            payload['error'] = error

        s3_client.put_object(
            Bucket=DATA_BUCKET,
            Key=f"cft-status/{job_id}.json",
            Body=json.dumps(payload, default=str),
            ContentType='application/json'
        )
    except Exception as e:
        logger.warning(f"Failed to update CFT status for {job_id}: {e}")


def get_cft_status(job_id):
    """Fetch current CFT generation status from S3."""
    if not job_id:
        return {'status': 'NOT_FOUND', 'error': 'Missing jobId'}
    try:
        resp = s3_client.get_object(
            Bucket=DATA_BUCKET,
            Key=f"cft-status/{job_id}.json"
        )
        return json.loads(resp['Body'].read())
    except ClientError as e:
        if e.response['Error']['Code'] in ('NoSuchKey', '404'):
            return {'status': 'IN_PROGRESS', 'jobId': job_id}
        logger.error(f"Error fetching CFT status: {e}")
        return {'status': 'ERROR', 'error': str(e)}
    except Exception as e:
        logger.error(f"Error reading CFT status: {e}")
        return {'status': 'ERROR', 'error': str(e)}


def run_cft_pipeline(scan_id, recommendation_id, recommendations, architecture_data, body):
    """Core CloudFormation template generation pipeline."""
    # Step Functions integration: unpack from analysisResult / discoveryResult
    if not recommendations and not recommendation_id:
        analysis = body.get('analysisResult')
        if isinstance(analysis, dict):
            analysis_data = analysis
            if 'body' in analysis and isinstance(analysis['body'], str):
                try:
                    analysis_data = json.loads(analysis['body'])
                except Exception:
                    pass
            elif 'body' in analysis and isinstance(analysis['body'], dict):
                analysis_data = analysis['body']

            if isinstance(analysis_data, dict):
                if analysis_data.get('recommendationId'):
                    recommendation_id = analysis_data['recommendationId']
                if analysis_data.get('analysis', {}).get('recommendations'):
                    recommendations = analysis_data['analysis']['recommendations']
                elif analysis_data.get('recommendations'):
                    recommendations = analysis_data['recommendations']
                if analysis_data.get('architectureData') and not architecture_data:
                    architecture_data = analysis_data['architectureData']
                if analysis_data.get('scanId') and scan_id == 'unknown':
                    scan_id = analysis_data['scanId']

    if scan_id == 'unknown' and body.get('discoveryResult'):
        disc = body['discoveryResult']
        if isinstance(disc, dict):
            disc_data = json.loads(disc['body']) if isinstance(disc.get('body'), str) else disc.get('body', disc)
            if isinstance(disc_data, dict) and disc_data.get('scanId'):
                scan_id = disc_data['scanId']
            if not architecture_data and isinstance(disc_data, dict) and disc_data.get('resources'):
                architecture_data = disc_data

    # Fetch recommendations from S3 if only ID provided
    if recommendation_id and not recommendations:
        try:
            s3_response = s3_client.get_object(
                Bucket=DATA_BUCKET,
                Key=f"reports/{recommendation_id}.json"
            )
            report_data = json.loads(s3_response['Body'].read())
            recommendations = report_data.get('analysis', {}).get('recommendations', [])
            architecture_data = report_data.get('architectureData', architecture_data)
            scan_id = report_data.get('scanId', scan_id)
        except ClientError as e:
            logger.error(f"Failed to fetch recommendations: {e.response['Error']['Message']}")
            raise RuntimeError(f"Recommendation {recommendation_id} not found in S3: {e.response['Error']['Message']}")

    if not recommendations:
        raise ValueError("No recommendations provided for CloudFormation generation")

    active_recommendations = [
        r for r in recommendations
        if r.get('status', 'approved') in ('approved', 'selected', 'generated')
    ]
    if not active_recommendations:
        active_recommendations = recommendations

    logger.info(f"Generating CFT for {len(active_recommendations)} recommendations")

    prompt = generate_cft_prompt(active_recommendations, architecture_data, scan_id)
    raw_template = invoke_bedrock(prompt)

    cft_template = clean_template(raw_template)
    is_valid, validation_issues = validate_template_structure(cft_template)
    if not is_valid or not cft_template.strip():
        logger.error(f"Bedrock generated invalid CloudFormation template: {validation_issues}")
        raise ValueError(f"Bedrock generated invalid CloudFormation template: {'; '.join(validation_issues) if validation_issues else 'Empty template'}")

    timestamp = datetime.utcnow().strftime('%Y%m%d%H%M%S')
    cft_key = f"cloudformation/archlens-{scan_id}-{timestamp}.yaml"

    s3_client.put_object(
        Bucket=DATA_BUCKET,
        Key=cft_key,
        Body=cft_template,
        ContentType='application/x-yaml',
        Metadata={
            'scan-id': str(scan_id),
            'recommendation-id': str(recommendation_id or 'direct'),
            'generated-at': datetime.utcnow().isoformat(),
            'recommendation-count': str(len(active_recommendations))
        }
    )

    download_url = s3_client.generate_presigned_url(
        'get_object',
        Params={'Bucket': DATA_BUCKET, 'Key': cft_key},
        ExpiresIn=3600
    )

    try:
        audit_table = dynamodb.Table(AUDIT_TABLE)
        audit_table.put_item(Item={
            'auditId': f"cft-gen-{timestamp}",
            'timestamp': datetime.utcnow().isoformat(),
            'action': 'CFT_GENERATED',
            'scanId': scan_id,
            'recommendationId': recommendation_id or 'direct',
            'templateKey': cft_key,
            'recommendationCount': len(active_recommendations),
            'validationPassed': is_valid,
            'validationIssues': validation_issues
        })
    except Exception as e:
        logger.warning(f"Failed to write audit log: {str(e)}")

    return {
        'status': 'success',
        'scanId': scan_id,
        'recommendationId': recommendation_id,
        'timestamp': datetime.utcnow().isoformat(),
        'template': cft_template,
        's3Key': cft_key,
        'downloadUrl': download_url,
        'templateType': 'CloudFormation',
        'format': 'YAML',
        'validation': {
            'passed': is_valid,
            'issues': validation_issues
        },
        'metadata': {
            'recommendations_implemented': len(active_recommendations),
            'model_used': MODEL_ID
        }
    }


def lambda_handler(event, context):
    """
    Main handler for CloudFormation template generation.
    Supports:
    1. SQS Trigger: Background worker processing queued CFT jobs.
    2. API Gateway Status Check: action == 'get_status' returns status in <0.05s.
    3. API Gateway Enqueue: Pushes job to SQS and immediately returns status: 'IN_PROGRESS'.
    4. Synchronous execution fallback for direct Step Functions invocation.
    """
    cors_headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST,GET,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization'
    }

    try:
        # 1. Handle SQS Trigger Event (Background Worker)
        if isinstance(event, dict) and 'Records' in event and len(event['Records']) > 0:
            record = event['Records'][0]
            if record.get('eventSource') == 'aws:sqs':
                logger.info("Processing CFT generation from SQS trigger")
                sqs_body = json.loads(record.get('body', '{}'))
                job_id = sqs_body.get('jobId')
                scan_id = sqs_body.get('scanId', 'unknown')
                rec_id = sqs_body.get('recommendationId')
                recs = sqs_body.get('recommendations')
                arch_data = sqs_body.get('architectureData', {})

                try:
                    result = run_cft_pipeline(scan_id, rec_id, recs, arch_data, sqs_body)
                    save_cft_status(job_id, 'COMPLETED', result=result)
                    logger.info(f"SQS CFT Job {job_id} completed successfully")
                    return {'statusCode': 200, 'body': 'SQS CFT Job Completed Successfully'}
                except Exception as worker_err:
                    logger.error(f"SQS CFT Worker Job {job_id} failed: {worker_err}")
                    save_cft_status(job_id, 'FAILED', error=str(worker_err))
                    return {'statusCode': 200, 'body': f"Worker recorded error: {str(worker_err)}"}

        # 2. Parse input from API Gateway or Step Functions
        if isinstance(event.get('body'), str):
            body = json.loads(event['body'])
        elif 'body' in event and isinstance(event['body'], dict):
            body = event['body']
        else:
            body = event

        recommendation_id = body.get('recommendationId')
        recommendations = body.get('recommendations')
        architecture_data = body.get('architectureData', {})
        scan_id = body.get('scanId', 'unknown')
        action = body.get('action')
        job_id = body.get('jobId') or f"{scan_id}_{recommendation_id or 'all'}"

        # 3. Status Poll Action (Checked by frontend every pollIntervalSeconds)
        if action == 'get_status':
            status_data = get_cft_status(job_id)
            return {
                'statusCode': 200,
                'headers': cors_headers,
                'body': json.dumps(status_data, default=str)
            }

        # 4. Asynchronous Decoupling via SQS (Prevents 504 Timeouts)
        if CFT_QUEUE_URL and not body.get('isStepFunction'):
            try:
                logger.info(f"Queuing CFT generation job {job_id} to SQS: {CFT_QUEUE_URL}")
                save_cft_status(job_id, 'IN_PROGRESS')

                sqs_client.send_message(
                    QueueUrl=CFT_QUEUE_URL,
                    MessageBody=json.dumps({
                        'jobId': job_id,
                        'scanId': scan_id,
                        'recommendationId': recommendation_id,
                        'recommendations': recommendations,
                        'architectureData': architecture_data
                    })
                )
                logger.info(f"Successfully queued CFT job {job_id} to SQS")

                return {
                    'statusCode': 200,
                    'headers': cors_headers,
                    'body': json.dumps({
                        'status': 'IN_PROGRESS',
                        'jobId': job_id,
                        'scanId': scan_id,
                        'recommendationId': recommendation_id,
                        'pollIntervalSeconds': POLL_INTERVAL_SECONDS,
                        'message': 'CloudFormation template generation queued to SQS'
                    })
                }
            except Exception as sqs_err:
                logger.warning(f"Failed to queue CFT job to SQS ({sqs_err}), falling back to direct execution")

        # 5. Direct Synchronous Execution (Step Functions or fallback)
        result = run_cft_pipeline(scan_id, recommendation_id, recommendations, architecture_data, body)
        return {
            'statusCode': 200,
            'headers': cors_headers,
            'body': json.dumps(result, default=str)
        }

    except ClientError as e:
        logger.error(f"AWS Error in CFT generation: {e.response['Error']['Message']}")
        return {
            'statusCode': 500,
            'headers': cors_headers,
            'body': json.dumps({'error': f"AWS Error: {e.response['Error']['Message']}"})
        }
    except Exception as e:
        logger.error(f"Unexpected error in CFT generation: {str(e)}")
        return {
            'statusCode': 500,
            'headers': cors_headers,
            'body': json.dumps({'error': f"Internal error: {str(e)}"})
        }

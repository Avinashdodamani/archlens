"""
ArchLens Terraform Script Generator Lambda
Generates production-ready Terraform HCL code from approved recommendations.
Uses Amazon Bedrock to create multi-file Terraform configurations with safety mechanisms.
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
TF_QUEUE_URL = _normalize_sqs_url(os.environ.get('TF_QUEUE_URL', ''))
POLL_INTERVAL_SECONDS = int(os.environ.get('POLL_INTERVAL_SECONDS', 5))

# Initialize Bedrock client with configurable timeout
bedrock_config = Config(
    connect_timeout=60,
    read_timeout=BEDROCK_READ_TIMEOUT,
    retries={'max_attempts': 2}
)
bedrock = boto3.client('bedrock-runtime', region_name=BEDROCK_REGION, config=bedrock_config)


def generate_terraform_prompt(recommendations, architecture_data, scan_id):
    """
    Build prompt for Terraform HCL generation.
    No hardcoded Terraform blocks - Bedrock generates based on actual recommendations
    and current Terraform + AWS provider best practices.
    """
    prompt = f"""You are an expert Terraform engineer specializing in AWS infrastructure. You have comprehensive knowledge of the Terraform AWS provider, all its resources and data sources, and Terraform best practices for production environments.

## TASK:
Generate production-ready Terraform HCL code that implements the following approved architecture changes. The code must follow Terraform best practices and include safety mechanisms.

## CURRENT ARCHITECTURE CONTEXT:
{json.dumps(architecture_data.get('summary', architecture_data), indent=2, default=str)[:4000]}

## APPROVED RECOMMENDATIONS TO IMPLEMENT:
{json.dumps(recommendations, indent=2, default=str)}

## TERRAFORM REQUIREMENTS:

### File Structure (MANDATORY):
Generate separate files using this exact marker format between files:
# === FILENAME: <filename> ===

Required files:
1. main.tf - Provider configuration, terraform block, and main resources
2. variables.tf - All input variables with descriptions, types, and defaults
3. outputs.tf - All outputs with descriptions
4. locals.tf - Computed values, naming conventions, common tags
5. data.tf - Data sources for existing resources (things that already exist and should NOT be recreated)
6. terraform.tfvars - Default values for this specific deployment

### Provider & Backend Configuration:
- Use terraform block with required_providers (hashicorp/aws with version constraint ~> 5.0)
- Configure S3 backend for state storage (bucket: archlens-data, key: terraform/{scan_id}/terraform.tfstate)
- Set provider region using variable
- Enable default_tags in the provider block

### Safety Requirements (MANDATORY):
- lifecycle {{ prevent_destroy = true }} on ALL stateful resources (databases, S3 buckets, EFS, etc.)
- lifecycle {{ create_before_destroy = true }} for resources that need zero-downtime replacement
- lifecycle {{ ignore_changes = [...] }} for attributes managed outside Terraform
- Use data sources for existing resources - do NOT recreate what already exists
- Include depends_on where implicit dependencies aren't clear
- Use moved blocks if renaming resources

### Best Practices (MANDATORY):
- All resources must have meaningful names using local.name_prefix
- Use for_each instead of count where possible (for maps/sets)
- Variables must have: description, type, default (where sensible), validation blocks where applicable
- Use locals for computed values and repeated expressions
- All resources must be tagged using local.common_tags merged with resource-specific tags
- Enable encryption at rest for all supported resources
- Use separate security groups per resource type (not shared)
- IAM policies must follow least privilege (no * on actions)
- Use aws_iam_policy_document data source instead of inline JSON policies

### Common Tags (in locals.tf):
```
common_tags = {{
  Project     = var.project_name
  Environment = var.environment
  ManagedBy   = "ArchLens-Terraform"
  ScanId      = "{scan_id}"
  CreatedAt   = timestamp()
}}
```

### Variables to Include:
- aws_region (string, default matching current architecture)
- environment (string, default "dev", validation: dev/staging/prod)
- project_name (string, default "archlens")
- Any resource-specific variables the recommendations require

### State Management:
- Configure S3 backend with DynamoDB locking
- Use terraform workspace-aware naming where applicable

## OUTPUT FORMAT:
- Start DIRECTLY with: # === FILENAME: main.tf ===
- Separate each file with: # === FILENAME: <filename> ===
- Do NOT wrap in markdown code blocks
- Do NOT include explanatory text between files
- Ensure all HCL is properly formatted and valid
- All string interpolations use "${{...}}" syntax correctly
"""
    return prompt


def invoke_bedrock(prompt):
    """Call Amazon Bedrock for Terraform generation using the model ID configured in environment variables."""
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
        logger.info(f"Terraform Generation Bedrock usage: {usage}")

        return ai_text

    except ClientError as e:
        logger.error(f"Bedrock error during Terraform generation: {e.response['Error']['Message']}")
        raise
    except Exception as e:
        logger.error(f"Error calling Bedrock: {str(e)}")
        raise


def parse_terraform_files(terraform_output):
    """
    Parse the multi-file Terraform output into individual files.
    Handles various marker formats and markdown wrappers.
    """
    files = {}
    current_file = None
    current_content = []

    # Clean markdown wrappers
    clean_output = terraform_output.strip()
    if clean_output.startswith('```'):
        lines = clean_output.split('\n')
        lines = [l for l in lines if not l.strip().startswith('```')]
        clean_output = '\n'.join(lines)

    for line in clean_output.split('\n'):
        stripped = line.strip()

        # Check for file marker patterns
        is_marker = False
        filename = None

        if stripped.startswith('# === FILENAME:') and '===' in stripped[15:]:
            filename = stripped.split('FILENAME:')[1].replace('===', '').strip()
            is_marker = True
        elif stripped.startswith('# --- FILENAME:'):
            filename = stripped.split('FILENAME:')[1].replace('---', '').strip()
            is_marker = True
        elif stripped.startswith('# File:'):
            filename = stripped.split('File:')[1].strip()
            is_marker = True

        if is_marker and filename:
            # Save previous file
            if current_file and current_content:
                files[current_file] = '\n'.join(current_content).strip()
            current_file = filename
            current_content = []
        else:
            current_content.append(line)

    # Save last file
    if current_file and current_content:
        files[current_file] = '\n'.join(current_content).strip()

    # If no file markers found, try to intelligently split or save as single file
    if not files:
        # Check if the output contains terraform/resource blocks
        if 'terraform {' in clean_output or 'resource "' in clean_output:
            files['main.tf'] = clean_output
        else:
            files['main.tf'] = clean_output

    return files


def validate_terraform_files(files):
    """
    Basic validation of generated Terraform files.
    Returns (is_valid, issues_list).
    """
    issues = []

    # Check main.tf exists and has basic structure
    if 'main.tf' not in files:
        issues.append("Missing main.tf")
    else:
        main_content = files['main.tf']
        if 'terraform {' not in main_content and 'terraform{' not in main_content:
            issues.append("Warning: main.tf missing terraform block")
        if 'provider "aws"' not in main_content and 'provider"aws"' not in main_content:
            issues.append("Warning: main.tf missing AWS provider configuration")

    # Check variables.tf
    if 'variables.tf' not in files:
        issues.append("Warning: Missing variables.tf")

    # Check for common issues across all files
    all_content = '\n'.join(files.values())

    if 'prevent_destroy' not in all_content:
        issues.append("Warning: No prevent_destroy lifecycle rules found")

    # Check for hardcoded credentials (security check)
    sensitive_patterns = ['AKIA', 'aws_secret_access_key', 'password =']
    for pattern in sensitive_patterns:
        if pattern.lower() in all_content.lower():
            issues.append(f"SECURITY: Possible hardcoded credential found ({pattern})")

    has_critical = any(not i.startswith('Warning') for i in issues)
    return not has_critical, issues


def save_tf_status(job_id, status, result=None, error=None):
    """Save Terraform generation job status to S3 for asynchronous polling."""
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
            Key=f"tf-status/{job_id}.json",
            Body=json.dumps(payload, default=str),
            ContentType='application/json'
        )
    except Exception as e:
        logger.warning(f"Failed to update Terraform status for {job_id}: {e}")


def get_tf_status(job_id):
    """Fetch current Terraform generation status from S3."""
    if not job_id:
        return {'status': 'NOT_FOUND', 'error': 'Missing jobId'}
    try:
        resp = s3_client.get_object(
            Bucket=DATA_BUCKET,
            Key=f"tf-status/{job_id}.json"
        )
        return json.loads(resp['Body'].read())
    except ClientError as e:
        if e.response['Error']['Code'] in ('NoSuchKey', '404'):
            return {'status': 'IN_PROGRESS', 'jobId': job_id}
        logger.error(f"Error fetching Terraform status: {e}")
        return {'status': 'ERROR', 'error': str(e)}
    except Exception as e:
        logger.error(f"Error reading Terraform status: {e}")
        return {'status': 'ERROR', 'error': str(e)}


def run_terraform_pipeline(scan_id, recommendation_id, recommendations, architecture_data, body):
    """Core Terraform script generation pipeline."""
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
            raise RuntimeError(f"Recommendation {recommendation_id} not found: {e.response['Error']['Message']}")

    if not recommendations:
        raise ValueError("No recommendations provided for Terraform generation")

    active_recommendations = [
        r for r in recommendations
        if r.get('status', 'approved') in ('approved', 'selected', 'generated')
    ]
    if not active_recommendations:
        active_recommendations = recommendations

    logger.info(f"Generating Terraform for {len(active_recommendations)} recommendations")

    prompt = generate_terraform_prompt(active_recommendations, architecture_data, scan_id)
    terraform_output = invoke_bedrock(prompt)

    terraform_files = parse_terraform_files(terraform_output)
    is_valid, validation_issues = validate_terraform_files(terraform_files)
    if not is_valid or not terraform_files:
        logger.error(f"Bedrock generated invalid Terraform: {validation_issues}")
        raise ValueError(f"Bedrock generated invalid Terraform: {'; '.join(validation_issues) if validation_issues else 'No valid HCL files parsed'}")

    timestamp = datetime.utcnow().strftime('%Y%m%d%H%M%S')
    s3_base_path = f"terraform/{scan_id}-{timestamp}"
    s3_keys = {}
    download_urls = {}

    for filename, content in terraform_files.items():
        s3_key = f"{s3_base_path}/{filename}"
        s3_client.put_object(
            Bucket=DATA_BUCKET,
            Key=s3_key,
            Body=content,
            ContentType='text/plain',
            Metadata={
                'scan-id': str(scan_id),
                'recommendation-id': str(recommendation_id or 'direct'),
                'generated-at': datetime.utcnow().isoformat()
            }
        )
        s3_keys[filename] = s3_key
        download_urls[filename] = s3_client.generate_presigned_url(
            'get_object',
            Params={'Bucket': DATA_BUCKET, 'Key': s3_key},
            ExpiresIn=3600
        )

    manifest = {
        'scan_id': scan_id,
        'recommendation_id': recommendation_id,
        'generated_at': datetime.utcnow().isoformat(),
        'files': list(terraform_files.keys()),
        's3_base_path': s3_base_path,
        'codebuild_source': s3_base_path
    }
    s3_client.put_object(
        Bucket=DATA_BUCKET,
        Key=f"{s3_base_path}/manifest.json",
        Body=json.dumps(manifest, indent=2),
        ContentType='application/json'
    )

    try:
        audit_table = dynamodb.Table(AUDIT_TABLE)
        audit_table.put_item(Item={
            'auditId': f"tf-gen-{timestamp}",
            'timestamp': datetime.utcnow().isoformat(),
            'action': 'TERRAFORM_GENERATED',
            'scanId': scan_id,
            'recommendationId': recommendation_id or 'direct',
            'fileCount': len(terraform_files),
            's3BasePath': s3_base_path,
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
        'files': terraform_files,
        's3Keys': s3_keys,
        'downloadUrls': download_urls,
        's3BasePath': s3_base_path,
        'templateType': 'Terraform',
        'format': 'HCL',
        'fileCount': len(terraform_files),
        'validation': {
            'passed': is_valid,
            'issues': validation_issues
        },
        'codebuild_config': {
            'source_bucket': DATA_BUCKET,
            'source_path': s3_base_path,
            'project_name': 'archlens-terraform-executor'
        },
        'metadata': {
            'recommendations_implemented': len(active_recommendations),
            'model_used': MODEL_ID
        }
    }


def lambda_handler(event, context):
    """
    Main handler for Terraform script generation.
    Supports:
    1. SQS Trigger: Background worker processing queued Terraform jobs.
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
                logger.info("Processing Terraform generation from SQS trigger")
                sqs_body = json.loads(record.get('body', '{}'))
                job_id = sqs_body.get('jobId')
                scan_id = sqs_body.get('scanId', 'unknown')
                rec_id = sqs_body.get('recommendationId')
                recs = sqs_body.get('recommendations')
                arch_data = sqs_body.get('architectureData', {})

                try:
                    result = run_terraform_pipeline(scan_id, rec_id, recs, arch_data, sqs_body)
                    save_tf_status(job_id, 'COMPLETED', result=result)
                    logger.info(f"SQS Terraform Job {job_id} completed successfully")
                    return {'statusCode': 200, 'body': 'SQS Terraform Job Completed Successfully'}
                except Exception as worker_err:
                    logger.error(f"SQS Terraform Worker Job {job_id} failed: {worker_err}")
                    save_tf_status(job_id, 'FAILED', error=str(worker_err))
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
            status_data = get_tf_status(job_id)
            return {
                'statusCode': 200,
                'headers': cors_headers,
                'body': json.dumps(status_data, default=str)
            }

        # 4. Asynchronous Decoupling via SQS (Prevents 504 Timeouts)
        if TF_QUEUE_URL and not body.get('isStepFunction'):
            try:
                logger.info(f"Queuing Terraform generation job {job_id} to SQS: {TF_QUEUE_URL}")
                save_tf_status(job_id, 'IN_PROGRESS')

                sqs_client.send_message(
                    QueueUrl=TF_QUEUE_URL,
                    MessageBody=json.dumps({
                        'jobId': job_id,
                        'scanId': scan_id,
                        'recommendationId': recommendation_id,
                        'recommendations': recommendations,
                        'architectureData': architecture_data
                    })
                )
                logger.info(f"Successfully queued Terraform job {job_id} to SQS")

                return {
                    'statusCode': 200,
                    'headers': cors_headers,
                    'body': json.dumps({
                        'status': 'IN_PROGRESS',
                        'jobId': job_id,
                        'scanId': scan_id,
                        'recommendationId': recommendation_id,
                        'pollIntervalSeconds': POLL_INTERVAL_SECONDS,
                        'message': 'Terraform script generation queued to SQS'
                    })
                }
            except Exception as sqs_err:
                logger.warning(f"Failed to queue Terraform job to SQS ({sqs_err}), falling back to direct execution")

        # 5. Direct Synchronous Execution (Step Functions or fallback)
        result = run_terraform_pipeline(scan_id, recommendation_id, recommendations, architecture_data, body)
        return {
            'statusCode': 200,
            'headers': cors_headers,
            'body': json.dumps(result, default=str)
        }

    except ClientError as e:
        logger.error(f"AWS Error in Terraform generation: {e.response['Error']['Message']}")
        return {
            'statusCode': 500,
            'headers': cors_headers,
            'body': json.dumps({'error': f"AWS Error: {e.response['Error']['Message']}"})
        }
    except Exception as e:
        logger.error(f"Unexpected error in Terraform generation: {str(e)}")
        return {
            'statusCode': 500,
            'headers': cors_headers,
            'body': json.dumps({'error': f"Internal error: {str(e)}"})
        }
